/**
 * @file Chat connection store: SSE stream lifecycle, message sending, and generation state.
 *
 * Architecture:
 * - `ChatState` — a single `$state` object holding all mutable chat state
 * - Handler functions — standalone functions that take `(state, event)` for each SSE event type
 * - Helper functions — pure utilities that take `(state, ...)` for state modifications
 * - `setupEventSource()` — creates the EventSource and wires up handlers
 * - `connectStream()` — orchestrates connection, delegates to setupEventSource
 * - `getChat()` — public API surface returning reactive getters
 *
 * Message management functions (state helpers, text extraction, SSE handlers,
 * message CRUD) are in `./chat-messages.svelte.ts` and take `ChatState` as
 * their first parameter. This module re-exports the public API functions so
 * existing imports in Svelte components continue to work.
 */
import {
    sendMessage as apiSend,
    abortGeneration as apiAbort,
    getMessageHistory,
    generateTitle,
    releaseConversation,
} from "$lib/api.js";
import type { ChatMessage, HistoryResult, SessionTiming } from "$lib/types.js";
import { setActiveConversation, updateConversationTitleAndTags } from "./conversations.svelte.js";

// Import message management functions from chat-messages module
import {
    setStreamingMessageId,
    populateFromHistory,
    clearMessages as _clearMessages,
    reloadMessages as _reloadMessages,
    modifyMessage as _modifyMessage,
    editMessage as _editMessage,
    regenWithFeedback as _regenWithFeedback,
    handleStreamRecovery,
    handleMessageStart,
    handleMessageUpdate,
    handleMessageEnd,
    handleToolExecutionStart,
    handleToolExecutionUpdate,
    handleToolExecutionEnd,
    handleFetchedSources,
    handleTurnTiming,
    finalizeStreamingMessage,
} from "./chat-messages.svelte.js";

// --- State definition ---

export interface ChatState {
    messages: ChatMessage[];
    connected: boolean;
    generating: boolean;
    error: string | null;
    currentConversationId: string | null;
    currentEventSource: EventSource | null;
    streamingMessageId: string | null;
    connectGeneration: number;
    recoveryTurnGeneration: number | null;
    navigating: boolean;
    titleGenerationRequested: boolean;
    insideThinkingTag: boolean;
    conversationDefaultModel: { provider: string; modelId: string } | null;
    /** Aggregate timing statistics (avg TTFT, avg TPS) across all timed turns */
    timing: SessionTiming | null;
    /** Resolves when the SSE 'connected' event arrives. Reset on each connectStream. */
    connectPromise: Promise<void> | null;
    /** Resolver for connectPromise — called from handleConnected. */
    resolveConnect: (() => void) | null;
}

/** Single reactive state object for the chat store. */
const state = $state<ChatState>({
    messages: [],
    connected: false,
    generating: false,
    error: null,
    currentConversationId: null,
    currentEventSource: null,
    streamingMessageId: null,
    connectGeneration: 0,
    recoveryTurnGeneration: null,
    navigating: false,
    titleGenerationRequested: false,
    insideThinkingTag: false,
    conversationDefaultModel: null,
    timing: null,
    connectPromise: null,
    resolveConnect: null,
});

// --- Helper functions that stay in this module ---

/**
 * Request auto-title generation for the current conversation if not already done.
 * @param s - The chat state
 */
function requestTitleGeneration(s: ChatState): void {
    if (!s.titleGenerationRequested && s.currentConversationId) {
        s.titleGenerationRequested = true;
        const convId = s.currentConversationId;
        generateTitle(convId)
            .then((result) => {
                // Update sidebar if we got a title (newly generated or already set)
                if (result.title && result.title !== "New Chat") {
                    updateConversationTitleAndTags(convId, result.title, result.tags ?? []);
                }
            })
            .catch(() => {
                // Title generation failed — non-critical, ignore
            });
    }
}

// --- SSE event handlers (take state and event data) ---

/**
 * Handle the 'connected' SSE event.
 * @param s - The chat state
 */
function handleConnected(s: ChatState): void {
    console.log(`[chat-lifecycle] handleConnected: SSE connected, messages.length=${s.messages.length}, generating=${s.generating}`);
    s.connected = true;
    s.error = null;
    // Resolve the one-shot promise so callers waiting for connection can proceed
    if (s.resolveConnect) {
        s.resolveConnect();
        s.resolveConnect = null;
    }
}

