/**
 * Session store — central coordinator.
 *
 * Owns the `sessions` Map and provides the core session lifecycle:
 * getOrCreateSession, subscribe, sendMessage, switchSessionModel,
 * abortSession, disposeSession, etc.
 *
 * All other logic has been extracted into focused sub-modules:
 * - model-registry.ts — model resolution, auth storage, ModelRegistry singleton
 * - session-events.ts — SSE formatting, message serialization, broadcast
 * - session-history.ts — history building, session tree navigation, editing
 * - session-messages.ts — message sending, history retrieval, tree navigation, editing
 * - session-tools.ts — tool resolution, agent info, MCP server status
 *
 * This module re-exports all public functions from sub-modules so that
 * existing imports from other files continue to work unchanged.
 */

import { mkdirSync, rmSync, existsSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import { log } from "$lib/server/logger.js";
import { safeJsonParse, stringArraySchema, recordSchema, tryJsonParse } from "$lib/utils.js";
import {
    createAgentSession,
    createEventBus,
    DefaultResourceLoader,
    SessionManager,
    SettingsManager,
    type AgentSession as PiAgentSession,
    type AgentSessionEvent as PiAgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import mcpAdapter from "pi-mcp-adapter";
import { ensureMcpConfigFile, writeConversationMcpConfig, filterMcpServers, MCP_CONFIG_PATH } from "./mcp-config.js";
import { createSandboxedCodingTools } from "./sandboxed-tools.js";
import { createFetchTool } from "./sandboxed-fetch-tool.js";
import { createSearchTool, SEARCH_SETTINGS_KEYS } from "./sandboxed-search-tool.js";
import { fetchTracker } from "./extensions/fetch-tracker.js";
import type { FetchedSource } from "./extensions/fetch-tracker.js";
import { createSessionSandbox, getSessionWorkDir, loadConversationSettingsFromDb, saveConversationSettingsToDb, isNetworkAllowed, getEffectiveAgentMode } from "./sandbox-factory.js";
import type { Model as PiModel, Api } from "@mariozechner/pi-ai";
import { getDb } from "../db/index.js";
import type { ChatSSEEvent, ActiveSession, ConversationListItem, CustomModelDef } from "./types.js";
import type { ConversationSettings } from "$lib/types.js";
import type { Sandbox } from "zerobox";
import { getToolRegistry, getToolDefinitions, getBaseToolDefinitions, getResourceLoaderAdapter } from "./pi-adapter.js";

// --- Sub-module imports ---

import {
    AGENT_DIR,
    SESSIONS_DIR,
    getModelRegistry,
    findModelById,
    resolveModelProvider,
    loadVesselAppendPrompt,
} from "./model-registry.js";
export {
    getAuthStorage,
    refreshAuthStorageKeys,
    getModelRegistry,
    findModelById,
    resolveModel,
    resolveModelProvider,
    refreshModelsJson,
    loadVesselAppendPrompt,
    AGENT_DIR,
    SESSIONS_DIR,
} from "./model-registry.js";

import {
    broadcast,
    formatEventPayload,
    serializeStreamingMessageForRecovery,
} from "./session-events.js";

// session-history.ts: buildHistoryFromSession and tree functions are now
// imported and re-exported via session-messages.ts
export type {
    SessionTreeNodeData,
    SessionTreeRelation,
} from "./session-messages.js";

import {
    sendMessageToSession,
    sendCustomMessageToSession,
    getHistoryFromSession,
    getConversationDbRow,
    navigateSessionMessage,
    editSessionAssistantMessage,
    getSessionUserMessages,
    getSessionTreeFromSession,
    setSessionLeafEntry,
} from "./session-messages.js";
export {
    buildHistoryFromSession,
} from "./session-messages.js";

import {
    resolveActiveToolNames,
    getSessionAgentInfo as _getSessionAgentInfo,
    getMcpServerStatus as _getMcpServerStatus,
    type McpServerStatus as McpServerStatusType,
} from "./session-tools.js";
export {
    resolveActiveToolNames,
    type ResolveActiveToolNamesInput,
    type ResolveActiveToolNamesResult,
    type McpServerStatus,
} from "./session-tools.js";

// Conversation CRUD and custom model management are defined inline below.
export type { CustomModelDef } from "./types.js";
export type { ConversationListItem } from "./types.js";
export type { ChatSSEEvent } from "./types.js";

// --- Constants ---

/** How long to keep a session in memory after all subscribers disconnect.
 * This is a safety net — the primary release mechanism is the explicit
 * /api/sessions/[id]/release call from the frontend on conversation switch.
 */
const SESSION_DISPOSE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

// --- In-memory session store ---

const sessions = new Map<string, ActiveSession>();

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
        log.info("session-store", `Disposed session ${conversationId} (idle timeout)`);
    }, SESSION_DISPOSE_TIMEOUT_MS);
}

