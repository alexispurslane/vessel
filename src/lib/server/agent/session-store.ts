import { join, resolve } from "path";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import {
    createAgentSession,
    AuthStorage,
    ModelRegistry,
    SessionManager,
    SettingsManager,
    type AgentSession as PiAgentSession,
    type AgentSessionEvent as PiAgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createSandboxedCodingTools } from "./sandboxed-tools.js";
import { createSessionSandbox, getSessionWorkDir, loadConversationSettingsFromDb } from "./sandbox-factory.js";
import type { Model as PiModel, Api } from "@mariozechner/pi-ai";
import { getDb } from "../db/index.js";
import { randomUUID } from "crypto";
import type { ChatSSEEvent, ConversationListItem, ActiveSession, CustomModelDef } from "./types.js";
import { inferApiForProvider } from "../inference/api-helpers.js";
import { generateTitleAndTags } from "./title-generator.js";

// --- Constants ---

const DATA_DIR = resolve(process.cwd(), "data");
const SESSIONS_DIR = resolve(DATA_DIR, "sessions");
const AGENT_DIR = resolve(DATA_DIR, "agent");
const MODELS_JSON_PATH = resolve(DATA_DIR, "models.json");

/** How long to keep a session in memory after all subscribers disconnect.
 * This is a safety net — the primary release mechanism is the explicit
 * /api/sessions/[id]/release call from the frontend on conversation switch.
 */
const SESSION_DISPOSE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

/** Monotonically increasing event ID for SSE Last-Event-Id support */
let eventCounter = 0n;

// --- In-memory session store ---

const sessions = new Map<string, ActiveSession>();

// --- Pi infrastructure singletons ---

/** Singleton AuthStorage — created once, updated when provider keys change. */
let _authStorage: AuthStorage | undefined;

/** Singleton ModelRegistry — created once, refreshed when models/providers change. */
let _modelRegistry: ModelRegistry | undefined;

/**
 * Get the singleton AuthStorage with API keys from our DB.
 * Rebuilds from DB on first call or when explicitly refreshed.
 */
