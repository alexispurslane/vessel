/**
 * Model registry and resolution logic.
 *
 * Pure model resolution functions with no session state dependency.
 * All are module-level singletons or pure functions that only depend
 * on `getDb()` and pi-coding-agent imports.
 */

import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";
import {
    AuthStorage,
    ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import type { Model as PiModel, Api } from "@mariozechner/pi-ai";
import { getDb } from "../db/index.js";
import { inferApiForProvider } from "../inference/api-helpers.js";
import { VESSEL_APPEND_PROMPT } from "./vessel-append-prompt.js";
import { getModelList, setModelList } from "./pi-adapter.js";

// --- Constants ---

const DATA_DIR = resolve(process.cwd(), "data");
const SESSIONS_DIR = resolve(DATA_DIR, "sessions");
const AGENT_DIR = resolve(DATA_DIR, "agent");
const MODELS_JSON_PATH = resolve(DATA_DIR, "models.json");

/** Return the Vessel-specific append system prompt.
 * Now loaded from an embedded constant rather than a file on disk,
 * so it stays version-controlled alongside the source code.
 */
export function loadVesselAppendPrompt(): string {
    return VESSEL_APPEND_PROMPT;
}

// --- Pi infrastructure singletons ---

/** Singleton AuthStorage — created once, updated when provider keys change. */
let _authStorage: AuthStorage | undefined;

/** Singleton ModelRegistry — created once, refreshed when models/providers change. */
let _modelRegistry: ModelRegistry | undefined;

/**
 * Get the singleton AuthStorage with API keys from our DB.
 * Rebuilds from DB on first call or when explicitly refreshed.
 */
export function getAuthStorage(): AuthStorage {
    if (!_authStorage) {
        _authStorage = AuthStorage.create();
        refreshAuthStorageKeys();
    }
    return _authStorage;
}

/**
 * Refresh the singleton AuthStorage's API keys from the DB.
 * Called after provider mutations (upsert/delete).
 */
export function refreshAuthStorageKeys(): void {
    // Always recreate AuthStorage from scratch to clear stale keys
    // from deleted providers. AuthStorage doesn't expose a clear/remove
    // method, so reusing the instance would leak credentials for
    // providers that have been deleted from the DB.
    _authStorage = AuthStorage.create();
    const db = getDb();
    const providers = db
        .prepare("SELECT provider, api_key FROM providers")
        .all() as { provider: string; api_key: string }[];

    for (const row of providers) {
        _authStorage.setRuntimeApiKey(row.provider, row.api_key);
    }
}

/**
 * Filter the ModelRegistry's internal model list to only include models
 * whose provider exists in vessel's DB. This prevents built-in models from
 * pi-ai's hardcoded list (which have no API keys in vessel) from shadowing
 * user-configured models with the same ID under a different provider.
 *
 * Must be called after ModelRegistry.create() and after refresh(), since
 * both reload all built-in models from pi-ai's models.generated.js.
 */
function filterModelsToVesselProviders(registry: ModelRegistry): void {
    const db = getDb();
    const vesselProviders = new Set(
        (db.prepare("SELECT provider FROM providers").all() as { provider: string }[]).map(r => r.provider)
    );
    const models = getModelList(registry);
    if (models) {
        setModelList(registry, models.filter(m => vesselProviders.has(m.provider)));
    }
}

/**
 * Get the singleton ModelRegistry.
 * Creates it on first call; callers should call refreshModelRegistry()
 * after mutations to providers or custom_models.
 */
export function getModelRegistry(): ModelRegistry {
    if (!_modelRegistry) {
        generateModelsJson();
        _modelRegistry = ModelRegistry.create(getAuthStorage(), MODELS_JSON_PATH);
        filterModelsToVesselProviders(_modelRegistry);
    }
    return _modelRegistry;
}

/**
 * Refresh the singletons after a mutation to providers or custom_models.
 * Regenerates models.json, refreshes the ModelRegistry, and updates AuthStorage keys.
 */
export function refreshModelRegistry(): void {
    generateModelsJson();
    refreshAuthStorageKeys();
    if (_modelRegistry) {
        _modelRegistry.refresh();
        filterModelsToVesselProviders(_modelRegistry);
    }
}

/**
 * Find a model by its ID across all providers in the model registry.
 * This is the primary way to look up a model — the returned Model object
 * carries the provider, API type, and all other metadata as fields.
 *
 * @param modelId - The model ID to look up (e.g. "gpt-4o", "local-llama")
 * @param modelRegistry - Optional existing ModelRegistry (avoids creating a new one)
 * @returns The Model object, or undefined if not found
 */
export function findModelById(modelId: string, modelRegistry?: ModelRegistry): PiModel<Api> | undefined {
    const registry = modelRegistry ?? getModelRegistry();
    return registry.getAll().find((m) => m.id === modelId);
}

/**
 * Resolve a model's full info from just its model ID.
 * Delegates to findModelById (pi-ai ModelRegistry) as the single source of truth.
 *
 * @param modelId - The model ID to look up
 * @returns The model info including provider, or null if not found
 */
export function resolveModel(modelId: string): {
    provider: string;
    modelId: string;
    name: string;
    api: string;
    reasoning: boolean;
    input: string[];
    contextWindow: number;
    maxTokens: number;
} | null {
    const model = findModelById(modelId);
    if (!model) return null;

    return {
        provider: model.provider,
        modelId: model.id,
        name: model.name,
        api: model.api,
        reasoning: model.reasoning,
        input: [...model.input],
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
    };
}

/**
 * Resolve the provider for a model ID.
 * Convenience wrapper around findModelById that just returns the provider string.
 *
 * @param modelId - The model ID to look up
 * @returns The provider name, or null if the model ID is not found
 */
export function resolveModelProvider(modelId: string): string | null {
    const model = findModelById(modelId);
    return model?.provider ?? null;
}

/**
 * Generate a models.json file from our DB that pi's ModelRegistry can read.
 * This includes:
 * - Provider base_url overrides (for proxying built-in providers)
 * - Custom model definitions (for Ollama, vLLM, local models, etc.)
 *
 * Written to data/models.json so pi can pick it up.
 */
export function generateModelsJson(): void {
    const db = getDb();

    const providers = db
        .prepare("SELECT provider, api_key, base_url FROM providers")
        .all() as { provider: string; api_key: string; base_url: string | null }[];

    const customModels = db.prepare("SELECT * FROM custom_models").all() as Record<
        string,
        unknown
    >[];

    // Build the models.json structure that pi expects
    const config: Record<string, unknown> = { providers: {} };

    for (const prov of providers) {
        const providerEntry: Record<string, unknown> = {};

        // If the provider has a base_url, include it as an override
        if (prov.base_url) {
            providerEntry.baseUrl = prov.base_url;
        }

        // Include the API key so pi can use it (pi also supports env var names)
        providerEntry.apiKey = prov.api_key;

        // Add any custom models for this provider
        const modelsForProvider = customModels.filter((m) => m.provider === prov.provider);
        if (modelsForProvider.length > 0) {
            // Infer API from provider name for known providers
            const api = inferApiForProvider(prov.provider);
            if (api) providerEntry.api = api;

            providerEntry.models = modelsForProvider.map((m) => {
                const model: Record<string, unknown> = {
                    id: m.id as string,
                    name: m.name as string,
                    reasoning: !!m.reasoning,
                    input: JSON.parse((m.input_types as string) || '["text"]'),
                    contextWindow: m.context_window as number,
                    maxTokens: m.max_tokens as number,
                    cost: {
                        input: m.cost_input as number,
                        output: m.cost_output as number,
                        cacheRead: m.cost_cache_read as number,
                        cacheWrite: m.cost_cache_write as number,
                    },
                };

                if (m.compat) {
                    try {
                        model.compat = JSON.parse(m.compat as string);
                    } catch {
                        // Skip invalid compat
                    }
                }

                return model;
            });
        }

        if (Object.keys(providerEntry).length > 0) {
            (config.providers as Record<string, unknown>)[prov.provider] = providerEntry;
        }
    }

    // Ensure the data directory exists
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(MODELS_JSON_PATH, JSON.stringify(config, null, 2));
}

/**
 * Refresh model registry and auth storage after modifying providers or custom_models.
 * Regenerates models.json, refreshes the ModelRegistry singleton, and updates API keys.
 */
export function refreshModelsJson(): void {
    refreshModelRegistry();
}

// Re-export the AGENT_DIR and SESSIONS_DIR constants for use by other modules
// that need them (e.g., session-store).
export { DATA_DIR, SESSIONS_DIR, AGENT_DIR, MODELS_JSON_PATH };
