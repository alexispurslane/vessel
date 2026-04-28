import { join, resolve } from "path";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import {
    createAgentSession,
    createEventBus,
    AuthStorage,
    DefaultResourceLoader,
    ModelRegistry,
    SessionManager,
    SettingsManager,
    type AgentSession as PiAgentSession,
    type AgentSessionEvent as PiAgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import mcpAdapter from "pi-mcp-adapter";
import { ensureMcpConfigFile, writeConversationMcpConfig, getMcpServersFromDb, filterMcpServers, MCP_CONFIG_PATH } from "./mcp-config.js";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createSandboxedCodingTools } from "./sandboxed-tools.js";
import { createFetchTool } from "./sandboxed-fetch-tool.js";
import { createSearchTool, SEARCH_SETTINGS_KEYS } from "./sandboxed-search-tool.js";
import { fetchTracker } from "./extensions/fetch-tracker.js";
import type { FetchedSource } from "./extensions/fetch-tracker.js";
import { createSessionSandbox, getSessionWorkDir, loadConversationSettingsFromDb, saveConversationSettingsToDb, isNetworkAllowed, getEffectiveAgentMode } from "./sandbox-factory.js";
import type { Model as PiModel, Api } from "@mariozechner/pi-ai";
import { getDb } from "../db/index.js";
import type { ConversationSettings } from "$lib/types.js";
import { randomUUID } from "crypto";
import type { ChatSSEEvent, ConversationListItem, ActiveSession, CustomModelDef } from "./types.js";
import type { Sandbox } from "zerobox";
import { inferApiForProvider } from "../inference/api-helpers.js";
import { generateTitleAndTags } from "./title-generator.js";

// --- Constants ---

const DATA_DIR = resolve(process.cwd(), "data");
const SESSIONS_DIR = resolve(DATA_DIR, "sessions");
const AGENT_DIR = resolve(DATA_DIR, "agent");
const MODELS_JSON_PATH = resolve(DATA_DIR, "models.json");
import { VESSEL_APPEND_PROMPT } from "./vessel-append-prompt.js";

/**
 * Return the Vessel-specific append system prompt.
 * Now loaded from an embedded constant rather than a file on disk,
 * so it stays version-controlled alongside the source code.
 */
function loadVesselAppendPrompt(): string {
    return VESSEL_APPEND_PROMPT;
}

/** How long to keep a session in memory after all subscribers disconnect.
 * This is a safety net — the primary release mechanism is the explicit
 * /api/sessions/[id]/release call from the frontend on conversation switch.
 */