function cancelDispose(conversationId: string): void {
    const session = sessions.get(conversationId);
    if (session?.disposeTimer) {
        clearTimeout(session.disposeTimer);
        session.disposeTimer = undefined;
    }
}

/**
 * Immediately dispose a session if it has no subscribers and is not streaming.
 * Called from the broadcast function after agent_end events, so sessions
 * that just finished generating don't leak when the user already navigated away.
 */
function disposeIfIdle(conversationId: string): void {
    const session = sessions.get(conversationId);
    if (!session) return;
    if (session.subscribers.size > 0) return;
    if (session.agentSession.isStreaming) return;

    // Clear any pending disposal timer
    if (session.disposeTimer) {
        clearTimeout(session.disposeTimer);
        session.disposeTimer = undefined;
    }

    session.unsubscribe();
    session.agentSession.dispose();
    sessions.delete(conversationId);
    log.info("session-store", `Disposed session ${conversationId} (agent_end with no subscribers)`);
}

// --- Public API (central coordinator functions) ---

/**
 * Create a new conversation (both in our DB and as a pi session file).
 * Returns the conversation ID.
 */
export function createConversation(title?: string, modelId?: string): string {
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
        tags: safeJsonParse(row.tags, stringArraySchema) ?? [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));
}

/**
 * Fully destroy a conversation: dispose in-memory session, delete the
 * pi session file, delete the workspace directory (if configured), and remove the DB row.
 * Only called when the user explicitly hits the trash icon.
 */
export function destroyConversation(conversationId: string): void {
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
            log.info("session-store", `Deleted pi session file: ${row.session_file_path}`);
        } catch (err) {
            log.error("session-store", `Failed to delete pi session file ${row.session_file_path}`, err);
        }
    }

    // 3. Delete the conversation's workspace directory (if setting allows)
    if (deleteWorkspace) {
        const workspaceDir = getSessionWorkDir(conversationId);
        if (existsSync(workspaceDir)) {
            try {
                rmSync(workspaceDir, { recursive: true });
                log.info("session-store", `Deleted workspace directory: ${workspaceDir}`);
            } catch (err) {
                log.error("session-store", `Failed to delete workspace directory ${workspaceDir}`, err);
            }
        }

        // Also clean up the parent session directory if it's now empty
        const sessionDir = resolve(SESSIONS_DIR, conversationId);
        if (existsSync(sessionDir)) {
            try {
                rmSync(sessionDir, { recursive: true });
                log.info("session-store", `Deleted session directory: ${sessionDir}`);
            } catch (err) {
                log.error("session-store", `Failed to delete session directory ${sessionDir}`, err);
            }
        }
    } else {
        log.info("session-store", `Keeping workspace for conversation ${conversationId} (deleteWorkspaceWithConversation = false)`);
    }

    // 4. Delete the DB rows (conversation_settings is ON DELETE CASCADE)
    db.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
    log.info("session-store", `Destroyed conversation ${conversationId} (explicit user delete)`);
}

/** Open the SessionManager for a conversation, overriding cwd to match the session work dir. */
function openSessionManager(row: { session_file_path: string }, sessionWorkDir: string): SessionManager {
    return SessionManager.open(row.session_file_path, SESSIONS_DIR, sessionWorkDir);
}

/** Resolve MCP config: write per-conversation or use global, return flags and whether MCP is active. */
function resolveMcpConfig(conversationId: string, conversationSettings: ConversationSettings | null): {
    mcpFlagValues: Map<string, boolean | string>;
    hasMcpServers: boolean;
} {
    ensureMcpConfigFile();
    const mcpFlagValues = new Map<string, boolean | string>();
    const enabledMcpServers = conversationSettings?.enabledMcpServers ?? null;
    if (enabledMcpServers !== null) {
        const convConfigPath = writeConversationMcpConfig(conversationId, enabledMcpServers);
        mcpFlagValues.set("mcp-config", convConfigPath);
    } else {
        mcpFlagValues.set("mcp-config", MCP_CONFIG_PATH);
    }

    const activeMcpServers = filterMcpServers(enabledMcpServers);
    const hasMcpServers = Object.keys(activeMcpServers).length > 0;
    return { mcpFlagValues, hasMcpServers };
}

// --- getOrCreateConversation helpers ---