/**
 * Handle the 'agent_start' SSE event.
 * @param s - The chat state
 */
function handleAgentStart(s: ChatState): void {
    console.log(`[chat-lifecycle] handleAgentStart: messages.length=${s.messages.length}`);
    s.generating = true;
}

/**
 * Handle the 'agent_end' SSE event.
 * @param s - The chat state
 */
function handleAgentEnd(s: ChatState): void {
    console.log(`[chat-lifecycle] handleAgentEnd: messages.length=${s.messages.length}, streamingMessageId=${s.streamingMessageId}`);
    s.generating = false;
    s.recoveryTurnGeneration = null;

    // Finalize the streaming message (message management — delegated to chat-messages)
    finalizeStreamingMessage(s, "agent_end");

    // Auto-generate title after first response if not already done
    requestTitleGeneration(s);

    // Reload messages to sync entry IDs. SSE uses temporary
    // IDs; real JSONL IDs are needed for delete/edit ops.
    void _reloadMessages(s);
}

/**
 * Handle the 'turn_start' SSE event.
 * @param s - The chat state
 */
function handleTurnStart(s: ChatState): void {
    // A new turn starts — may need a new assistant message for it
    s.generating = true;
}

/**
 * Handle the 'turn_end' SSE event.
 * @param _s - The chat state (unused)
 */
function handleTurnEnd(_s: ChatState): void {
    // Turn ended, but generation might continue with more turns
}

/**
 * Handle the 'session_tree' SSE event.
 * @param s - The chat state
 */
function handleSessionTree(s: ChatState): void {
    // Only reload if we're not currently navigating ourselves
    // (our own navigate calls reloadMessages directly)
    if (!s.navigating) {
        void _reloadMessages(s);
    }
}

/**
 * Handle the 'error' SSE event (connection-level error).
 * @param s - The chat state
 */
function handleError(s: ChatState): void {
    console.log(`[chat] SSE 'error' event: connection lost`);
    s.connected = false;
    s.error = "Connection lost. Reconnecting...";
}

// --- EventSource setup ---

/**
 * Map of SSE event names to their typed handlers.
 * Events with MessageEvent arg need `(s, e)` signature; others need `(s)` only.
 */
const SSE_HANDLERS = {
    connected: (s: ChatState) => handleConnected(s),
    stream_recovery: (s: ChatState, e: MessageEvent) => handleStreamRecovery(s, e),
    message_start: (s: ChatState, e: MessageEvent) => handleMessageStart(s, e),
    message_update: (s: ChatState, e: MessageEvent) => handleMessageUpdate(s, e),
    message_end: (s: ChatState, e: MessageEvent) => handleMessageEnd(s, e),
    tool_execution_start: (s: ChatState, e: MessageEvent) => handleToolExecutionStart(s, e),
    tool_execution_update: (s: ChatState, e: MessageEvent) => handleToolExecutionUpdate(s, e),
    tool_execution_end: (s: ChatState, e: MessageEvent) => handleToolExecutionEnd(s, e),
    turn_start: (s: ChatState) => handleTurnStart(s),
    turn_end: (s: ChatState) => handleTurnEnd(s),
    agent_start: (s: ChatState) => handleAgentStart(s),
    agent_end: (s: ChatState) => handleAgentEnd(s),
    error: (s: ChatState) => handleError(s),
    fetched_sources: (s: ChatState, e: MessageEvent) => handleFetchedSources(s, e),
    turn_timing: (s: ChatState, e: MessageEvent) => handleTurnTiming(s, e),
    session_tree: (s: ChatState) => handleSessionTree(s),
} as const;

type SseEventName = keyof typeof SSE_HANDLERS;

/**
 * Wire all SSE event listeners onto an EventSource instance.
 * Each listener checks staleness before delegating to the per-event handler.
 * @param es - The EventSource to wire
 * @param s - The chat state
 * @param isStale - Function to check if this connection is stale
 */