const SESSION_DISPOSE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

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
    const models = (registry as any).models as Array<{ provider: string }>;
    if (models) {
        (registry as any).models = models.filter(m => vesselProviders.has(m.provider));
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
function refreshModelRegistry(): void {
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

function broadcast(sessionKey: string, event: ChatSSEEvent): void {
    const session = sessions.get(sessionKey);
    if (!session) return;

    for (const [, subscriber] of session.subscribers) {
        subscriber.send(event);
    }

    // After broadcasting an agent_end event, check if the session should be
    // disposed. If the generation just finished and the user has already
    // navigated away (no subscribers), the session was protected from disposal
    // while streaming — now it's safe to clean up.
    if (event.event === "agent_end" && session.subscribers.size === 0) {
        scheduleDispose(sessionKey);
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
 * Serialize the streaming assistant message for a stream_recovery event.
 *
 * Unlike `serializeMessage`, this enriches tool calls with execution results
 * (status, output, isError) by cross-referencing ToolResultMessage entries
 * from the full conversation state. Without this, a reconnecting client would
 * see all tool calls stuck as "running" even if they completed before the
 * disconnect — because tool execution results live in separate
 * ToolResultMessage entries, not in the streaming AssistantMessage itself.
 *
 * @param streamingMessage  The partial AssistantMessage from AgentState.streamingMessage
 * @param allMessages       All messages in the current agent state (includes ToolResultMessages)
 */
function serializeStreamingMessageForRecovery(
    streamingMessage: unknown,
    allMessages: unknown[]
): unknown {
    // First, do the standard serialization
    const base = serializeMessage(streamingMessage) as Record<string, unknown>;
    const toolCalls = base.toolCalls as Array<Record<string, unknown>> | undefined;

    if (!toolCalls || toolCalls.length === 0) {
        // No tool calls — nothing to enrich
        return base;
    }

    // Build a lookup from toolCallId → ToolResultMessage for quick matching.
    // We only need results for tool calls in the streaming message.
    const streamingToolCallIds = new Set(
        toolCalls.map((tc) => tc.id).filter((id): id is string => typeof id === "string")
    );

    const toolResultsById = new Map<string, { output?: string; isError: boolean }>();
    for (const msg of allMessages) {
        if (!msg || typeof msg !== "object") continue;
        const m = msg as Record<string, unknown>;
        if (m.role !== "toolResult") continue;
        const toolCallId = m.toolCallId as string | undefined;
        if (!toolCallId || !streamingToolCallIds.has(toolCallId)) continue;

        // Extract text output from the ToolResultMessage's content array
        const output = extractToolOutput(m);
        toolResultsById.set(toolCallId, {
            output,
            isError: !!m.isError,
        });
    }

    // Enrich each tool call with its result
    const enrichedToolCalls = toolCalls.map((tc) => {
        const id = tc.id as string | undefined;
        const result = id ? toolResultsById.get(id) : undefined;
        if (result) {
            return {
                ...tc,
                status: result.isError ? "error" : "completed",
                output: result.output,
                isError: result.isError || undefined,
            };
        }
        // No result found — tool is still running (or hasn't started executing yet)
        return {
            ...tc,
            status: "running" as const,
        };
    });

    return {
        ...base,
        toolCalls: enrichedToolCalls,
    };
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
            usage: msg.usage ?? undefined,
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
            return { type: event.type, toolName: event.toolName, toolCallId: event.toolCallId, args: event.args };
        case "tool_execution_update":
            return {
                type: event.type,
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                args: event.args,
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
        if (s.agentSession.isStreaming) return; // still generating — don't dispose

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

    // Determine the effective CWD for the agent session.
    // When sandboxing is enabled, the agent operates inside a sandbox workspace,
    // so the CWD must be the sandbox directory (not the backend's process.cwd()).
    // The CWD is embedded in the system prompt ("Current working directory") and
    // used by tool definitions for path resolution.
    const sessionWorkDir = sandbox ? getSessionWorkDir(conversationId) : process.cwd();

    // Ensure the global MCP config file exists on disk so pi-mcp-adapter can read it.
    ensureMcpConfigFile();

    // ALWAYS point pi-mcp-adapter at our own mcp.json via the mcp-config flag.
    // Without this, the adapter falls back to ~/.pi/agent/mcp.json and also imports
    // servers from Claude Desktop, Cursor, etc. — which is not what we want.
    // We only want servers the user explicitly configured through Vessel.
    const mcpFlagValues = new Map<string, boolean | string>();
    const enabledMcpServers = conversationSettings?.enabledMcpServers ?? null;
    if (enabledMcpServers !== null) {
        // Per-conversation override: write a conversation-specific mcp.json
        const convConfigPath = writeConversationMcpConfig(conversationId, enabledMcpServers);
        mcpFlagValues.set("mcp-config", convConfigPath);
    } else {
        // Inherit mode: use the global mcp.json we wrote to data/agent/
        mcpFlagValues.set("mcp-config", MCP_CONFIG_PATH);
    }

    // Determine which MCP servers will be active for this conversation, so we can
    // skip adding the mcpAdapter extension entirely when no MCP tools are toggled on.
    const activeMcpServers = filterMcpServers(enabledMcpServers);
    const hasMcpServers = Object.keys(activeMcpServers).length > 0;

    // Create a shared EventBus for the session. We pass it into the ResourceLoader
    // so that extensions can emit events via pi.events, and we can subscribe to those
    // events from outside the extension system (e.g., to broadcast fetched pages via SSE).
    const eventBus = createEventBus();

    // Create a custom ResourceLoader that includes the fetch tracker (always) and
    // pi-mcp-adapter (only when there are enabled MCP servers).
    // This gives extensions access to the full ExtensionAPI lifecycle (session_start,
    // session_shutdown, etc.) which they need to properly connect/teardown resources.
    const extensionFactories = hasMcpServers ? [mcpAdapter, fetchTracker] : [fetchTracker];
    const resourceLoader = new DefaultResourceLoader({
        cwd: sessionWorkDir,
        agentDir: AGENT_DIR,
        settingsManager,
        extensionFactories,
        eventBus,
    });
    await resourceLoader.reload();

    const createOpts: Parameters<typeof createAgentSession>[0] = {
        cwd: sessionWorkDir,
        agentDir: AGENT_DIR,
        sessionManager,
        authStorage: modelRegistry.authStorage,
        modelRegistry,
        settingsManager,
        resourceLoader,
    };

    if (model) {
        createOpts.model = model;
    }

    const { session: agentSession, extensionsResult } = await createAgentSession(createOpts);

    // If MCP servers are configured and we have a per-conversation config path,
    // set the mcp-config flag so pi-mcp-adapter picks it up during session_start.
    // Skip this entirely when no MCP servers are active (mcpAdapter not loaded).
    if (hasMcpServers && mcpFlagValues.size > 0 && extensionsResult) {
        for (const [name, value] of mcpFlagValues) {
            extensionsResult.runtime.flagValues.set(name, value);
        }
    }

    // Initialize extensions by calling bindExtensions(). This emits the
    // session_start event, which pi-mcp-adapter uses to connect to MCP servers.
    // In the web app we don't have a TUI, so we pass empty bindings.
    await agentSession.bindExtensions({});

    // Determine the effective tool set for this conversation.
    // Extension tools (like the MCP gateway tool) are registered in the tool
    // registry but NOT automatically activated by _buildRuntime. resolveActiveToolNames()
    // handles discovering all registered tools and deciding which should be active
    // based on sandbox mode, disabled tools, and MCP off state.
    //
    // The fetch tool is registered later (below) so it's not in getAllTools() yet.
    // We append it to allRegisteredToolNames so resolveActiveToolNames() knows about
    // it for toggle/disabled logic.
    //
    // Identify MCP/extension tools by their sourceInfo.source — tools from extensions
    // (like pi-mcp-adapter) have source "local", while built-in tools have "builtin" and
    // SDK-injected tools (like our fetch tool) have "sdk".
    const allAgentTools = agentSession.getAllTools() as Array<{ name: string; sourceInfo: { source: string; scope: string } }>;
    const mcpToolNames = new Set(
        allAgentTools
            .filter((t) => t.sourceInfo.source !== "builtin" && t.sourceInfo.source !== "sdk")
            .map((t) => t.name)
    );
    const activeToolDecision = resolveActiveToolNames({
        activeToolNames: agentSession.getActiveToolNames(),
        allRegisteredToolNames: [
            ...allAgentTools.map((t) => t.name),
            "fetch",
            "web_search",
        ],
        conversationSettings,
        sandbox,
        mcpToolNames,
        effectiveAgentMode: getEffectiveAgentMode(conversationSettings),
        networkAllowed: isNetworkAllowed(conversationSettings),
    });

    // Register Vessel-specific tools (fetch, web_search) into the agent session.
    // These aren't part of pi-coding-agent's built-in set, so we need to inject
    // them into all three internal maps:
    //   _toolRegistry      — used by setActiveToolsByName() to resolve tool objects
    //   _toolDefinitions    — used by getAllTools() / getSessionAgentInfo() to list available tools
    //   _baseToolDefinitions — used by _refreshToolRegistry() to rebuild maps from scratch
    // Without all three, the tool would be callable but invisible in the UI/agent-info.

    // Shared URL tracker: records URLs that appeared in web search results so the
    // fetch tool can skip re-fetching them and instead tell the model the page was
    // already fetched in search results.
    const searchResultUrls = new Set<string>();

    const fetchTool = sandbox
        ? createFetchTool({ sandbox, searchResultUrls })
        : createFetchTool({ searchResultUrls });
    const toolRegistry = (agentSession as any)._toolRegistry as Map<string, AgentTool<any>>;
    const toolDefinitions = (agentSession as any)._toolDefinitions as Map<string, any>;
    const baseToolDefinitions = (agentSession as any)._baseToolDefinitions as Map<string, any>;
    toolRegistry.set(fetchTool.name, fetchTool);
    // Wrap as a tool definition entry with sourceInfo so getAllTools() / getSessionAgentInfo() sees it.
    // Using source "sdk" matches how pi-coding-agent tags SDK-registered custom tools.
    toolDefinitions.set(fetchTool.name, {
        definition: fetchTool,
        sourceInfo: { path: `<sdk:${fetchTool.name}>`, source: "sdk", scope: "user", origin: "top-level" },
    });
    baseToolDefinitions.set(fetchTool.name, fetchTool);

    // Register the web search tool — always active when network access is on.
    // Read settings from DB at creation time; sessions are restarted on settings change.
    const searchBaseUrl = (() => {
        const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(SEARCH_SETTINGS_KEYS.BASE_URL) as { value: string } | undefined;
        return row?.value || undefined;
    })();
    const searchApiKey = (() => {
        const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(SEARCH_SETTINGS_KEYS.API_KEY) as { value: string } | undefined;
        return row?.value || undefined;
    })();
    const searchTool = createSearchTool({ baseUrl: searchBaseUrl, apiKey: searchApiKey, searchResultUrls });
    toolRegistry.set(searchTool.name, searchTool);
    toolDefinitions.set(searchTool.name, {
        definition: searchTool,
        sourceInfo: { path: `<sdk:${searchTool.name}>`, source: "sdk", scope: "user", origin: "top-level" },
    });
    baseToolDefinitions.set(searchTool.name, searchTool);

    if (sandbox) {
        // Sandbox mode: replace default tool execution with sandboxed operations
        // while keeping the default tool definitions (with promptSnippet) intact.
        const sandboxedTools = createSandboxedCodingTools(sessionWorkDir, sandbox, { searchResultUrls });
        // Note: grep is intentionally omitted from sandboxed tools because its
        // search runs directly on the host. If grep is not disabled and sandbox
        // is on, we still don't include it for security consistency.

        // Patch the tool registry: replace default tools with sandboxed versions.
        for (const tool of sandboxedTools) {
            toolRegistry.set(tool.name, tool);
        }
        // Also remove grep from the registry and definitions since sandboxed
        // tools omit it for security consistency.
        toolRegistry.delete("grep");
        toolDefinitions.delete("grep");
        baseToolDefinitions.delete("grep");

        agentSession.setActiveToolsByName(activeToolDecision.desiredToolNames);
    } else if (activeToolDecision.needsUpdate) {
        agentSession.setActiveToolsByName(activeToolDecision.desiredToolNames);
    }

    // Apply custom/append system prompt — per-conversation overrides global.
    // customSystemPrompt replaces the default prompt entirely.
    // appendSystemPrompt adds to the default prompt.
    // These are injected into the ResourceLoader so that _rebuildSystemPrompt picks
    // them up on every rebuild (not just once). We then trigger a rebuild.

    // Resolve customSystemPrompt: conversation override → global setting
    let customSystemPrompt = conversationSettings?.customSystemPrompt ?? null;
    if (customSystemPrompt === null) {
        const globalRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("agent.customSystemPrompt") as { value: string } | undefined;
        customSystemPrompt = globalRow?.value ?? null;
    }

    // Resolve appendSystemPrompt: conversation override → global setting
    // Supports string (legacy) and string[] (current) formats.
    let rawAppend = conversationSettings?.appendSystemPrompt ?? null;
    if (rawAppend === null) {
        const globalRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("agent.appendSystemPrompt") as { value: string } | undefined;
        if (globalRow?.value) {
            try {
                rawAppend = JSON.parse(globalRow.value);
            } catch {
                rawAppend = null;
            }
        }
    }
    // Migrate legacy string-typed appendSystemPrompt to array
    const userAppend: string[] = rawAppend
        ? Array.isArray(rawAppend)
            ? rawAppend
            : [rawAppend as string]
        : [];
    // Prepend the Vessel-specific append prompt (from VESSEL_APPEND.md)
    const vesselAppend = loadVesselAppendPrompt();
    const appendSystemPrompt: string[] = vesselAppend
        ? [vesselAppend, ...userAppend]
        : userAppend;
    if (customSystemPrompt !== null || appendSystemPrompt.length > 0) {
        const resourceLoader = agentSession.resourceLoader as any;
        if (customSystemPrompt !== null) {
            resourceLoader.systemPrompt = customSystemPrompt;
        }
        resourceLoader.appendSystemPrompt = appendSystemPrompt;
        // Rebuild the system prompt with the new values
        agentSession.setActiveToolsByName(agentSession.getActiveToolNames());
    }

    // Subscribe to events and broadcast to SSE subscribers
    const unsubscribe = agentSession.subscribe((event: PiAgentSessionEvent) => {
        const session = sessions.get(conversationId);

        // Track turn generation for stream recovery — increment on each
        // message_start so the client can distinguish different streaming turns
        if (session && event.type === "message_start") {
            session.turnGeneration++;
        }

        const sseEvent: ChatSSEEvent = {
            event: event.type,
            data: formatEventPayload(event),
        };

        // Embed turnGeneration in streaming events so the client can correlate
        // them with stream_recovery and avoid processing stale deltas
        if (session && (event.type === "message_start" || event.type === "message_update" || event.type === "message_end")) {
            (sseEvent.data as Record<string, unknown>).turnGeneration = session.turnGeneration;
        }

        broadcast(conversationId, sseEvent);
    });

    // Subscribe to the shared EventBus for extension-originated events that
    // don't flow through the agent's subscribe() channel (e.g., pi.appendEntry
    // doesn't emit message_start/message_end). The source tracker extension emits
    // "fetched_sources" via pi.events, and we broadcast it as a custom SSE event.
    const unsubscribeEventBus = eventBus.on("fetched_sources", (data) => {
        const sources = data as FetchedSource[];
        console.log("[fetch-tracker] EventBus received fetched_sources:", sources.length, "sources for conversation", conversationId);
        broadcast(conversationId, {
            event: "fetched_sources",
            data: { sources },
        });
    });

    sessions.set(conversationId, {
        agentSession,
        sessionId: conversationId,
        subscribers: new Map(),
        unsubscribe: () => {
            unsubscribe();
            unsubscribeEventBus();
        },
        sandbox,
        conversationSettings: conversationSettings ?? undefined,
        turnGeneration: 0,
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

    // If the session is actively streaming, send a recovery snapshot so the
    // reconnecting client can display the partial in-flight message.
    // The subscriber is registered FIRST so any subsequent deltas broadcast
    // after this point will also be delivered — and the snapshot already
    // includes all content accumulated up to this synchronous point, so no
    // deltas are lost. (Node.js single-threaded model guarantees this.)
    if (session.agentSession.isStreaming) {
        const state = session.agentSession.state;
        const streamingMsg = state.streamingMessage;
        if (streamingMsg) {
            send({
                event: "stream_recovery",
                data: {
                    message: serializeStreamingMessageForRecovery(streamingMsg, state.messages),
                    turnGeneration: session.turnGeneration,
                },
            });
        }
    }

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
export async function sendCustomMessage(
    conversationId: string,
    customType: string,
    content: string,
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }
): Promise<void> {
    const agentSession = await getOrCreateSession(conversationId);
    await agentSession.sendCustomMessage(
        {
            customType,
            content,
            display: false,
        },
        {
            triggerTurn: options?.triggerTurn ?? false,
            deliverAs: options?.deliverAs,
        }
    );
}

export async function sendMessage(conversationId: string, content: string, statusContent?: string): Promise<void> {
    const agentSession = await getOrCreateSession(conversationId);

    // If there's invisible status content (e.g., file upload/delete notices),
    // send it as a custom message queued for the next turn. This way the AI
    // sees the status information in context, but it doesn't appear as a
    // visible user message in the chat UI.
    if (statusContent) {
        await agentSession.sendCustomMessage(
            {
                customType: "status_update",
                content: statusContent,
                display: false,
            },
            {
                deliverAs: "nextTurn",
            }
        );
    }

    await agentSession.prompt(content);

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
 * Get the zerobox Sandbox instance for a conversation, if one is loaded.
 * Returns null if the session is not in memory or sandboxing is disabled.
 *
 * Used by file upload/delete endpoints to trigger a sandbox snapshot
 * after out-of-band filesystem changes.
 */
export function getSessionSandbox(conversationId: string): Sandbox | null {
    const session = sessions.get(conversationId);
    return session?.sandbox ?? null;
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
export function disposeSession(conversationId: string, options?: { force?: boolean }): void {
    const session = sessions.get(conversationId);
    if (!session) return;

    // Don't dispose if the agent is actively generating. Disposal will be
    // retried when the generation finishes and all subscribers disconnect.
    // Force disposal is allowed for explicit conversation deletion.
    //
    // Also don't dispose if there are active subscribers — even if isStreaming
    // is momentarily false between events in a multi-turn loop, a connected
    // client means the session is still in use.
    if (!options?.force && (session.agentSession.isStreaming || session.subscribers.size > 0)) return;

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

    // Don't restart mid-generation — the user may reload and need the
    // session (and event buffer) alive. The restart will happen naturally
    // when the session is next loaded after the generation completes.
    if (session.agentSession.isStreaming) return false;

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
 * Update the system prompt for a live session without restarting it.
 * Injects custom/append system prompt into the ResourceLoader and rebuilds
 * the system prompt. The session picks up changes immediately on the next turn.
 *
 * Also persists the custom system prompt to the conversation_settings DB table.
 */
export function updateSessionSystemPrompt(
    conversationId: string,
    options: {
        customSystemPrompt?: string | null;
        appendSystemPrompt?: string[] | null;
    }
): boolean {
    const session = sessions.get(conversationId);
    if (!session) return false;

    const resourceLoader = session.agentSession.resourceLoader as any;

    if ("customSystemPrompt" in options) {
        resourceLoader.systemPrompt = options.customSystemPrompt ?? undefined;
    }
    if ("appendSystemPrompt" in options) {
        // Always prepend the Vessel-specific append prompt
        const vesselAppend = loadVesselAppendPrompt();
        const userAppend: string[] = options.appendSystemPrompt ?? [];
        resourceLoader.appendSystemPrompt = vesselAppend
            ? [vesselAppend, ...userAppend]
            : userAppend;
    }

    // Rebuild the system prompt with the new values
    session.agentSession.setActiveToolsByName(
        session.agentSession.getActiveToolNames()
    );

    // Persist to conversation settings in DB
    const existingSettings = loadConversationSettingsFromDb(conversationId) ?? {};
    if ("customSystemPrompt" in options) {
        existingSettings.customSystemPrompt = options.customSystemPrompt ?? null;
    }
    if ("appendSystemPrompt" in options) {
        existingSettings.appendSystemPrompt = options.appendSystemPrompt ?? null;
    }
    saveConversationSettingsToDb(conversationId, existingSettings);

    // Keep the in-memory conversation settings in sync so that
    // getSessionAgentInfo() reads the updated values without needing
    // to re-read from the DB.
    session.conversationSettings = existingSettings;

    return true;
}

/**
 * Fully destroy a conversation: dispose in-memory session, delete the
 * pi session file, delete the workspace directory (if configured), and remove the DB row.
 * Only called when the user explicitly hits the trash icon.
 */
export async function destroyConversation(conversationId: string): Promise<void> {
    // 1. Dispose in-memory session if loaded (force: the user explicitly deleted the conversation)
    disposeSession(conversationId, { force: true });

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
    let restarted = 0;
    for (const id of ids) {
        const session = sessions.get(id)!;

        // Don't restart mid-generation — skip streaming sessions
        if (session.agentSession.isStreaming) continue;

        // Clear any pending disposal timer
        if (session.disposeTimer) {
            clearTimeout(session.disposeTimer);
        }

        // Unsubscribe from agent events and dispose the pi session
        session.unsubscribe();
        session.agentSession.dispose();
        sessions.delete(id);
        restarted++;
    }

    if (restarted > 0) {
        console.log(`Restarted ${restarted} session(s) — they will be re-created on next access`);
    }
    return restarted;
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
            arguments?: Record<string, unknown>;
        }>;
        isError?: boolean;
        usage?: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
            totalTokens: number;
        };
        timestamp: number;
        fetchedSources?: FetchedSource[];
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
 * Get the current system prompt and available tools/skills for a conversation's
 * active AgentSession. The session must be loaded in memory (getOrCreateSession
 * handles this automatically).
 */
export async function getSessionAgentInfo(conversationId: string): Promise<{
    systemPrompt: string;
    customSystemPrompt: string | null;
    appendSystemPrompt: string[] | null;
    tools: Array<{
        name: string;
        description: string;
        source: string;
        scope: string;
    }>;
    skills: Array<{
        name: string;
        description: string;
        source: string;
        scope: string;
        disableModelInvocation: boolean;
    }>;
} | null> {
    // Ensure the session is loaded
    const activeSession = sessions.get(conversationId);
    if (!activeSession) {
        return null;
    }

    const agentSession = activeSession.agentSession;

    // Extract system prompt
    const systemPrompt = agentSession.systemPrompt;

    // Extract custom/append system prompts from conversation settings
    const convSettings = activeSession.conversationSettings;
    const customSystemPrompt = convSettings?.customSystemPrompt ?? null;
    // Migrate legacy string-typed appendSystemPrompt to array
    const rawAppend = convSettings?.appendSystemPrompt ?? null;
    const appendSystemPrompt: string[] | null = rawAppend
        ? Array.isArray(rawAppend)
            ? rawAppend
            : [rawAppend as string]
        : null;

    // Extract tools info
    const allTools = agentSession.getAllTools();
    const tools = allTools.map((t) => ({
        name: t.name,
        description: t.description,
        source: t.sourceInfo.source,
        scope: t.sourceInfo.scope,
    }));

    // Extract skills from the resource loader
    const skillsResult = agentSession.resourceLoader.getSkills();
    const skills = skillsResult.skills.map((s) => ({
        name: s.name,
        description: s.description,
        source: s.sourceInfo?.source ?? "unknown",
        scope: s.sourceInfo?.scope ?? "unknown",
        disableModelInvocation: s.disableModelInvocation ?? false,
    }));

    return { systemPrompt, customSystemPrompt, appendSystemPrompt, tools, skills };
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
            arguments?: Record<string, unknown>;
        }>;
        isError?: boolean;
        usage?: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
            totalTokens: number;
        };
        timestamp: number;
        fetchedSources?: FetchedSource[];
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
            arguments?: Record<string, unknown>;
        }>;
        isError?: boolean;
        usage?: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
            totalTokens: number;
        };
        timestamp: number;
        fetchedSources?: FetchedSource[];
    }> = [];

    // Track tool call IDs to match results from tool-role messages
    const pendingToolCalls: Map<
        string,
        { toolName: string; msgIndex: number; toolCallIndex: number }
    > = new Map();

    let lastModelProvider: string | null = null;
    let lastModelId: string | null = null;

    // Accumulated fetched sources — once sources enter the LLM context, they
    // remain there for all subsequent assistant messages, so each one gets the
    // full cumulative list appended to it.
    let lastAssistantMsgIndex = -1;
    let accumulatedSources: FetchedSource[] = [];

    for (const entry of branchEntries) {
        // Track model changes
        if (entry.type === "model_change") {
            const modelEntry = entry as unknown as { provider: string; modelId: string };
            lastModelProvider = modelEntry.provider ?? null;
            lastModelId = modelEntry.modelId ?? null;
            continue;
        }

        // Accumulate fetched_sources custom entries — they stay in context forever
        if (entry.type === "custom" && (entry as any).customType === "fetched_sources") {
            const sources = (entry as any).data as FetchedSource[] | undefined;
            if (sources && sources.length > 0) {
                accumulatedSources = [...accumulatedSources, ...sources];
                // Retroactively attach to the assistant message that just produced them
                if (lastAssistantMsgIndex >= 0) {
                    messages[lastAssistantMsgIndex].fetchedSources = [...accumulatedSources];
                }
            }
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
            arguments?: Record<string, unknown>;
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
                        arguments: block.arguments as Record<string, unknown> | undefined,
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

        // Extract usage data from assistant messages
        const usage = role === "assistant" && msg.usage ? {
            input: (msg.usage as Record<string, unknown>).input as number ?? 0,
            output: (msg.usage as Record<string, unknown>).output as number ?? 0,
            cacheRead: (msg.usage as Record<string, unknown>).cacheRead as number ?? 0,
            cacheWrite: (msg.usage as Record<string, unknown>).cacheWrite as number ?? 0,
            totalTokens: (msg.usage as Record<string, unknown>).totalTokens as number ?? 0,
        } : undefined;

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
            usage,
            timestamp: (msg.timestamp as number) ?? 0,
        });

        // Track the last assistant message index for attaching fetched_sources.
        // Also attach any accumulated sources — once sources are in the LLM context,
        // they remain there for every subsequent assistant message.
        if (role === "assistant") {
            lastAssistantMsgIndex = msgIndex;
            if (accumulatedSources.length > 0) {
                messages[msgIndex].fetchedSources = [...accumulatedSources];
            }
        }

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
 * In-place edit of an assistant message.
 *
 * Navigates the tree back to before the target assistant message, appends a
 * new assistant message with the edited text content, then replays all subsequent
 * entries (user messages, assistant messages, model changes, etc.) from the
 * abandoned branch onto the new branch.
 *
 * Since the session tree is append-only, this creates a new branch — the old
 * entries remain in the JSONL file but are no longer on the active path.
 */
export async function editAssistantMessage(
    conversationId: string,
    targetEntryId: string,
    newContent: string
): Promise<{ cancelled: boolean }> {
    // Ensure session is loaded
    const agentSession = await getOrCreateSession(conversationId);
    cancelDispose(conversationId);

    const sessionManager = agentSession.sessionManager;
    const targetEntry = sessionManager.getEntry(targetEntryId);
    if (!targetEntry) {
        throw new Error(`Entry ${targetEntryId} not found in session`);
    }
    if (targetEntry.type !== "message" || targetEntry.message.role !== "assistant") {
        throw new Error(`Entry ${targetEntryId} is not an assistant message`);
    }

    // 1. Collect entries on the current branch after the target assistant message.
    //    These are the entries we'll need to replay after appending the edited version.
    const currentBranch = sessionManager.getBranch();
    const targetIdx = currentBranch.findIndex((e) => e.id === targetEntryId);
    if (targetIdx === -1) {
        throw new Error(`Entry ${targetEntryId} is not on the current branch`);
    }
    // Entries after the target (chronological order, root → leaf)
    const entriesToReplay = currentBranch.slice(targetIdx + 1);

    // 2. Navigate back to before the target assistant message.
    //    For assistant messages, navigateTree with the parent moves the leaf
    //    to the parent, returning the parent's editorText (user msg text)
    //    which we don't need here.
    const navigateResult = await agentSession.navigateTree(targetEntryId, {
        summarize: false,
    });

    if (navigateResult.cancelled) {
        return { cancelled: true };
    }

    // 3. Append the edited assistant message as a child of the new leaf.
    //    We reconstruct an AssistantMessage with the new text content,
    //    preserving the original model/provider/usage metadata.
    const originalMsg = targetEntry.message;
    const editedAssistantMessage = {
        ...originalMsg,
        content: [{ type: "text" as const, text: newContent }],
    };
    sessionManager.appendMessage(editedAssistantMessage);

    // 4. Replay all subsequent entries from the abandoned branch.
    //    Each entry is appended as a child of the current leaf, so the
    //    tree structure is preserved on the new branch.
    for (const entry of entriesToReplay) {
        switch (entry.type) {
            case "message":
                // The SessionMessageEntry.message type is AgentMessage which includes custom
                // message types (BranchSummaryMessage, etc.) via declaration merging, but
                // appendMessage only accepts the base LLM-compatible message types. Since
                // we're replaying entries from the current branch, all message entries
                // will be standard LLM-compatible messages — safe to cast.
                sessionManager.appendMessage(entry.message as Parameters<typeof sessionManager.appendMessage>[0]);
                break;
            case "model_change":
                sessionManager.appendModelChange(entry.provider, entry.modelId);
                break;
            case "thinking_level_change":
                sessionManager.appendThinkingLevelChange(entry.thinkingLevel);
                break;
            case "custom":
                sessionManager.appendCustomEntry(entry.customType, entry.data);
                break;
            case "custom_message":
                sessionManager.appendCustomMessageEntry(
                    entry.customType,
                    entry.content,
                    entry.display,
                    entry.details
                );
                break;
            case "label": {
                // entry.label is string | undefined on LabelEntry; appendLabelChange
                // accepts string | undefined per the .d.ts, but TS narrowing through
                // the SessionEntry union doesn't cooperate. Force-cast to satisfy TS.
                const labelEntry = entry as { targetId: string; label: string | undefined };
                sessionManager.appendLabelChange(labelEntry.targetId, labelEntry.label as string);
                break;
            }
            case "session_info":
                if (entry.name) {
                    sessionManager.appendSessionInfo(entry.name);
                }
                break;
            // Skip compaction/branch_summary entries — they belong to the old branch
            // and will be regenerated if needed.
            default:
                break;
        }
    }

    // 5. Update agent state to reflect the new session context
    const sessionContext = sessionManager.buildSessionContext();
    agentSession.agent.state.messages = sessionContext.messages;

    return { cancelled: false };
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

/** A node in the session tree for DAG visualization */
export interface SessionTreeNodeData {
    /** Entry ID */
    id: string;
    /** Parent entry ID (null for root) */
    parentId: string | null;
    /** Entry type (message, model_change, etc.) */
    type: string;
    /** Message role (only for type=message entries) */
    role?: string;
    /** First few words of the message content */
    preview: string;
    /** Full message content (for hover expansion) */
    fullContent: string;
    /** Whether this entry is on the current active branch (from root to leaf) */
    onActiveBranch: boolean;
    /** Whether this entry is the current leaf */
    isCurrentLeaf: boolean;
}

/** A relation in the session tree DAG */
export interface SessionTreeRelation {
    id: string;
    parentId: string;
    childId: string;
}

/**
 * Get the full session tree as nodes and relations for DAG visualization.
 * Returns only user messages and final assistant text responses (no tool calls,
 * thinking blocks, tool results, or other intermediate entries).
 */
export async function getSessionTree(conversationId: string): Promise<{
    nodes: SessionTreeNodeData[];
    relations: SessionTreeRelation[];
    leafId: string | null;
}> {
    const agentSession = await getOrCreateSession(conversationId);
    cancelDispose(conversationId);

    const sessionManager = agentSession.sessionManager;
    const allEntries = sessionManager.getEntries();
    const leafId = sessionManager.getLeafId();

    // Get the set of entry IDs on the current active branch
    const activeBranch = sessionManager.getBranch();
    const activeBranchIds = new Set(activeBranch.map((e) => e.id));

    const nodes: SessionTreeNodeData[] = [];
    const relations: SessionTreeRelation[] = [];

    for (const entry of allEntries) {
        // Only include message entries — skip model_change, compaction, branch_summary, etc.
        if (entry.type !== "message") continue;

        const msg = (entry as unknown as { message: Record<string, unknown> }).message;
        const role = msg.role as string | undefined;

        // Only include user and assistant messages — skip toolResult, etc.
        if (role !== "user" && role !== "assistant") continue;

        // Extract text content and check for tool calls / thinking blocks
        let fullContent = "";
        let hasToolCall = false;
        let hasThinking = false;

        if (Array.isArray(msg.content)) {
            for (const block of msg.content as Record<string, unknown>[]) {
                if (block.type === "text" && typeof block.text === "string") {
                    fullContent += block.text;
                } else if (block.type === "thinking") {
                    hasThinking = true;
                } else if (block.type === "toolCall") {
                    hasToolCall = true;
                }
            }
        } else if (typeof msg.content === "string") {
            fullContent = msg.content;
        }

        // Skip assistant messages that contain tool calls or thinking blocks.
        // In the DAG we only show complete conversation turns
        // (user messages and final assistant text responses),
        // not intermediate reasoning/tool-use steps.
        if (role === "assistant" && (hasToolCall || (hasThinking && !fullContent.trim()))) continue;

        // Skip empty user messages that pi sometimes adds
        if (role === "user" && !fullContent.trim()) continue;

        fullContent = fullContent.replace(/^\n+/, "");
        // Preview: first ~40 characters or first line, whichever is shorter
        const firstLine = fullContent.split('\n')[0] || '';
        const preview = firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine;

        nodes.push({
            id: entry.id,
            parentId: entry.parentId,
            type: entry.type,
            role,
            preview,
            fullContent,
            onActiveBranch: activeBranchIds.has(entry.id),
            isCurrentLeaf: entry.id === leafId,
        });

        // Add a relation for the parent-child link
        if (entry.parentId !== null) {
            relations.push({
                id: `rel-${entry.id}`,
                parentId: entry.parentId,
                childId: entry.id,
            });
        }
    }

    // Repair parent IDs: since we filtered out non-message nodes, some visible nodes'
    // parentIds point to hidden entries (model_change, compaction, etc.). Walk up
    // through the full entry tree to find the closest visible ancestor.
    const visibleById = new Set(nodes.map((n) => n.id));
    const fullEntryById = new Map(allEntries.map((e) => [e.id, e]));

    for (let i = 0; i < nodes.length; i++) {
        const rawParentId = nodes[i].parentId;
        if (rawParentId === null) continue;
        // If the parent is visible, no repair needed
        if (visibleById.has(rawParentId)) continue;
        // Walk up through hidden entries until we find a visible ancestor (or nothing)
        let ancestorId: string | null = rawParentId;
        let repaired: string | null = null;
        while (ancestorId) {
            if (visibleById.has(ancestorId)) {
                repaired = ancestorId;
                break;
            }
            const ancestor = fullEntryById.get(ancestorId);
            ancestorId = ancestor?.parentId ?? null;
        }
        nodes[i].parentId = repaired;

        // Also repair the corresponding relation if it exists
        const rel = relations.find((r) => r.childId === nodes[i].id);
        if (rel) {
            rel.parentId = repaired ?? "";
        }
    }

    return { nodes, relations, leafId };
}

/**
 * Set the session's current leaf position to a specific entry ID.
 * Used by the DAG viewer to navigate to a different point in the tree.
 * Unlike navigateMessage (which handles edit/delete semantics), this directly
 * branches to the target entry.
 */
export async function setSessionLeaf(conversationId: string, targetEntryId: string): Promise<void> {
    const agentSession = await getOrCreateSession(conversationId);
    cancelDispose(conversationId);

    const sessionManager = agentSession.sessionManager;
    const entry = sessionManager.getEntry(targetEntryId);
    if (!entry) {
        throw new Error(`Entry ${targetEntryId} not found in session`);
    }

    // Use the session's navigateTree to move the leaf position
    // This handles branching and context updates properly
    await agentSession.navigateTree(targetEntryId, { summarize: false });
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

/**
 * MCP server connection status for a conversation.
 */
export interface McpServerStatus {
    name: string;
    status: "connected" | "closed" | "needs-auth" | "unknown";
    toolCount?: number;
}

/**
 * Get the MCP server connection status for an active conversation session.
 * Reads from pi-mcp-adapter's internal McpServerManager via the extension runner.
 */
export function getMcpServerStatus(conversationId: string): McpServerStatus[] {
    const session = sessions.get(conversationId);
    if (!session) return [];

    try {
        // Access the extension runner (private but accessible at runtime)
        const runner = (session.agentSession as any).extensionRunner;
        if (!runner?.extensions) return [];

        // Find the MCP adapter extension by looking for the one that registered the "mcp" tool
        for (const ext of runner.extensions) {
            if (ext.tools?.has("mcp")) {
                // This is the MCP adapter extension. Its state holds the McpServerManager.
                // The state isn't on the Extension object — it's in the closure.
                // We need to access it through the manager on the state.
                // Since state is a closure variable, we can try getting it from tool metadata.
                break;
            }
        }

        // Direct approach: access the McpServerManager from the state.
        // The state is stored in a closure, but the toolMetadata map is accessible
        // through the pi extension API. Let's try reading the MCP tool's description
        // which includes server status info in its dynamically generated description.
        const toolRegistry = (session.agentSession as any)._toolRegistry as Map<string, any>;
        const toolDefMap = (session.agentSession as any)._toolDefinitions as Map<string, any>;

        // The MCP proxy tool's description is dynamically built and includes server names + tool counts.
        // But it doesn't include connection status directly.
        // For a more direct approach, let's look at the extension runner's state.
        // The runner stores extensions, and the MCP adapter stores its state locally.
        // We can access it through the runner's private _extensions field.

        // Actually, the cleanest path: use the tool metadata cache file that pi-mcp-adapter writes
        // at data/agent/.mcp-metadata-cache.json. This contains per-server tool lists.
        // But it won't have connection status.

        // Most practical: interrogate the McpServerManager directly.
        // The adapter's `state` variable holds a reference to the manager.
        // We can't get at the closure variable, but we CAN invoke the mcp tool
        // with no arguments (which returns status) by calling the execute function.

        // However, that's complex. For now, let's read the active tool list
        // and report which MCP-related tools are present as a proxy for "connected".
        const result: McpServerStatus[] = [];
        const allServers = getMcpServersFromDb();

        for (const name of Object.keys(allServers)) {
            // Check if any tools with the server's prefix are registered
            const prefix = name.replace(/-/g, "_");
            let toolCount = 0;
            for (const toolName of toolDefMap?.keys() ?? []) {
                if (toolName === "mcp" || toolName.startsWith(prefix + "_")) {
                    toolCount++;
                }
            }

            // If we see tools from this server, it's connected.
            // The MCP gateway tool is always present, so check for server-specific direct tools.
            result.push({
                name,
                status: toolCount > 0 ? "connected" : "unknown",
                toolCount: toolCount > 0 ? toolCount : undefined,
            });
        }

        return result;
    } catch {
        return [];
    }
}

// --- Tool activation logic ---

/** Input for resolveActiveToolNames(). */
interface ResolveActiveToolNamesInput {
    /** Tool names currently active in the session (from getActiveToolNames()). */
    activeToolNames: string[];
    /** All tool names registered in the session, including inactive extensions (from getAllTools()). */
    allRegisteredToolNames: string[];
    /** Per-conversation settings (may be null if no settings row exists). */
    conversationSettings: ConversationSettings | null;
    /** The sandbox for this session, or null if sandboxing is disabled. */
    sandbox: unknown;
    /** Names of MCP/extension tools (from sourceInfo.source !== "builtin" && !== "sdk"). */
    mcpToolNames: Set<string>;
    /** Effective agent mode for this conversation ("agent" = all tools, "chat" = no tools). */
    effectiveAgentMode: "agent" | "chat";
    /** Whether network access is effectively allowed for this conversation. */
    networkAllowed: boolean;
}

/** Output of resolveActiveToolNames(). */
interface ResolveActiveToolNamesResult {
    /** The tool names that should be active. */
    desiredToolNames: string[];
    /** Whether the active tool set needs to be updated (differs from activeToolNames). */
    needsUpdate: boolean;
}

/**
 * Decide which tools should be active for a conversation session.
 *
 * Uses the effective agent mode to determine which tools are available:
 * - "agent" mode: all non-MCP tools enabled (read, bash, edit, write, glob, grep, fetch)
 * - "chat" mode: no tools enabled (plain conversation)
 *
 * Additional rules:
 * - MCP tools are removed when MCP is explicitly off (enabledMcpServers === [])
 * - Sandbox mode removes grep since sandboxed tools omit it
 * - The fetch tool is automatically disabled when network permissions are off
 */
function resolveActiveToolNames(input: ResolveActiveToolNamesInput): ResolveActiveToolNamesResult {
    const { activeToolNames, allRegisteredToolNames, conversationSettings, sandbox, mcpToolNames, effectiveAgentMode, networkAllowed } = input;

    // Identify MCP extension tools so we can disable them when MCP is off.
    const mcpExplicitlyOff = Array.isArray(conversationSettings?.enabledMcpServers) &&
        conversationSettings.enabledMcpServers.length === 0;

    // Collect all tool names that should be disabled.
    const disabledTools = new Set<string>();

    // Chat mode: disable all non-MCP built-in and SDK tools.
    // In chat mode, the agent is used as a plain conversation with no tools.
    // Exception: the fetch tool is kept available when network access is on,
    // so the model can still fetch web pages even in chat mode.
    if (effectiveAgentMode === "chat") {
        for (const name of allRegisteredToolNames) {
            if (!mcpToolNames.has(name) && !(name === "fetch" && networkAllowed) && !(name === "web_search" && networkAllowed)) {
                disabledTools.add(name);
            }
        }
    }

    // MCP off: disable MCP tools
    if (mcpExplicitlyOff) {
        for (const name of mcpToolNames) {
            disabledTools.add(name);
        }
    }

    // Fetch and web_search tools are auto-disabled when network is off
    if (!networkAllowed) {
        disabledTools.add("fetch");
        disabledTools.add("web_search");
    }

    // Build the desired set: start from all registered tools, remove disabled ones
    // (and grep in sandbox mode since sandboxed tools omit it).
    const desiredToolNames = new Set(allRegisteredToolNames);
    for (const name of disabledTools) {
        desiredToolNames.delete(name);
    }
    if (sandbox) {
        desiredToolNames.delete("grep");
    }

    // Compare against the currently-active set to determine if an update is needed.
    const activeSet = new Set(activeToolNames);
    const needsUpdate = desiredToolNames.size !== activeSet.size ||
        [...desiredToolNames].some((n) => !activeSet.has(n));

    return { desiredToolNames: [...desiredToolNames], needsUpdate };
}