/** Resolve the model for a conversation: conversation-specific → global default → none. */
function resolveSessionModel(
    row: { model_provider: string | null; model_id: string | null },
    settingsManager: SettingsManager,
    modelRegistry: ReturnType<typeof getModelRegistry>
): PiModel<Api> | undefined {
    // Apply default model settings from our DB settings table
    const db = getDb();
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
    // First, try the conversation-specific model
    if (row.model_id) {
        const model = findModelById(row.model_id, modelRegistry);
        if (model) return model;
    }

    // Fall back to default model from settings
    if (defaultModelId) {
        return findModelById(defaultModelId, modelRegistry);
    }

    return undefined;
}

interface SessionInfrastructureOptions {
    sessionManager: SessionManager;
    model: PiModel<Api> | undefined;
    settingsManager: SettingsManager;
    modelRegistry: ReturnType<typeof getModelRegistry>;
    mcpFlagValues: Map<string, boolean | string>;
    hasMcpServers: boolean;
    eventBus: ReturnType<typeof createEventBus>;
    sessionWorkDir: string;
}

/** Create the agent session infrastructure: extensions, resource loader, and the session itself. */
async function createSessionInfrastructure(
    opts: SessionInfrastructureOptions
): Promise<{ agentSession: PiAgentSession; extensionsResult: Awaited<ReturnType<typeof createAgentSession>>["extensionsResult"] }> {
    const { sessionManager, model, settingsManager, modelRegistry, mcpFlagValues, hasMcpServers, eventBus, sessionWorkDir } = opts;

    // Create a custom ResourceLoader that includes the fetch tracker (always) and
    // pi-mcp-adapter (only when there are enabled MCP servers).
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
    if (hasMcpServers && mcpFlagValues.size > 0) {
        for (const [name, value] of mcpFlagValues) {
            extensionsResult.runtime.flagValues.set(name, value);
        }
    }

    // Initialize extensions by calling bindExtensions(). This emits the
    // session_start event, which pi-mcp-adapter uses to connect to MCP servers.
    // In the web app we don't have a TUI, so we pass empty bindings.
    await agentSession.bindExtensions({});

    return { agentSession, extensionsResult };
}

/** Register Vessel-specific tools (fetch, search, sandboxed tools) and set active tools. */
function registerVesselTools(
    agentSession: PiAgentSession,
    conversationSettings: ConversationSettings | null,
    sandbox: Sandbox | null,
    searchResultUrls: Set<string>
): void {
    const db = getDb();

    // Determine the effective tool set for this conversation.
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

    const fetchTool = sandbox
        ? createFetchTool({ sandbox, searchResultUrls })
        : createFetchTool({ searchResultUrls });
    const toolRegistry = getToolRegistry(agentSession);
    const toolDefinitions = getToolDefinitions(agentSession);
    const baseToolDefinitions = getBaseToolDefinitions(agentSession);
    toolRegistry.set(fetchTool.name, fetchTool);
    toolDefinitions.set(fetchTool.name, {
        definition: fetchTool,
        sourceInfo: { path: `<sdk:${fetchTool.name}>`, source: "sdk", scope: "user", origin: "top-level" },
    });
    baseToolDefinitions.set(fetchTool.name, fetchTool);

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

    const sessionWorkDir = sandbox ? getSessionWorkDir(agentSession.sessionId) : process.cwd();

    if (sandbox) {
        const sandboxedTools = createSandboxedCodingTools(sessionWorkDir, sandbox, { searchResultUrls });
        for (const tool of sandboxedTools) {
            toolRegistry.set(tool.name, tool);
        }
        toolRegistry.delete("grep");
        toolDefinitions.delete("grep");
        baseToolDefinitions.delete("grep");
        agentSession.setActiveToolsByName(activeToolDecision.desiredToolNames);
    } else if (activeToolDecision.needsUpdate) {
        agentSession.setActiveToolsByName(activeToolDecision.desiredToolNames);
    }
}

/** Read a global setting from the DB by key, returning its string value or null. */
function readGlobalSetting(key: string): string | null {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
}

/** Resolve the append system prompt: conversation override → global, migrating legacy string format. */
function resolveAppendSystemPrompt(conversationSettings: ConversationSettings | null): string[] {
    let rawAppend = conversationSettings?.appendSystemPrompt ?? null;
    if (rawAppend === null) {
        const globalValue = readGlobalSetting("agent.appendSystemPrompt");
        if (globalValue) {
            try {
                rawAppend = tryJsonParse(globalValue, stringArraySchema);
            } catch (e) {
                log.debug("session-store", "Failed to parse global append system prompt setting", e);
                rawAppend = null;
            }
        }
    }
    // Migrate legacy string-typed appendSystemPrompt to array
    const userAppend: string[] = rawAppend
        ? Array.isArray(rawAppend)
            ? rawAppend
            : [rawAppend]
        : [];
    // Prepend the Vessel-specific append prompt (from VESSEL_APPEND.md)
    const vesselAppend = loadVesselAppendPrompt();
    return vesselAppend ? [vesselAppend, ...userAppend] : userAppend;
}