function wireEventListeners(es: EventSource, s: ChatState, isStale: () => boolean): void {
    for (const name of Object.keys(SSE_HANDLERS) as SseEventName[]) {
        es.addEventListener(name, (e: MessageEvent) => {
            if (isStale()) return;
            SSE_HANDLERS[name](s, e);
        });
    }

    es.onmessage = (e: MessageEvent) => {
        console.log(`[chat] SSE onmessage (catch-all): type=${e.type}, lastEventId=${e.lastEventId}, data=${String(e.data).substring(0, 200)}`);
    };

    es.onerror = () => {
        if (isStale()) return;
        console.log(`[chat] SSE onerror: EventSource error`);
        s.connected = false;
    };
}

/**
 * Create an EventSource for a conversation's SSE stream and wire up all event handlers.
 * @param s - The chat state
 * @param conversationId - The conversation to stream
 * @param thisGeneration - Generation counter for stale-checks
 * @returns The wired EventSource instance
 */
function setupEventSource(
    s: ChatState,
    conversationId: string,
    thisGeneration: number
): EventSource {
    const streamUrl = `/api/sessions/${conversationId}/stream`;
    console.log(`[chat] connectStream: EventSource URL=${streamUrl}`);

    const es = new EventSource(streamUrl);
    const isStale = () => thisGeneration !== s.connectGeneration;
    wireEventListeners(es, s, isStale);

    return es;
}

// --- State reset helper ---

/**
 * Reset all chat state and prepare for connecting to a new conversation.
 * Disconnects any existing stream, bumps the generation counter,
 * clears all messages and streaming state, and sets the new conversation ID.
 * @param s - The chat state
 * @param conversationId - The new conversation ID
 * @returns The new generation counter
 */
function resetChatState(s: ChatState, conversationId: string): number {
    disconnectStream();
    const thisGeneration = ++s.connectGeneration;
    s.messages = [];
    setStreamingMessageId(s, null, "connectStream reset");
    s.generating = false;
    s.error = null;
    s.insideThinkingTag = false;
    s.titleGenerationRequested = false;
    s.recoveryTurnGeneration = null;
    s.currentConversationId = conversationId;
    setActiveConversation(conversationId);
    // Create a one-shot promise that resolves when the SSE 'connected' event fires.
    // This lets callers (e.g. sendInitialMessage) await the connection before sending.
    s.connectPromise = new Promise<void>((resolve) => {
        s.resolveConnect = resolve;
    });
    return thisGeneration;
}

// --- Public API ---

/**
 * Add a user message to the local list only (does NOT send to the API).
 * Use sendToApi() after to actually trigger the AI response.
 * @param content - The message text
 * @returns The generated message ID
 */
function addLocalUserMessage(content: string): string {
    const id = `user-${Date.now()}`;
    state.messages.push({
        id,
        role: "user",
        content,
        timestamp: Date.now(),
    });
    console.log(`[chat-lifecycle] addLocalUserMessage: pushed user msg id=${id}, messages.length=${state.messages.length}`);
    return id;
}

/**
 * Update the content of a local message by ID.
 * @param id - The message ID to update
 * @param content - The new content
 */
function updateLocalMessage(id: string, content: string) {
    const msg = state.messages.find((m) => m.id === id);
    if (msg) {
        msg.content = content;
    }
}

/**
 * Send a message to the API without adding it to the local message list.
 * The AI response will come through the SSE stream.
 * Use after addLocalUserMessage() when you've already pushed the
 * message locally (e.g. to show it before file uploads finish).
 * @param content - The message text
 * @param modelId - Optional model override
 * @param statusContent - Invisible context sent to the AI
 * @returns {Promise<void>}
 */
async function sendToApi(content: string, modelId?: string, statusContent?: string): Promise<void> {
    if (!state.currentConversationId) return;
    state.error = null;
    state.generating = true;
    try {
        await apiSend(state.currentConversationId, content, modelId, statusContent);
    } catch (e) {
        state.error = e instanceof Error ? e.message : "Failed to send message";
        state.generating = false;
    }
}

/** Wait for the SSE stream to be connected before sending messages.
 *  Returns immediately if already connected.
 * @returns {Promise<void>}
 */
async function waitForConnected(): Promise<void> {
    if (state.connected) return;
    await state.connectPromise;
}

/**
 * Get the shared chat store instance with reactive getters and mutation methods.
 * @returns The chat store API object
 */