function getAuthStorage(): AuthStorage {
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
function refreshAuthStorageKeys(): void {
    if (!_authStorage) {
        _authStorage = AuthStorage.create();
    }
    const db = getDb();
    const providers = db
        .prepare("SELECT provider, encrypted_key FROM providers")
        .all() as { provider: string; encrypted_key: string }[];

    // Clear existing runtime keys and repopulate
    // (AuthStorage doesn't have a clear method, so we overwrite)
    for (const row of providers) {
        _authStorage.setRuntimeApiKey(row.provider, row.encrypted_key);
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
    }
    return _modelRegistry;
}

/**
 * Refresh the singletons after a mutation to providers or custom_models.
 * Regenerates models.json, refreshes the ModelRegistry, and updates AuthStorage keys.
 */
function refreshModelRegistry(): void {
    generateModelsJson();
    refreshAuthStorageKeys();
    if (_modelRegistry) {
        _modelRegistry.refresh();
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
function generateModelsJson(): void {
    const db = getDb();

    const providers = db
        .prepare("SELECT provider, encrypted_key, base_url FROM providers")
        .all() as { provider: string; encrypted_key: string; base_url: string | null }[];

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
        providerEntry.apiKey = prov.encrypted_key;

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

// --- Event helpers ---

function nextEventId(): string {
    return `evt-${(eventCounter++).toString(36)}`;
}

function broadcast(sessionKey: string, event: ChatSSEEvent): void {
    const session = sessions.get(sessionKey);
    if (!session) return;

    for (const [, subscriber] of session.subscribers) {
        subscriber.send(event);
    }
}

/**
 * Extract text output from a tool partial result (AgentToolResult).
 * The result has content: (TextContent | ImageContent)[] and details: T
 */
function extractToolOutput(partialResult: unknown): string | undefined {
    if (!partialResult || typeof partialResult !== "object") return undefined;
    const result = partialResult as Record<string, unknown>;

    if (Array.isArray(result.content)) {
        return (result.content as Record<string, unknown>[])
            .filter((block) => block.type === "text" && typeof block.text === "string")
            .map((block) => block.text as string)
            .join("");
    }

    return undefined;
}

/**
 * Serialize a pi AgentMessage for SSE transmission.
 * Extracts text content from the content array and strips non-serializable fields.
 */
function serializeMessage(message: unknown): unknown {
    if (!message || typeof message !== "object") return message;
    const msg = message as Record<string, unknown>;

    // For AssistantMessage, extract text and thinking from content array
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
        const textParts: string[] = [];
        const thinkingParts: string[] = [];
        const toolCalls: unknown[] = [];

        for (const block of msg.content as Record<string, unknown>[]) {
            if (block.type === "text" && typeof block.text === "string") {
                textParts.push(block.text);
            } else if (block.type === "thinking" && typeof block.thinking === "string") {
                thinkingParts.push(block.thinking);
            } else if (block.type === "toolCall") {
                toolCalls.push({
                    id: block.id,
                    name: block.name,
                    arguments: block.arguments,
                });
            }
        }

        return {
            role: msg.role,
            content: textParts.length > 0 ? textParts : undefined,
            thinking: thinkingParts.length > 0 ? thinkingParts.join("") : undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            provider: msg.provider,
            model: msg.model,
            stopReason: msg.stopReason,
            errorMessage: msg.errorMessage,
            timestamp: msg.timestamp,
        };
    }

    // For UserMessage, content is a string or array
    if (msg.role === "user") {
        return {
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
        };
    }

    // For other message types, return as-is
    return msg;
}

/**
 * Format pi AgentSessionEvent into a serializable payload for SSE.
 * Maps pi's generic event types to our chat-specific format.
 */
function formatEventPayload(event: PiAgentSessionEvent): unknown {
    switch (event.type) {
        case "message_update":
            return event.assistantMessageEvent;
        case "message_start":
            return { type: event.type, message: serializeMessage(event.message) };
        case "message_end":
            return { type: event.type, message: serializeMessage(event.message) };
        case "agent_start":
        case "agent_end":
            return {
                type: event.type,
                messages:
                    "messages" in event
                        ? Array.isArray(event.messages)
                            ? event.messages.map(serializeMessage)
                            : undefined
                        : undefined,
            };
        case "turn_start":
        case "turn_end":
            return {
                type: event.type,
                message: "message" in event ? serializeMessage(event.message) : undefined,
                toolResults: "toolResults" in event ? event.toolResults : undefined,
            };
        case "tool_execution_start":
            return { type: event.type, toolName: event.toolName, toolCallId: event.toolCallId };
        case "tool_execution_update":
            return {
                type: event.type,
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                output: extractToolOutput(event.partialResult),
            };
        case "tool_execution_end":
            return {
                type: event.type,
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                isError: event.isError,
                result: extractToolOutput(event.result),
            };
        case "queue_update":
            return { type: event.type, steering: event.steering, followUp: event.followUp };
        default:
            return event;
    }
}

// --- Session disposal ---

function scheduleDispose(conversationId: string): void {
    const session = sessions.get(conversationId);
    if (!session) return;

    // Clear any existing timer
    if (session.disposeTimer) {
        clearTimeout(session.disposeTimer);
    }

    session.disposeTimer = setTimeout(() => {
        const s = sessions.get(conversationId);
        if (!s || s.subscribers.size > 0) return; // someone reconnected

        // Clean up
        s.unsubscribe();
        s.agentSession.dispose();
        sessions.delete(conversationId);
        console.log(`Disposed session ${conversationId} (idle timeout)`);
    }, SESSION_DISPOSE_TIMEOUT_MS);
}

function cancelDispose(conversationId: string): void {
    const session = sessions.get(conversationId);
    if (session?.disposeTimer) {
        clearTimeout(session.disposeTimer);
        session.disposeTimer = undefined;
    }
}

// --- Public API ---

/**
 * Create a new conversation (both in our DB and as a pi session).
 * Returns the conversation ID.
 */
export async function createConversation(title?: string, modelId?: string): Promise<string> {
    const id = randomUUID();

    // Create pi session file
    mkdirSync(SESSIONS_DIR, { recursive: true });
    const sessionManager = SessionManager.create(process.cwd(), SESSIONS_DIR);
    sessionManager.newSession({ id });
    const sessionFilePath = sessionManager.getSessionFile();

    // Resolve the provider from the model ID if a model is specified
    let modelProvider: string | null = null;
    if (modelId) {
        modelProvider = resolveModelProvider(modelId);
    }

    // Save metadata to our DB
    const db = getDb();
    db.prepare(
        "INSERT INTO conversations (id, title, session_file_path, model_provider, model_id) VALUES (?, ?, ?, ?, ?)"
    ).run(id, title ?? "New Chat", sessionFilePath ?? "", modelProvider, modelId ?? null);

    return id;
}

/**
 * Get or create an active AgentSession for a conversation.
 * If the session is already in memory, return it.
 * If not, hydrate from the pi session file.
 */
export async function getOrCreateSession(conversationId: string): Promise<PiAgentSession> {
    const existing = sessions.get(conversationId);
    if (existing) {
        cancelDispose(conversationId);
        return existing.agentSession;
    }

    // Look up our metadata including model selection
    const db = getDb();
    const row = db
        .prepare(
            "SELECT session_file_path, model_provider, model_id FROM conversations WHERE id = ?"
        )
        .get(conversationId) as
        | { session_file_path: string; model_provider: string | null; model_id: string | null }
        | undefined;

    if (!row) {
        throw new Error(`Conversation ${conversationId} not found`);
    }

    // Set up pi's infrastructure
    const modelRegistry = getModelRegistry();

    let sessionManager: SessionManager;
    if (row.session_file_path) {
        sessionManager = SessionManager.open(row.session_file_path, SESSIONS_DIR);
    } else {
        sessionManager = SessionManager.create(process.cwd(), SESSIONS_DIR);
        sessionManager.newSession({ id: conversationId });
    }

    // Apply default model settings from our DB settings table
    const settingsManager = SettingsManager.inMemory();
    const settingsRows = db.prepare("SELECT key, value FROM settings").all() as {
        key: string;
        value: string;
    }[];
    let defaultModelId: string | undefined;
    for (const s of settingsRows) {
        if (s.key === "defaultModel" && s.value) {
            settingsManager.setDefaultModel(s.value);
            defaultModelId = s.value;
        }
    }

    // Resolve the provider for the default model setting on the settings manager
    if (defaultModelId) {
        const resolvedProvider = findModelById(defaultModelId, modelRegistry)?.provider;
        if (resolvedProvider) {
            settingsManager.setDefaultProvider(resolvedProvider);
        }
    }

    // Try to resolve the model for this conversation
    let model: PiModel<Api> | undefined;

    // First, try the conversation-specific model
    if (row.model_id) {
        model = findModelById(row.model_id, modelRegistry);
    }

    // Fall back to default model from settings
    if (!model && defaultModelId) {
        model = findModelById(defaultModelId, modelRegistry);
    }

    mkdirSync(AGENT_DIR, { recursive: true });

    // Load per-conversation settings (override global sandbox settings)
    const conversationSettings = loadConversationSettingsFromDb(conversationId);

    // Create per-session zerobox sandbox for tool execution isolation.
    // Returns null if sandboxing is disabled in settings.
    // Per-conversation settings override global sandbox config.
    const sandbox = createSessionSandbox(conversationId, conversationSettings);

    const createOpts: Parameters<typeof createAgentSession>[0] = {
        cwd: process.cwd(),
        agentDir: AGENT_DIR,
        sessionManager,
        authStorage: modelRegistry.authStorage,
        modelRegistry,
        settingsManager,
    };

    if (model) {
        createOpts.model = model;
    }

    const { session: agentSession } = await createAgentSession(createOpts);

    // If sandbox is enabled, inject sandboxed tools as baseToolsOverride.
    // We can't pass these via createAgentSession's `tools` option — it only extracts
    // tool names and then creates fresh default tools internally, discarding our custom
    // operations. Instead, we inject them as baseToolsOverride after construction.
    //
    // AgentSession._buildRuntime checks this field: when set, it uses these tools
    // instead of creating default ones. We must set it and rebuild the runtime
    // so the tool registry picks up our custom operations.
    if (sandbox) {
        const sessionWorkDir = getSessionWorkDir(conversationId);
        const sandboxedTools = createSandboxedCodingTools(sessionWorkDir, sandbox);
        const baseToolsOverride: Record<string, AgentTool<any>> = {};
        for (const tool of sandboxedTools) {
            baseToolsOverride[tool.name] = tool;
        }

        // _buildRuntime requires an options object with at least flagValues (a Map)
        // and activeToolNames. When baseToolsOverride is set, defaultActiveToolNames
        // is derived from its keys, so we just need to include our tool names.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (agentSession as any)._baseToolsOverride = baseToolsOverride;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (agentSession as any)._buildRuntime({
            flagValues: new Map(),
            activeToolNames: Object.keys(baseToolsOverride),
            includeAllExtensionTools: true,
        });
    }

    // Subscribe to events and broadcast to SSE subscribers
    const unsubscribe = agentSession.subscribe((event: PiAgentSessionEvent) => {
        const sseEvent: ChatSSEEvent = {
            id: nextEventId(),
            event: event.type,
            data: formatEventPayload(event),
        };
        broadcast(conversationId, sseEvent);
    });

    sessions.set(conversationId, {
        agentSession,
        sessionId: conversationId,
        subscribers: new Map(),
        unsubscribe,
        sandbox,
        conversationSettings: conversationSettings ?? undefined,
    });

    return agentSession;
}

/**
 * Subscribe to SSE events for a session.
 * Returns an unsubscribe function.
 */
export function subscribe(
    conversationId: string,
    subscriberId: string,
    send: (event: ChatSSEEvent) => void
): () => void {
    const session = sessions.get(conversationId);
    if (!session) {
        throw new Error(`Session ${conversationId} not found`);
    }

    // New subscriber — cancel any pending disposal
    cancelDispose(conversationId);
    session.subscribers.set(subscriberId, { send });

    return () => {
        session.subscribers.delete(subscriberId);
        if (session.subscribers.size === 0) {
            // No more subscribers — schedule disposal
            scheduleDispose(conversationId);
        }
    };
}

/**
 * Send a message to an active session.
 */
export async function sendMessage(conversationId: string, content: string): Promise<void> {
    const session = await getOrCreateSession(conversationId);
    await session.prompt(content);

    // After the prompt completes, trigger title/tag generation in the background.
    // This runs even if the client isn't connected to the SSE stream yet.
    generateTitleAndTags(conversationId).catch((err) => {
        console.error(
            `[session-store] Background title generation failed for ${conversationId}:`,
            err
        );
    });
}

/**
 * Switch the model for an active session.
 * If the session is already in memory, switch the model.
 * If not, this is a no-op (the model will be set when the session is created).
 *
 * Only requires a model ID — the provider is resolved automatically.
 */
export async function switchSessionModel(conversationId: string, modelId: string): Promise<void> {
    const model = findModelById(modelId);
    if (!model) {
        throw new Error(`Model ${modelId} not found`);
    }

    // Always update the conversation metadata in DB
    const db = getDb();
    db.prepare(
        `UPDATE conversations SET model_provider = ?, model_id = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(model.provider, modelId, conversationId);

    // If the session is in memory, also switch the live model
    const session = sessions.get(conversationId);
    if (!session) return;

    await session.agentSession.setModel(model);
}

/**
 * Abort current generation for a session.
 */
export async function abortSession(conversationId: string): Promise<void> {
    const session = sessions.get(conversationId);
    if (session) {
        await session.agentSession.abort();
    }
}

/**
 * Dispose of an in-memory session only (no disk cleanup).
 * Used when the in-memory copy should be released but the conversation
 * data on disk (pi session file, workspace) should be preserved for
 * later rehydration.
 *
 * Called by:
 * - Idle timeout (scheduleDispose): all subscribers disconnected
 * - Browser session end (via /api/sessions/release endpoint)
 */
export function disposeSession(conversationId: string): void {
    const session = sessions.get(conversationId);
    if (!session) return;

    // Clear any pending disposal timer
    if (session.disposeTimer) {
        clearTimeout(session.disposeTimer);
    }

    // Unsubscribe from agent events and dispose the in-memory pi session
    session.unsubscribe();
    session.agentSession.dispose();
    sessions.delete(conversationId);
    console.log(`Disposed in-memory session ${conversationId} (idle timeout or browser session end)`);
}

/**
 * Restart a specific session by disposing it from memory.
 * It will be lazily recreated with fresh settings (including per-conversation
 * sandbox policy) when next accessed via getOrCreateSession.
 *
 * Returns true if the session was active and disposed, false otherwise.
 */
export function restartSession(conversationId: string): boolean {
    const session = sessions.get(conversationId);
    if (!session) return false;

    // Clear any pending disposal timer
    if (session.disposeTimer) {
        clearTimeout(session.disposeTimer);
    }

    // Unsubscribe from agent events and dispose the pi session
    session.unsubscribe();
    session.agentSession.dispose();
    sessions.delete(conversationId);
    console.log(`Restarted session ${conversationId} (conversation settings changed)`);
    return true;
}

/**
 * Fully destroy a conversation: dispose in-memory session, delete the
 * pi session file, delete the workspace directory (if configured), and remove the DB row.
 * Only called when the user explicitly hits the trash icon.
 */
export async function destroyConversation(conversationId: string): Promise<void> {
    // 1. Dispose in-memory session if loaded
    disposeSession(conversationId);

    // Load per-conversation settings before deleting DB rows
    const convSettings = loadConversationSettingsFromDb(conversationId);
    const deleteWorkspace = convSettings?.deleteWorkspaceWithConversation !== false; // default true

    // 2. Delete the pi session .jsonl file
    const db = getDb();
    const row = db
        .prepare("SELECT session_file_path FROM conversations WHERE id = ?")
        .get(conversationId) as { session_file_path: string } | undefined;

    if (row?.session_file_path && existsSync(row.session_file_path)) {
        try {
            rmSync(row.session_file_path);
            console.log(`Deleted pi session file: ${row.session_file_path}`);
        } catch (err) {
            console.error(`Failed to delete pi session file ${row.session_file_path}:`, err);
        }
    }

    // 3. Delete the conversation's workspace directory (if setting allows)
    if (deleteWorkspace) {
        const workspaceDir = getSessionWorkDir(conversationId);
        if (existsSync(workspaceDir)) {
            try {
                rmSync(workspaceDir, { recursive: true });
                console.log(`Deleted workspace directory: ${workspaceDir}`);
            } catch (err) {
                console.error(`Failed to delete workspace directory ${workspaceDir}:`, err);
            }
        }

        // Also clean up the parent session directory if it's now empty
        // (e.g. data/sessions/<id>/ which contained workspace/)
        const sessionDir = resolve(SESSIONS_DIR, conversationId);
        if (existsSync(sessionDir)) {
            try {
                rmSync(sessionDir, { recursive: true });
                console.log(`Deleted session directory: ${sessionDir}`);
            } catch (err) {
                console.error(`Failed to delete session directory ${sessionDir}:`, err);
            }
        }
    } else {
        console.log(`Keeping workspace for conversation ${conversationId} (deleteWorkspaceWithConversation = false)`);
    }

    // 4. Delete the DB rows (conversation_settings is ON DELETE CASCADE)
    db.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
    console.log(`Destroyed conversation ${conversationId} (explicit user delete)`);
}

/**
 * Restart all active sessions by disposing them from memory.
 * They will be lazily recreated with fresh settings (including sandbox policy)
 * when next accessed via getOrCreateSession.
 *
 * Returns the number of sessions that were restarted.
 */
export function restartAllSessions(): number {
    const ids = [...sessions.keys()];
    for (const id of ids) {
        const session = sessions.get(id)!;

        // Clear any pending disposal timer
        if (session.disposeTimer) {
            clearTimeout(session.disposeTimer);
        }

        // Unsubscribe from agent events and dispose the pi session
        session.unsubscribe();
        session.agentSession.dispose();
        sessions.delete(id);
    }

    if (ids.length > 0) {
        console.log(`Restarted ${ids.length} session(s) — they will be re-created on next access`);
    }
    return ids.length;
}

/**
 * Load message history for a conversation from its pi session file.
 * Returns an object with:
 * - messages: array of { id, role, content, thinking, model, modelProvider, timestamp }
 * - model: the last model used (provider + modelId)
 */
export async function getSessionHistory(conversationId: string): Promise<{
    messages: Array<{
        id: string;
        role: string;
        content: string;
        thinking?: string;
        model?: string;
        modelProvider?: string;
        toolCalls?: Array<{
            toolName: string;
            status: string;
            output?: string;
        }>;
        isError?: boolean;
        timestamp: number;
    }>;
    model: { provider: string; modelId: string } | null;
}> {
    const db = getDb();
    const row = db
        .prepare(
            "SELECT session_file_path, model_provider, model_id FROM conversations WHERE id = ?"
        )
        .get(conversationId) as
        | { session_file_path: string; model_provider: string | null; model_id: string | null }
        | undefined;

    if (!row?.session_file_path) {
        return { messages: [], model: null };
    }

    // Ensure the session is loaded — it restores from the JSONL file automatically.
    // This also gives us tree-aware history (respecting the current leaf position
    // after any navigation/edit/delete operations).
    const session = await getOrCreateSession(conversationId);

    // Cancel any pending disposal since we're actively using the session
    cancelDispose(conversationId);

    return buildHistoryFromSession(
        sessions.get(conversationId)!,
        row
    );
}

/**
 * Build message history from an in-memory session, respecting the
 * current branch/leaf position. Uses the SessionManager's getBranch() method
 * to walk only the entries on the current branch path.
 *
 * This is the sole method for reading session history — the SessionManager
 * handles JSONL file restoration automatically when the session is loaded.
 */
function buildHistoryFromSession(
    activeSession: ActiveSession,
    row: { session_file_path: string; model_provider: string | null; model_id: string | null }
): {
    messages: Array<{
        id: string;
        role: string;
        content: string;
        thinking?: string;
        model?: string;
        modelProvider?: string;
        toolCalls?: Array<{
            toolName: string;
            status: string;
            output?: string;
        }>;
        isError?: boolean;
        timestamp: number;
    }>;
    model: { provider: string; modelId: string } | null;
} {
    const sessionManager = activeSession.agentSession.sessionManager;
    // getBranch() returns entries from root to current leaf
    const branchEntries = sessionManager.getBranch();

    const messages: Array<{
        id: string;
        role: string;
        content: string;
        thinking?: string;
        model?: string;
        modelProvider?: string;
        toolCalls?: Array<{
            toolName: string;
            status: string;
            output?: string;
        }>;
        isError?: boolean;
        timestamp: number;
    }> = [];

    // Track tool call IDs to match results from tool-role messages
    const pendingToolCalls: Map<
        string,
        { toolName: string; msgIndex: number; toolCallIndex: number }
    > = new Map();

    let lastModelProvider: string | null = null;
    let lastModelId: string | null = null;

    for (const entry of branchEntries) {
        // Track model changes
        if (entry.type === "model_change") {
            const modelEntry = entry as unknown as { provider: string; modelId: string };
            lastModelProvider = modelEntry.provider ?? null;
            lastModelId = modelEntry.modelId ?? null;
            continue;
        }

        if (entry.type !== "message") continue;

        const msg = (entry as unknown as { message: Record<string, unknown> }).message;
        if (!msg || typeof msg !== "object") continue;

        const role = msg.role as string;

        // Handle tool result messages — attach output to the matching pending tool call
        if (role === "toolResult") {
            const toolCallId = (msg.toolCallId ?? msg.tool_call_id) as string | undefined;
            if (toolCallId && pendingToolCalls.has(toolCallId)) {
                const pending = pendingToolCalls.get(toolCallId)!;
                const targetMsg = messages[pending.msgIndex];
                if (targetMsg?.toolCalls?.[pending.toolCallIndex]) {
                    const tc = targetMsg.toolCalls[pending.toolCallIndex];
                    tc.status = msg.isError ? "error" : "completed";
                    if (Array.isArray(msg.content)) {
                        tc.output = (msg.content as Record<string, unknown>[])
                            .filter(
                                (b) => b.type === "text" && typeof b.text === "string"
                            )
                            .map((b) => b.text as string)
                            .join("");
                    } else if (typeof msg.content === "string") {
                        tc.output = msg.content;
                    }
                }
                pendingToolCalls.delete(toolCallId);
            }
            continue;
        }

        if (role !== "user" && role !== "assistant") continue;

        // Extract text content
        let textContent = "";
        let thinkingContent: string | undefined;
        const extractedToolCalls: Array<{
            toolName: string;
            status: string;
            output?: string;
            toolCallId?: string;
        }> = [];

        if (Array.isArray(msg.content)) {
            for (const block of msg.content as Record<string, unknown>[]) {
                if (block.type === "text" && typeof block.text === "string") {
                    textContent += block.text;
                } else if (
                    block.type === "thinking" &&
                    typeof block.thinking === "string"
                ) {
                    thinkingContent = (thinkingContent ?? "") + block.thinking;
                } else if (block.type === "toolCall") {
                    extractedToolCalls.push({
                        toolName: (block.name as string) ?? "unknown",
                        status: "completed",
                        toolCallId: block.id as string,
                    });
                }
            }
        } else if (typeof msg.content === "string") {
            textContent = msg.content;
        }

        // Skip empty user messages that pi sometimes adds
        if (role === "user" && !textContent.trim()) continue;

        // Strip leading newlines
        textContent = textContent.replace(/^\n+/, "");
        if (thinkingContent) {
            thinkingContent = thinkingContent.replace(/^\n+/, "");
        }

        const model =
            role === "assistant" ? (msg.model as string | undefined) ?? lastModelId ?? undefined : undefined;
        const modelProvider =
            role === "assistant"
                ? (msg.provider as string | undefined) ?? lastModelProvider ?? undefined
                : undefined;
        const isError = role === "assistant" && !!msg.errorMessage;

        const msgIndex = messages.length;
        messages.push({
            id: entry.id,
            role,
            content: textContent,
            thinking: thinkingContent || undefined,
            model,
            modelProvider,
            toolCalls: extractedToolCalls.length > 0 ? extractedToolCalls : undefined,
            isError: isError || undefined,
            timestamp: (msg.timestamp as number) ?? 0,
        });

        // Register tool calls for later matching with tool result messages
        if (extractedToolCalls.length > 0) {
            extractedToolCalls.forEach((tc, tcIdx) => {
                if (tc.toolCallId) {
                    pendingToolCalls.set(tc.toolCallId, {
                        toolName: tc.toolName,
                        msgIndex,
                        toolCallIndex: tcIdx,
                    });
                }
            });
        }
    }

    const model =
        lastModelProvider && lastModelId
            ? { provider: lastModelProvider, modelId: lastModelId }
            : row.model_provider && row.model_id
                ? { provider: row.model_provider, modelId: row.model_id }
                : null;

    return { messages, model };
}

/**
 * Navigate the session tree to a target entry.
 * Used for delete/edit operations — moves the conversation's "current position"
 * back to before the target message, effectively abandoning that message and
 * everything after it in the conversation.
 *
 * For user messages: returns the message text (for editing and re-sending).
 * For other messages: just navigates back.
 *
 * This uses the SDK's navigateTree method which handles branching properly
 * in the append-only session tree.
 */
export async function navigateMessage(
    conversationId: string,
    targetEntryId: string
): Promise<{ editorText?: string; cancelled: boolean }> {
    // Ensure session is loaded (it might have been disposed after idle timeout)
    const session = await getOrCreateSession(conversationId);

    // Cancel any pending disposal since we're actively using the session
    cancelDispose(conversationId);

    // Check the type of entry we're navigating to — for non-user messages (e.g., assistant),
    // we want to navigate to the parent entry so the message gets "deleted"
    const entry = session.sessionManager.getEntry(targetEntryId);
    if (!entry) {
        throw new Error(`Entry ${targetEntryId} not found in session`);
    }

    // For user messages: navigateTree handles this correctly — sets leaf to parent and returns text
    // For non-user messages (assistant, etc.): we need to navigate to the parent to effectively delete this message
    let navigateTargetId = targetEntryId;
    if (entry.type === "message" && entry.message && entry.message.role !== "user") {
        // For assistant messages, navigate to the parent entry to delete this response
        // The parent is typically the user message or tool result that preceded this response
        const parentId = entry.parentId;
        if (parentId) {
            navigateTargetId = parentId;
        } else {
            // If the assistant message is a root (no parent), we can't navigate further back
            // Just navigate to the message itself
            navigateTargetId = targetEntryId;
        }
    }

    const result = await session.navigateTree(navigateTargetId, {
        summarize: false,
    });

    return {
        editorText: result.editorText,
        cancelled: result.cancelled,
    };
}

/**
 * Get all user messages from the session, for editing/forking.
 * Returns entry IDs and text content.
 */
export function getUserMessages(conversationId: string): Array<{ entryId: string; text: string }> {
    const session = sessions.get(conversationId);
    if (!session) {
        throw new Error(`No active session for conversation ${conversationId}`);
    }

    return session.agentSession.getUserMessagesForForking();
}

/**
 * List all conversations from our DB (for sidebar).
 */
export function listConversations(): ConversationListItem[] {
    const db = getDb();
    const rows = db
        .prepare(
            "SELECT id, title, tags, created_at, updated_at FROM conversations ORDER BY updated_at DESC"
        )
        .all() as {
            id: string;
            title: string;
            tags: string;
            created_at: string;
            updated_at: string;
        }[];

    return rows.map((row) => ({
        id: row.id,
        title: row.title,
        tags: JSON.parse(row.tags) as string[],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));
}

/**
 * Refresh model registry and auth storage after modifying providers or custom_models.
 * Regenerates models.json, refreshes the ModelRegistry singleton, and updates API keys.
 */
export function refreshModelsJson(): void {
    refreshModelRegistry();
}

/**
 * Get all custom model definitions from our DB.
 */
export function listCustomModels(): CustomModelDef[] {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM custom_models").all() as Record<string, unknown>[];

    return rows.map((m) => ({
        id: m.id as string,
        provider: m.provider as string,
        name: m.name as string,
        api: m.api as string,
        baseUrl: m.base_url as string,
        reasoning: !!m.reasoning,
        inputTypes: JSON.parse((m.input_types as string) || '["text"]'),
        contextWindow: m.context_window as number,
        maxTokens: m.max_tokens as number,
        cost: {
            input: m.cost_input as number,
            output: m.cost_output as number,
            cacheRead: m.cost_cache_read as number,
            cacheWrite: m.cost_cache_write as number,
        },
        compat: m.compat ? JSON.parse(m.compat as string) : undefined,
    }));
}

/**
 * Add or update a custom model in our DB.
 * Validates that the model ID doesn't already exist under a different provider
 * (in either custom models or built-in models from pi's registry).
 *
 * @throws Error if the model ID already exists under a different provider
 */
export function upsertCustomModel(model: CustomModelDef): void {
    // Validate model ID uniqueness — each model ID can only belong to one provider
    const db = getDb();
    const existing = db.prepare("SELECT provider FROM custom_models WHERE id = ?").get(model.id) as
        | { provider: string }
        | undefined;
    if (existing && existing.provider !== model.provider) {
        throw new Error(
            `Model ID "${model.id}" is already registered under provider "${existing.provider}". ` +
            `Model IDs must be unique — each model ID can only belong to one provider.`
        );
    }

    db.prepare(
        `INSERT INTO custom_models (id, provider, name, api, base_url, reasoning, input_types, context_window, max_tokens, cost_input, cost_output, cost_cache_read, cost_cache_write, compat)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider = excluded.provider,
       name = excluded.name,
       api = excluded.api,
       base_url = excluded.base_url,
       reasoning = excluded.reasoning,
       input_types = excluded.input_types,
       context_window = excluded.context_window,
       max_tokens = excluded.max_tokens,
       cost_input = excluded.cost_input,
       cost_output = excluded.cost_output,
       cost_cache_read = excluded.cost_cache_read,
       cost_cache_write = excluded.cost_cache_write,
       compat = excluded.compat`
    ).run(
        model.id,
        model.provider,
        model.name,
        model.api,
        model.baseUrl,
        model.reasoning ? 1 : 0,
        JSON.stringify(model.inputTypes),
        model.contextWindow,
        model.maxTokens,
        model.cost.input,
        model.cost.output,
        model.cost.cacheRead,
        model.cost.cacheWrite,
        model.compat ? JSON.stringify(model.compat) : null
    );
}

/**
 * Delete a custom model from our DB.
 * Only requires the model ID — provider is implicit from the unique ID.
 */
export function deleteCustomModel(id: string): void {
    const db = getDb();
    db.prepare("DELETE FROM custom_models WHERE id = ?").run(id);
}