/** Apply custom/append system prompt overrides to the agent session. */
function applySystemPromptOverrides(
    agentSession: PiAgentSession,
    conversationSettings: ConversationSettings | null
): void {
    // Resolve customSystemPrompt: conversation override → global setting
    const customSystemPrompt = conversationSettings?.customSystemPrompt ?? readGlobalSetting("agent.customSystemPrompt");
    const appendSystemPrompt = resolveAppendSystemPrompt(conversationSettings);

    if (customSystemPrompt !== null || appendSystemPrompt.length > 0) {
        const resourceLoader = getResourceLoaderAdapter(agentSession);
        if (customSystemPrompt !== null) {
            resourceLoader.systemPrompt = customSystemPrompt;
        }
        resourceLoader.appendSystemPrompt = appendSystemPrompt;
        // Rebuild the system prompt with the new values
        agentSession.setActiveToolsByName(agentSession.getActiveToolNames());
    }
}

/** Wire up agent + EventBus subscriptions to broadcast SSE events. */
function setupSessionEventSubscriptions(
    agentSession: PiAgentSession,
    eventBus: ReturnType<typeof createEventBus>,
    conversationId: string
): () => void {
    const unsubscribeAgent = agentSession.subscribe((event: PiAgentSessionEvent) => {
        const session = sessions.get(conversationId);

        // Track turn generation for stream recovery
        if (session && event.type === "message_start") {
            session.turnGeneration++;
        }

        const sseEvent: ChatSSEEvent = {
            event: event.type,
            data: formatEventPayload(event),
        };

        // Embed turnGeneration in streaming events
        if (session && (event.type === "message_start" || event.type === "message_update" || event.type === "message_end")) {
            (sseEvent.data as Record<string, unknown>).turnGeneration = session.turnGeneration;
        }

        broadcast(sessions, scheduleDispose, disposeIfIdle, conversationId, sseEvent);
    });

    const unsubscribeEventBus = eventBus.on("fetched_sources", (data) => {
        const sources = data as FetchedSource[];
        log.debug("fetch-tracker", `EventBus received fetched_sources: ${String(sources.length)} sources for conversation ${conversationId}`);
        broadcast(sessions, scheduleDispose, disposeIfIdle, conversationId, {
            event: "fetched_sources",
            data: { sources },
        });
    });

    return () => {
        unsubscribeAgent();
        unsubscribeEventBus();
    };
}

/**
 * Get or create an active AgentSession for a conversation.
 * If the session is already in memory, return it.
 * If not, hydrate from the pi session file.
 */