export function getChat() {
    return {
        get messages() {
            return state.messages;
        },
        get connected() {
            return state.connected;
        },
        get generating() {
            return state.generating;
        },
        get error() {
            return state.error;
        },
        /**
         * Set an error message to display in the chat UI.
         * @param msg - The error message, or null to clear
         */
        setError(msg: string | null) {
            state.error = msg;
        },
        get conversationId() {
            return state.currentConversationId;
        },
        waitForConnected,
        get conversationDefaultModel() {
            return state.conversationDefaultModel;
        },
        /**
                 * Whether a navigate (delete/edit) operation is in progress.
                 * @returns The navigating flag
                 */
        get navigating() {
            return state.navigating;
        },
        /**
         * Total input tokens across all assistant messages in this conversation.
         * @returns The total input token count
         */
        get totalInputTokens() {
            return state.messages.reduce((sum, m) => sum + (m.usage?.input ?? 0), 0);
        },
        /**
         * Total output tokens across all assistant messages in this conversation.
         * @returns The total output token count
         */
        get totalOutputTokens() {
            return state.messages.reduce((sum, m) => sum + (m.usage?.output ?? 0), 0);
        },
        /**
         * Aggregate timing statistics (avg TTFT, avg TPS) across all timed turns.
         * @returns The session timing aggregate, or null if no timing data
         */
        get timing() {
            return state.timing;
        },
        addLocalUserMessage,
        updateLocalMessage,
        sendToApi,
    };
}

/**
 * Connect to the SSE stream for a conversation.
 * Loads message history (from preloaded data or a server fetch), then connects the SSE stream.
 * Disconnects any existing connection first.
 *
 * @param conversationId - The conversation to connect to
 * @param preloadedHistory - If provided (e.g., from SSR), skip the client-side fetch
 *   and populate messages immediately. This is the SSR optimization path.
 */
export async function connectStream(
    conversationId: string,
    preloadedHistory?: HistoryResult
): Promise<void> {
    console.log(`[chat-lifecycle] connectStream: conversationId=${conversationId}, hasPreloadedHistory=${!!preloadedHistory}, currentGeneration=${state.connectGeneration}`);

    const thisGeneration = resetChatState(state, conversationId);
    console.log(`[chat-lifecycle] connectStream: after resetChatState, messages.length=${state.messages.length}`);

    // Load message history — preloaded SSR data (sync) or server (async)
    if (preloadedHistory) {
        populateFromHistory(state, preloadedHistory, conversationId);
    } else {
        try {
            const history = await getMessageHistory(conversationId);
            // If another connectStream call happened while we awaited, discard this result
            if (thisGeneration !== state.connectGeneration) return;
            populateFromHistory(state, history, conversationId);
        } catch {
            // If history loading fails, continue with empty messages
            // The user can still start a new conversation
        }
    }

    // Re-check after await — if a newer connectStream superseded us, bail out
    if (thisGeneration !== state.connectGeneration) return;

    // Create EventSource and wire up all handlers
    const es = setupEventSource(state, conversationId, thisGeneration);
    state.currentEventSource = es;
}

/**
 * Disconnect the SSE stream and release the server-side session.
 * @returns {void}
 */
export function disconnectStream(): void {
    console.log(`[chat-lifecycle] disconnectStream: conversationId=${state.currentConversationId}, hadEventSource=${!!state.currentEventSource}, messages.length=${state.messages.length}`);
    // Release the in-memory session on the server when switching away.
    // Best-effort; server idle timeout is the fallback if this fails.
    const convId = state.currentConversationId;
    if (convId) {
        releaseConversation(convId).catch(() => {
            // Best-effort — ignore failures (server idle timeout is the fallback)
        });
    }

    if (state.currentEventSource) {
        state.currentEventSource.close();
        state.currentEventSource = null;
    }
    state.connected = false;
    state.generating = false;
    setStreamingMessageId(state, null, "disconnectStream");
    state.currentConversationId = null;
    state.insideThinkingTag = false;
    state.conversationDefaultModel = null;
    state.recoveryTurnGeneration = null;
}

/**
 * Send a user message and add it to the local message list.
 * The actual response comes through the SSE stream.
 * @param content - The message text
 * @param modelId - Optional model override
 * @param statusContent - Invisible context sent to the AI
 * @returns {Promise<void>}
 */
export async function send(content: string, modelId?: string, statusContent?: string): Promise<void> {
    if (!state.currentConversationId) return;

    // Add user message to the local list
    const userMsgId = `user-${Date.now()}`;
    state.messages.push({
        id: userMsgId,
        role: "user",
        content,
        timestamp: Date.now(),
    });
    console.log(`[chat-lifecycle] send: pushed user msg id=${userMsgId}, messages.length=${state.messages.length}, generating=${state.generating}, connected=${state.connected}`);

    state.error = null;
    state.generating = true;

    try {
        await apiSend(state.currentConversationId, content, modelId, statusContent);
    } catch (e) {
        state.error = e instanceof Error ? e.message : "Failed to send message";
        state.generating = false;
    }
}

/**
 * Reload message history from the server and update the local message list.
 * Used after navigating the session tree (delete/edit) to sync local state.
 * @returns {Promise<void>}
 */
export async function reloadMessages(): Promise<void> {
    return _reloadMessages(state);
}

/**
 * Modify a message by either deleting it or editing an assistant message in-place.
 *
 * If newContent is provided, performs an in-place edit of the assistant message.
 * If newContent is not provided, deletes the message by navigating the session tree.
 *
 * @param messageId - The ID of the message to modify
 * @param newContent - If provided, the new content for an assistant message edit
 * @returns {Promise<void>}
 */
export async function modifyMessage(messageId: string, newContent?: string): Promise<void> {
    return _modifyMessage(state, messageId, abort, newContent);
}

/**
 * Edit a message by navigating the session tree back to before that message.
 * For user messages: navigates back and re-sends with the new text (in-place edit).
 * For assistant messages: navigates back to before the assistant message,
 * then re-sends the preceding user message to trigger re-generation.
 *
 * @param messageId - The ID of the message to edit
 * @param role - The role of the message ("user" or "assistant")
 * @param newText - For user messages: the edited text to send
 * @returns {Promise<void>}
 */
export async function editMessage(messageId: string, role: string, newText?: string): Promise<void> {
    return _editMessage(state, messageId, role, { newText, abortFn: abort, sendFn: send });
}

/**
 * Regenerate an assistant message with user feedback.
 * Navigates back, sends the critique as a hidden custom message,
 * and triggers a new LLM turn for a corrected response.
 * @param messageId - The ID of the assistant message to regenerate
 * @param feedback - The user feedback/critique
 * @param modelId - Optional model ID to use for regeneration (reverts after)
 * @returns {Promise<void>}
 */
export async function regenWithFeedback(messageId: string, feedback: string, modelId?: string): Promise<void> {
    return _regenWithFeedback(state, { messageId, feedback, abort, modelId });
}

/**
 * Abort the current generation.
 */
export async function abort(): Promise<void> {
    if (!state.currentConversationId) return;

    try {
        await apiAbort(state.currentConversationId);
        state.generating = false;
        if (state.streamingMessageId) {
            const msg = state.messages.find((m) => m.id === state.streamingMessageId);
            if (msg) msg.streaming = false;
            setStreamingMessageId(state, null, "abort");
        }
    } catch (e) {
        state.error = e instanceof Error ? e.message : "Failed to abort";
    }
}

/**
 * Clear messages (e.g. when switching conversations).
 */
export function clearMessages(): void {
    _clearMessages(state);
}

/**
 * Switch to a different conversation — disconnect old stream, clear messages,
 * connect to the new one.
 * @param conversationId - The conversation to switch to
 */
export function switchConversation(conversationId: string): void {
    if (conversationId === state.currentConversationId) return;

    // connectStream → resetChatState handles all cleanup
    void connectStream(conversationId);
}

/**
 * Reconnect to the current conversation after a session restart.
 * Used when conversation settings change and the server disposes the
 * in-memory session (it will be lazily recreated on next connect).
 */
export function reconnectStream(): void {
    const convId = state.currentConversationId;
    if (!convId) return;

    // Close the current EventSource without sending a release request
    // since the server already disposed the session.
    if (state.currentEventSource) {
        state.currentEventSource.close();
        state.currentEventSource = null;
    }

    // connectStream → resetChatState handles all state cleanup and
    // will call disconnectStream which gracefully closes the old connection.
    void connectStream(convId);
}