export async function getOrHydrateSession(conversationId: string): Promise<PiAgentSession> {
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

    const modelRegistry = getModelRegistry();

    // Load per-conversation settings and compute session work dir before opening session
    const conversationSettings = loadConversationSettingsFromDb(conversationId);
    const sandbox = await createSessionSandbox(conversationId, conversationSettings);
    const sessionWorkDir = sandbox ? getSessionWorkDir(conversationId) : process.cwd();
    const sessionManager = openSessionManager(row, sessionWorkDir);

    // Resolve the model for this conversation
    const settingsManager = SettingsManager.inMemory();
    const model = resolveSessionModel(row, settingsManager, modelRegistry);

    mkdirSync(AGENT_DIR, { recursive: true });

    // Resolve MCP config
    const { mcpFlagValues, hasMcpServers } = resolveMcpConfig(conversationId, conversationSettings);

    // Create the agent session with extensions and resource loader
    const eventBus = createEventBus();
    const { agentSession } = await createSessionInfrastructure({
        sessionManager, model, settingsManager, modelRegistry,
        mcpFlagValues, hasMcpServers, eventBus, sessionWorkDir
    });

    // Register Vessel-specific tools and set active tools
    const searchResultUrls = new Set<string>();
    registerVesselTools(agentSession, conversationSettings, sandbox, searchResultUrls);

    // Apply custom/append system prompt overrides
    applySystemPromptOverrides(agentSession, conversationSettings);

    // Wire up event subscriptions
    const unsubscribe = setupSessionEventSubscriptions(agentSession, eventBus, conversationId);

    sessions.set(conversationId, {
        agentSession,
        sessionId: conversationId,
        subscribers: new Map(),
        unsubscribe,
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
export function subscribeToConversation(
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
 * Send a custom (non-displayed) message to an active session.
 */
export async function sendCustomMessage(
    conversationId: string,
    customType: string,
    content: string,
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }
): Promise<void> {
    const agentSession = await getOrHydrateSession(conversationId);
    return sendCustomMessageToSession(agentSession, customType, content, options);
}

/**
 * Send a user message to the agent.
 */
export async function sendMessage(conversationId: string, content: string, statusContent?: string): Promise<void> {
    const agentSession = await getOrHydrateSession(conversationId);
    return sendMessageToSession(agentSession, conversationId, content, statusContent);
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
    log.info("session-store", `Disposed in-memory session ${conversationId} (idle timeout or browser session end)`);
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
    log.info("session-store", `Restarted session ${conversationId} (conversation settings changed)`);
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

    const resourceLoader = getResourceLoaderAdapter(session.agentSession);

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
        const session = sessions.get(id);
        if (!session) continue;

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
        log.info("session-store", `Restarted ${String(restarted)} session(s) — they will be re-created on next access`);
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
    const row = getConversationDbRow(conversationId);
    if (!row?.session_file_path) {
        return { messages: [], model: null };
    }

    // Ensure the session is loaded — it restores from the JSONL file automatically.
    // This also gives us tree-aware history (respecting the current leaf position
    // after any navigation/edit/delete operations).
    await getOrHydrateSession(conversationId);

    // Cancel any pending disposal since we're actively using the session
    cancelDispose(conversationId);

    const session = sessions.get(conversationId);
    if (!session) {
        return { messages: [], model: null };
    }
    return getHistoryFromSession(
        session,
        row
    );
}

/**
 * Get the current system prompt and available tools/skills for a conversation's
 * active AgentSession. The session must be loaded in memory (getOrCreateSession
 * handles this automatically).
 */
export function getSessionAgentInfo(conversationId: string): {
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
} | null {
    // Ensure the session is loaded
    const activeSession = sessions.get(conversationId);
    if (!activeSession) {
        return null;
    }

    return _getSessionAgentInfo(activeSession);
}

/**
 * Get the MCP server connection status for an active conversation session.
 * Reads from pi-mcp-adapter's internal McpServerManager via the extension runner.
 */
export function getMcpServerStatus(conversationId: string): McpServerStatusType[] {
    const session = sessions.get(conversationId);
    if (!session) return [];

    return _getMcpServerStatus(session);
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
    const agentSession = await getOrHydrateSession(conversationId);

    // Cancel any pending disposal since we're actively using the session
    cancelDispose(conversationId);

    return navigateSessionMessage(agentSession, targetEntryId);
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
    const agentSession = await getOrHydrateSession(conversationId);
    cancelDispose(conversationId);

    return editSessionAssistantMessage(agentSession, targetEntryId, newContent);
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

    return getSessionUserMessages(session);
}

/**
 * Get the full session tree as nodes and relations for DAG visualization.
 * Returns only user messages and final assistant text responses (no tool calls,
 * thinking blocks, tool results, or other intermediate entries).
 */
export async function getSessionTree(conversationId: string): Promise<{
    nodes: import("./session-messages.js").SessionTreeNodeData[];
    relations: import("./session-messages.js").SessionTreeRelation[];
    leafId: string | null;
}> {
    const agentSession = await getOrHydrateSession(conversationId);
    cancelDispose(conversationId);

    return getSessionTreeFromSession(agentSession);
}

/**
 * Set the session's current leaf position to a specific entry ID.
 * Used by the DAG viewer to navigate to a different point in the tree.
 * Unlike navigateMessage (which handles edit/delete semantics), this directly
 * branches to the target entry.
 */
export async function setSessionLeaf(conversationId: string, targetEntryId: string): Promise<void> {
    const agentSession = await getOrHydrateSession(conversationId);
    cancelDispose(conversationId);

    return setSessionLeafEntry(agentSession, targetEntryId);
}

// --- Custom models ---

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
        inputTypes: safeJsonParse((m.input_types as string) || '["text"]', stringArraySchema) ?? ["text"],
        contextWindow: m.context_window as number,
        maxTokens: m.max_tokens as number,
        cost: {
            input: m.cost_input as number,
            output: m.cost_output as number,
            cacheRead: m.cost_cache_read as number,
            cacheWrite: m.cost_cache_write as number,
        },
        compat: m.compat ? safeJsonParse(m.compat as string, recordSchema) ?? undefined : undefined,
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
