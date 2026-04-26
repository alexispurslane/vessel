/**
 * Chat store — manages SSE connection, message state, and send/abort for the active conversation.
 */
import {
    sendMessage as apiSend,
    abortGeneration as apiAbort,
    getMessageHistory,
    generateTitle,
    navigateMessage as apiNavigate,
    editAssistantMessage as apiEditAssistant,
    releaseConversation,
} from "$lib/api.js";
import type { MessageHistory } from "$lib/api.js";
import type { ChatMessage } from "$lib/types.js";
import { messageHistoryToChatMessages } from "$lib/chat-history.js";
import { setActiveConversation, updateConversationTitleAndTags } from "./conversations.svelte.js";

let messages = $state<ChatMessage[]>([]);
let connected = $state(false);
let generating = $state(false);
let error = $state<string | null>(null);
let currentEventSource: EventSource | null = null;
let currentConversationId: string | null = null;

/** Incremented each time connectStream is called, so stale async work can be detected and discarded. */
let connectGeneration = 0;

/** The assistant message currently being streamed (appended to as deltas arrive). */
let streamingMessageId: string | null = null;

/** Set streamingMessageId with diagnostic logging. */
function setStreamingMessageId(id: string | null, reason: string) {
    if (id === null && streamingMessageId !== null) {
        console.log(`[chat] streamingMessageId CLEARED: was ${streamingMessageId}, reason: ${reason}`);
        console.trace(`[chat] streamingMessageId cleared at:`);
    } else if (id !== null) {
        console.log(`[chat] streamingMessageId SET: ${id}, reason: ${reason}`);
    }
    streamingMessageId = id;
}

/** Find the currently streaming assistant message.
 *  Uses streamingMessageId as a fast-path cache, but falls back to scanning
 *  the messages array for a message with `streaming: true`. */
function getStreamingMsg(): ChatMessage | undefined {
    if (streamingMessageId) {
        const msg = messages.find((m) => m.id === streamingMessageId);
        if (msg) return msg;
    }
    const streamingMsg = messages.find((m) => m.streaming);
    if (streamingMsg) {
        setStreamingMessageId(streamingMsg.id, "getStreamingMsg fallback recovery");
    }
    return streamingMsg;
}

/** The last model used in this conversation (from history or SSE events) */
let lastModel: { provider: string; modelId: string } | null = null;

/** Whether we've already requested title generation for this conversation */
let titleGenerationRequested = false;

/**
 * Populate the messages array from a MessageHistory payload.
 * Uses the shared messageHistoryToChatMessages for the pure conversion,
 * then applies store-specific side effects (lastModel, title generation).
 */
function populateFromHistory(history: MessageHistory, conversationId: string): void {
    const chatMessages = messageHistoryToChatMessages(history);
    for (const msg of chatMessages) {
        messages.push(msg);
    }
    // Set the last model used from the history
    if (history.model) {
        lastModel = history.model;
    }

    // If this conversation already has messages but we haven't generated a title yet,
    // request one now (the server checks if the title is still "New Chat")
    if (history.messages.length > 0 && !titleGenerationRequested) {
        titleGenerationRequested = true;
        const convId = conversationId;
        generateTitle(convId)
            .then((result) => {
                // Update sidebar if we got a title (either newly generated or already set server-side)
                if (result.title && result.title !== "New Chat") {
                    updateConversationTitleAndTags(convId, result.title, result.tags ?? []);
                }
            })
            .catch(() => {
                // Title generation failed — non-critical, ignore
            });
    }
}

/** Turn generation from the last stream_recovery event. Used to skip stale
 *  message_update deltas that were already incorporated into the recovery snapshot.
 *  Reset on message_end/agent_end/disconnect. */
let recoveryTurnGeneration: number | null = null;

/** Whether a navigate (delete/edit) operation is in progress */
let navigating = $state(false);

export function getChat() {
    return {
        get messages() {
            return messages;
        },
        get connected() {
            return connected;
        },
        get generating() {
            return generating;
        },
        get error() {
            return error;
        },
        get conversationId() {
            return currentConversationId;
        },
        get lastModel() {
            return lastModel;
        },
        /** Whether a navigate (delete/edit) operation is in progress */
        get navigating() {
            return navigating;
        },
        /** Total input tokens across all assistant messages in this conversation */
        get totalInputTokens() {
            return messages.reduce((sum, m) => sum + (m.usage?.input ?? 0), 0);
        },
        /** Total output tokens across all assistant messages in this conversation */
        get totalOutputTokens() {
            return messages.reduce((sum, m) => sum + (m.usage?.output ?? 0), 0);
        },
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
    preloadedHistory?: MessageHistory
): Promise<void> {
    console.log(`[chat] connectStream called: conversationId=${conversationId}, hasPreloadedHistory=${!!preloadedHistory}, currentGeneration=${connectGeneration}`);
    // Disconnect existing
    disconnectStream();

    // Bump generation so any in-flight history load from a prior call is discarded
    const thisGeneration = ++connectGeneration;

    // Always clear messages when connecting to a new conversation
    messages = [];
    setStreamingMessageId(null, "connectStream reset");
    generating = false;
    error = null;
    insideThinkingTag = false;
    titleGenerationRequested = false;
    recoveryTurnGeneration = null;

    currentConversationId = conversationId;
    setActiveConversation(conversationId);

    // Load message history — either from preloaded SSR data (synchronous) or from the server (async)
    if (preloadedHistory) {
        populateFromHistory(preloadedHistory, conversationId);
    } else {
        try {
            const history = await getMessageHistory(conversationId);
            // If another connectStream call happened while we awaited, discard this result
            if (thisGeneration !== connectGeneration) return;
            populateFromHistory(history, conversationId);
        } catch {
            // If history loading fails, continue with empty messages
            // The user can still start a new conversation
        }
    }

    // Re-check after await — if a newer connectStream superseded us, bail out
    if (thisGeneration !== connectGeneration) return;

    const streamUrl = `/api/sessions/${conversationId}/stream`;
    console.log(`[chat] connectStream: EventSource URL=${streamUrl}`);

    const es = new EventSource(streamUrl);

    /** Returns true if this connection has been superseded by a newer connectStream call. */
    const isStale = () => thisGeneration !== connectGeneration;

    es.addEventListener("connected", () => {
        if (isStale()) return;
        console.log(`[chat] SSE 'connected' event received`);
        connected = true;
        error = null;
    });

    es.addEventListener("stream_recovery", (e: MessageEvent) => {
        if (isStale()) return;
        console.log(`[chat] SSE 'stream_recovery' event received`);
        try {
            const data = JSON.parse(e.data);
            if (data?.message) {
                generating = true;
                recoveryTurnGeneration = data.turnGeneration ?? null;

                const id = `assistant-recovered-${Date.now()}`;
                setStreamingMessageId(id, "stream_recovery");

                // Extract text content — serializeMessage returns content as string[]
                const text = extractTextFromContent(data.message.content) || "";
                // Thinking is already extracted by serializeMessage into a separate field
                const thinking = data.message.thinking ?? undefined;
                // Map tool calls from the enriched recovery format.
                // serializeStreamingMessageForRecovery adds status/output/isError
                // by cross-referencing ToolResultMessage entries, so completed
                // tools show up correctly instead of being stuck as "running".
                const toolCalls = (data.message.toolCalls ?? []).map((tc: any) => ({
                    toolName: tc.name ?? tc.toolName,
                    status: (tc.status ?? "running") as "running" | "completed" | "error",
                    arguments: tc.arguments,
                    output: tc.output,
                    isError: tc.isError,
                }));

                messages.push({
                    id,
                    role: "assistant",
                    content: text,
                    timestamp: data.message.timestamp ?? Date.now(),
                    thinking: thinking,
                    thinkingStreaming: !!thinking,
                    model: data.message.model,
                    modelProvider: data.message.provider,
                    toolCalls,
                    streaming: true,
                });
            }
        } catch {
            // ignore parse errors
        }
    });

    es.addEventListener("message_start", (e: MessageEvent) => {
        if (isStale()) return;
        console.log(`[chat] SSE 'message_start': lastEventId=${e.lastEventId}`);
        try {
            const data = JSON.parse(e.data);
            if (data?.message?.role && data.message.role !== "assistant") {
                // For user messages: add to the local list if not already present
                // (handles the case where a message was sent externally, e.g., via the API,
                // and the SSE stream delivers it before/without history loading it)
                if (data.message.role === "user") {
                    const content =
                        typeof data.message.content === "string"
                            ? data.message.content
                            : extractTextFromContent(data.message.content);
                    if (content) {
                        // Check if we already have this user message (from history or local send)
                        const alreadyExists = messages.some(
                            (m) => m.role === "user" && m.content === content
                        );
                        if (!alreadyExists) {
                            messages.push({
                                id: `user-sse-${Date.now()}`,
                                role: "user",
                                content,
                                timestamp: Date.now(),
                            });
                        }
                    }
                }
                // Skip toolResult/system messages — they're not displayed as chat bubbles
                return;
            }
        } catch {
            // If we can't parse, treat as assistant (best effort)
        }

        // Finalize any previous streaming message before starting a new one
        // (e.g., a tool-execution message that wasn't closed by message_end)
        if (streamingMessageId) {
            const prevMsg = messages.find((m) => m.id === streamingMessageId);
            if (prevMsg) {
                prevMsg.streaming = false;
                prevMsg.thinkingStreaming = false;
                if (prevMsg.content) {
                    prevMsg.content = stripLeadingNewlines(
                        stripThinkingTagsFromText(prevMsg.content)
                    );
                }
                if (prevMsg.thinking) {
                    prevMsg.thinking = stripLeadingNewlines(prevMsg.thinking);
                }
            }
        }

        // Begin a new assistant message
        generating = true;
        const id = `assistant-${Date.now()}`;
        setStreamingMessageId(id, "message_start assistant");
        console.log(`[chat] message_start: created streaming message id=${id}`);
        messages.push({
            id,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            toolCalls: [],
            streaming: true,
        });

        // message_start data includes { type: "message_start", message: AgentMessage }
        // The partial message might already have content, thinking, or model info
        try {
            const data = JSON.parse(e.data);
            if (data?.message) {
                const msg = messages.find((m) => m.id === id);
                if (msg) {
                    // Extract text content
                    if (data.message.content) {
                        const text = extractTextFromContent(data.message.content);
                        if (text) msg.content = text;
                    }
                    // Extract thinking — either from the serialized "thinking" field or from content array
                    const thinking =
                        data.message.thinking ??
                        (data.message.content
                            ? extractThinkingFromContent(data.message.content)
                            : undefined);
                    if (thinking) {
                        msg.thinking = thinking;
                        msg.thinkingStreaming = true;
                    }
                    // Extract model info
                    if (data.message.model) msg.model = data.message.model;
                    if (data.message.provider) msg.modelProvider = data.message.provider;
                    // Extract usage info
                    if (data.message.usage) msg.usage = data.message.usage;
                }
            }
        } catch {
            // ignore parse errors
        }
    });

    es.addEventListener("message_update", (e: MessageEvent) => {
        if (isStale()) return;
        const msg = getStreamingMsg();
        if (!msg) {
            console.log(`[chat] SSE 'message_update': DROPPED (no streaming message found), lastEventId=${e.lastEventId}`);
            return;
        }

        try {
            const data = JSON.parse(e.data);

            // pi's AssistantMessageEvent format:
            // { type: "text_delta", delta: "chunk", contentIndex: 0, partial: ... }
            // { type: "text_end", content: "full text", contentIndex: 0, partial: ... }
            // { type: "thinking_delta", delta: "chunk", contentIndex: 0, partial: ... }
            // { type: "toolcall_start", contentIndex: 0, partial: ... }
            // { type: "toolcall_delta", delta: "chunk", contentIndex: 0, partial: ... }
            // { type: "toolcall_end", toolCall: {...}, contentIndex: 0, partial: ... }
            // { type: "done", reason: "stop", message: AssistantMessage }
            // { type: "error", reason: "error", error: AssistantMessage }

            if (data?.type === "text_delta" && data.delta) {
                // Check if the delta starts with or is inside a <thinking> tag
                // Some providers send thinking as text with <thinking>...</thinking> tags
                appendTextDelta(msg, data.delta);
            } else if (data?.type === "text_end" && data.content) {
                // text_end includes the full content for this content block — we can ignore
                // since we've been accumulating deltas, or use it to verify
            } else if (data?.type === "thinking_start") {
                // Model is starting to think/reason
                msg.thinkingStreaming = true;
                msg.thinking = "";
            } else if (data?.type === "thinking_delta" && data.delta) {
                // Accumulate thinking content
                msg.thinking = (msg.thinking ?? "") + data.delta;
                msg.thinkingStreaming = true;
            } else if (data?.type === "thinking_end") {
                // Thinking complete
                msg.thinkingStreaming = false;
            } else if (data?.type === "done") {
                // Message is complete — extract final text and model info from the message if needed
                // But skip content if tool calls have output (to avoid duplicate bubble)
                const hasToolOutput =
                    msg.toolCalls &&
                    msg.toolCalls.length > 0 &&
                    msg.toolCalls.some((tc) => tc.output);
                if (data.message?.content && !msg.content && !hasToolOutput) {
                    msg.content = stripLeadingNewlines(
                        extractTextFromContent(data.message.content)
                    );
                } else if (msg.content) {
                    msg.content = stripLeadingNewlines(stripThinkingTagsFromText(msg.content));
                }
                // Extract model info from the final message
                if (data.message?.model) msg.model = data.message.model;
                if (data.message?.provider) msg.modelProvider = data.message.provider;
                // Extract usage info from the final message
                if (data.message?.usage) msg.usage = data.message.usage;
            } else if (data?.type === "error") {
                // Pi error event (timeout, rate limit, rejection, etc.)
                msg.streaming = false;
                msg.thinkingStreaming = false;
                msg.isError = true;
                // Try multiple error message sources
                const errorMsg =
                    data.error?.errorMessage ||
                    data.message?.errorMessage ||
                    data.reason ||
                    "An error occurred";
                msg.content = errorMsg;
                // End the message since it errored
                setStreamingMessageId(null, "message_update error");
                generating = false;
            }
        } catch {
            // If not JSON, treat as raw text
            if (e.data && typeof e.data === "string") {
                msg.content += e.data;
            }
        }
    });

    es.addEventListener("message_end", (e: MessageEvent) => {
        if (isStale()) return;
        console.log(`[chat] SSE 'message_end': lastEventId=${e.lastEventId}`);
        // Recovery is no longer relevant — the message is finalized
        recoveryTurnGeneration = null;
        // message_end data includes { type: "message_end", message: AgentMessage }
        // pi emits message_end for ALL message types, including toolResult —
        // we must skip non-assistant messages to avoid treating tool output as chat text
        try {
            const data = JSON.parse(e.data);
            if (data?.message?.role && data.message.role !== "assistant") {
                // This is a toolResult or other non-assistant message — skip it
                return;
            }
        } catch {
            // If we can't parse, proceed with best-effort handling
        }

        // Try to extract final text and thinking from the complete message
        const msg = getStreamingMsg();
        if (msg) {
            msg.streaming = false;
            msg.thinkingStreaming = false;
            // If we never got any content from deltas, try to extract from the final message
            // But skip content extraction if the message has tool calls with output —
            // the tool output is shown in the dropdown, and including it as message content
            // would create a duplicate bubble
            const hasToolOutput =
                msg.toolCalls &&
                msg.toolCalls.length > 0 &&
                msg.toolCalls.some((tc) => tc.output);
            try {
                const data = JSON.parse(e.data);
                if (data?.message) {
                    if (!msg.content && data.message.content && !hasToolOutput) {
                        msg.content = extractTextFromContent(data.message.content);
                    }
                    if (!msg.thinking) {
                        msg.thinking =
                            data.message.thinking ??
                            (data.message.content
                                ? extractThinkingFromContent(data.message.content)
                                : undefined);
                    }
                    // Extract model info
                    if (!msg.model && data.message.model) msg.model = data.message.model;
                    if (!msg.modelProvider && data.message.provider)
                        msg.modelProvider = data.message.provider;
                    // Extract usage info
                    if (!msg.usage && data.message.usage) msg.usage = data.message.usage;
                }
            } catch {
                // ignore
            }
            // Clean up leading newlines and any remaining thinking tags from model response
            if (msg.content) {
                msg.content = stripLeadingNewlines(stripThinkingTagsFromText(msg.content));
            }
            if (msg.thinking) {
                msg.thinking = stripLeadingNewlines(msg.thinking);
            }
        }
        setStreamingMessageId(null, "agent_end");
        generating = false;
    });

    es.addEventListener("tool_execution_start", (e: MessageEvent) => {
        if (isStale()) return;
        console.log(`[chat] SSE 'tool_execution_start': lastEventId=${e.lastEventId}, streamingMessageId=${streamingMessageId}`);
        // Tool execution can happen outside of a streaming message (e.g., after message_end)
        // Create a new assistant message if we don't have one
        if (!streamingMessageId) {
            const id = `assistant-tool-${Date.now()}`;
            setStreamingMessageId(id, "tool_execution_start new msg");
            messages.push({
                id,
                role: "assistant",
                content: "",
                timestamp: Date.now(),
                toolCalls: [],
                streaming: true,
            });
        }

        const msg = getStreamingMsg();
        if (!msg) return;

        try {
            const data = JSON.parse(e.data);
            msg.toolCalls = msg.toolCalls ?? [];
            msg.toolCalls.push({
                toolName: data.toolName ?? "unknown",
                status: "running",
                arguments: data.args ?? undefined,
            });
        } catch {
            // ignore parse errors
        }
    });

    es.addEventListener("tool_execution_update", (e: MessageEvent) => {
        if (isStale()) return;
        const msg = getStreamingMsg();
        if (!msg?.toolCalls?.length) return;

        try {
            const data = JSON.parse(e.data);
            // Find the running tool call by toolName (since tool_execution_update may not include toolCallId)
            const runningTool = msg.toolCalls.find((t) => t.status === "running");
            if (runningTool && data.output) {
                runningTool.output = (runningTool.output ?? "") + data.output;
            }
        } catch {
            // ignore
        }
    });

    es.addEventListener("tool_execution_end", (e: MessageEvent) => {
        if (isStale()) return;
        const msg = getStreamingMsg();
        if (!msg?.toolCalls?.length) return;

        try {
            const data = JSON.parse(e.data);
            // Find the running tool with this name and mark it completed
            const tool = msg.toolCalls.find(
                (t) => t.toolName === data.toolName && t.status === "running"
            );
            if (tool) {
                tool.status = data.isError ? "error" : "completed";
                tool.isError = data.isError;
                // Capture final result output if we didn't get it from tool_execution_update events
                // (e.g., for fast tools that complete without streaming partial results)
                if (data.result && !tool.output) {
                    tool.output = data.result;
                }
            }

            // If all tool calls are done, finalize the message
            const allDone = msg.toolCalls.every(
                (t) => t.status === "completed" || t.status === "error"
            );
            if (allDone) {
                msg.streaming = false;
                msg.thinkingStreaming = false;
                setStreamingMessageId(null, "tool_execution_end all done");
            }
        } catch {
            // ignore
        }
    });

    es.addEventListener("turn_start", () => {
        if (isStale()) return;
        // A new turn starts — may need a new assistant message for it
        generating = true;
    });

    es.addEventListener("turn_end", () => {
        if (isStale()) return;
        // Turn ended, but generation might continue with more turns
    });

    es.addEventListener("agent_start", () => {
        if (isStale()) return;
        console.log(`[chat] SSE 'agent_start' event received`);
        generating = true;
    });

    es.addEventListener("agent_end", () => {
        if (isStale()) return;
        console.log(`[chat] SSE 'agent_end' event received`);
        generating = false;
        recoveryTurnGeneration = null;
        const msg = getStreamingMsg();
        if (msg) {
            msg.streaming = false;
            msg.thinkingStreaming = false;
            if (msg.content)
                msg.content = stripLeadingNewlines(stripThinkingTagsFromText(msg.content));
            if (msg.thinking) msg.thinking = stripLeadingNewlines(msg.thinking);
        }
        setStreamingMessageId(null, "message_end");

        // Auto-generate title after first response if not already done
        if (!titleGenerationRequested && currentConversationId) {
            titleGenerationRequested = true;
            const convId = currentConversationId;
            generateTitle(convId)
                .then((result) => {
                    // Update sidebar if we got a title (either newly generated or already set server-side)
                    if (result.title && result.title !== "New Chat") {
                        updateConversationTitleAndTags(convId, result.title, result.tags ?? []);
                    }
                })
                .catch(() => {
                    // Title generation failed — non-critical, ignore
                });
        }

        // Reload message history from server to sync entry IDs.
        // During SSE streaming, messages get temporary IDs (e.g. "assistant-1234567890").
        // After generation completes, we need the real JSONL entry IDs for
        // delete/edit operations to work correctly.
        reloadMessages();
    });

    es.addEventListener("open", () => {
        console.log(`[chat] SSE 'open' event: EventSource connection opened`);
    });

    es.addEventListener("error", () => {
        if (isStale()) return;
        console.log(`[chat] SSE 'error' event: connection lost`);
        connected = false;
        error = "Connection lost. Reconnecting...";
    });

    // When the session tree is navigated (by us or another client), reload messages
    es.addEventListener("session_tree", () => {
        if (isStale()) return;
        // Only reload if we're not currently navigating ourselves
        // (our own navigate calls reloadMessages directly)
        if (!navigating) {
            reloadMessages();
        }
    });

    // Catch-all handler for any unnamed events — useful for debugging
    es.onmessage = (e: MessageEvent) => {
        console.log(`[chat] SSE onmessage (catch-all): type=${e.type}, lastEventId=${e.lastEventId}, data=${String(e.data).substring(0, 200)}`);
    };

    es.onerror = () => {
        if (isStale()) return;
        console.log(`[chat] SSE onerror: EventSource error`);
        connected = false;
        // EventSource will auto-reconnect
    };

    currentEventSource = es;
}

/**
 * Strip leading newlines from a string.
 * Models often start responses with extra newlines.
 */
function stripLeadingNewlines(text: string): string {
    return text.replace(/^\n+/, "");
}

/**
 * Track whether we're currently inside a <thinking> text block.
 * Some non-reasoning providers send thinking as text with <thinking>...</thinking> tags.
 */
let insideThinkingTag = false;

/**
 * Append a text delta to the message, handling <thinking>...</thinking> tags.
 * Routes content inside <thinking> tags to msg.thinking and other content to msg.content.
 */
function appendTextDelta(msg: ChatMessage, delta: string): void {
    let remaining = delta;

    while (remaining.length > 0) {
        if (insideThinkingTag) {
            // Look for the closing </thinking> tag
            const closeIdx = remaining.indexOf("</thinking>");
            if (closeIdx !== -1) {
                // Found the closing tag — everything before it is thinking content
                const thinkingChunk = remaining.substring(0, closeIdx);
                msg.thinking = (msg.thinking ?? "") + thinkingChunk;
                msg.thinkingStreaming = true;
                insideThinkingTag = false;
                remaining = remaining.substring(closeIdx + "</thinking>".length);
                msg.thinkingStreaming = false;
            } else {
                // Still inside thinking — entire delta is thinking content
                msg.thinking = (msg.thinking ?? "") + remaining;
                msg.thinkingStreaming = true;
                remaining = "";
            }
        } else {
            // Look for the opening <thinking> tag
            const openIdx = remaining.indexOf("<thinking>");
            if (openIdx !== -1) {
                // Content before the tag goes to msg.content
                const contentChunk = remaining.substring(0, openIdx);
                if (contentChunk) msg.content += contentChunk;
                insideThinkingTag = true;
                remaining = remaining.substring(openIdx + "<thinking>".length);
                msg.thinking = msg.thinking ?? "";
                msg.thinkingStreaming = true;
            } else {
                // No thinking tag — entire delta is regular content
                msg.content += remaining;
                remaining = "";
            }
        }
    }
}

/**
 * Extract text from pi's AssistantMessage.content array.
 * Content is an array of { type: "text", text: "..." } or { type: "thinking", thinking: "..." } etc.
 * Also handles <thinking>...</thinking> tags in text blocks for non-reasoning providers.
 */
function extractTextFromContent(content: unknown): string {
    if (!content) return "";
    if (typeof content === "string") return stripThinkingTagsFromText(content);
    if (!Array.isArray(content)) return "";

    // If content is a serialized array of text parts (from serializeMessage)
    if (content.length > 0 && typeof content[0] === "string") {
        return stripThinkingTagsFromText(content.join(""));
    }

    return content
        .filter((block: Record<string, unknown>) => block.type === "text")
        .map((block: Record<string, unknown>) => block.text ?? "")
        .join("");
}

/**
 * Extract thinking content from pi's AssistantMessage.content array.
 * Content blocks of type "thinking" have a "thinking" field.
 * Also extracts content from <thinking>...</thinking> tags in text blocks.
 */
function extractThinkingFromContent(content: unknown): string | undefined {
    if (!content || !Array.isArray(content)) return undefined;

    // First try actual thinking blocks
    const thinking = content
        .filter((block: Record<string, unknown>) => block.type === "thinking")
        .map((block: Record<string, unknown>) => block.thinking ?? "")
        .join("");

    if (thinking) return thinking;

    // Then try <thinking> tags in text blocks
    const textBlocks = content
        .filter(
            (block: Record<string, unknown>) =>
                block.type === "text" && typeof block.text === "string"
        )
        .map((block: Record<string, unknown>) => block.text as string);

    return extractThinkingFromTags(textBlocks.join("\n"));
}

/**
 * Extract thinking content from <thinking>...</thinking> tags in text.
 */
function extractThinkingFromTags(text: string): string | undefined {
    const match = text.match(/<thinking>([\s\S]*?)<\/thinking>/);
    return match?.[1]?.trim() || undefined;
}

/**
 * Strip <thinking>...</thinking> tags from text content.
 */
function stripThinkingTagsFromText(text: string): string {
    return text.replace(/<thinking>[\s\S]*?<\/thinking>\n?/g, "").trim();
}

export function disconnectStream(): void {
    console.log(`[chat] disconnectStream: conversationId=${currentConversationId}, hadEventSource=${!!currentEventSource}`);
    // Release the in-memory session on the server when switching away.
    // This is best-effort — if it fails, the idle timeout on the server
    // will eventually clean up.
    const convId = currentConversationId;
    if (convId) {
        releaseConversation(convId).catch(() => {
            // Best-effort — ignore failures (server idle timeout is the fallback)
        });
    }

    if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
    }
    connected = false;
    generating = false;
    setStreamingMessageId(null, "disconnectStream");
    currentConversationId = null;
    insideThinkingTag = false;
    lastModel = null;
    recoveryTurnGeneration = null;
}

/**
 * Send a user message and add it to the local message list.
 * The actual response comes through the SSE stream.
 */
export async function send(content: string, modelId?: string): Promise<void> {
    if (!currentConversationId) return;

    // Add user message to the local list
    messages.push({
        id: `user-${Date.now()}`,
        role: "user",
        content,
        timestamp: Date.now(),
    });

    error = null;

    try {
        await apiSend(currentConversationId, content, modelId);
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to send message";
    }
}

/**
 * Reload message history from the server and update the local message list.
 * Used after navigating the session tree (delete/edit) to sync local state.
 */
export async function reloadMessages(): Promise<void> {
    if (!currentConversationId) return;

    try {
        const history = await getMessageHistory(currentConversationId);
        // Rebuild messages array from server state
        messages = history.messages.map((msg) => ({
            id: msg.id,
            role: msg.role as ChatMessage["role"],
            content: msg.content,
            timestamp: msg.timestamp,
            thinking: msg.thinking,
            model: msg.model,
            modelProvider: msg.modelProvider,
            toolCalls:
                msg.toolCalls?.map((tc) => ({
                    toolName: tc.toolName,
                    status: tc.status as "running" | "completed" | "error",
                    output: tc.output,
                    arguments: tc.arguments,
                })) ?? [],
            isError: msg.isError,
            usage: msg.usage,
            streaming: false,
            thinkingStreaming: false,
        }));
        if (history.model) {
            lastModel = history.model;
        }
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to reload messages";
    }
}

/**
 * Delete a message (and all subsequent messages) by navigating the session tree.
 * Uses the pi SDK's navigateTree to move the leaf pointer back, which effectively
 * "deletes" the message and everything after it from the conversation branch.
 *
 * @param messageId - The ID of the message to delete
 * @param role - The role of the message ("user" or "assistant")
 */
export async function deleteMessage(messageId: string, role: string): Promise<void> {
    if (!currentConversationId) return;

    // If generating, abort first
    if (generating) {
        await abort();
    }

    // Finalize any streaming message before navigating
    if (streamingMessageId) {
        const msg = messages.find((m) => m.id === streamingMessageId);
        if (msg) {
            msg.streaming = false;
            msg.thinkingStreaming = false;
        }
        setStreamingMessageId(null, "deleteMessage");
    }

    navigating = true;
    error = null;

    try {
        await apiNavigate(currentConversationId, messageId);
        // Reload messages from server to reflect the new session state
        await reloadMessages();
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to delete message";
    } finally {
        navigating = false;
    }
}

/**
 * Edit a message by navigating the session tree back to before that message.
 * For user messages: navigates back and re-sends with the new text (in-place edit).
 * For assistant messages: navigates back to before the assistant message,
 * then re-sends the preceding user message to trigger re-generation.
 *
 * @param messageId - The ID of the message to edit
 * @param role - The role of the message ("user" or "assistant")
 * @param newText - For user messages: the edited text to send. If not provided, falls back to the original text.
 */
export async function editMessage(messageId: string, role: string, newText?: string): Promise<void> {
    if (!currentConversationId) return;

    // If generating, abort first
    if (generating) {
        await abort();
    }

    // Finalize any streaming message before navigating
    if (streamingMessageId) {
        const msg = messages.find((m) => m.id === streamingMessageId);
        if (msg) {
            msg.streaming = false;
            msg.thinkingStreaming = false;
        }
        setStreamingMessageId(null, "editMessage");
    }

    navigating = true;
    error = null;

    try {
        const result = await apiNavigate(currentConversationId, messageId);
        // Reload messages from server to reflect the new session state
        await reloadMessages();
        if (role === "user") {
            // For user messages, send the edited text (or the original if no edits were made)
            const textToSend = newText || result.editorText || "";
            if (textToSend) {
                await send(textToSend);
            }
        } else if (role === "assistant" && result.editorText) {
            // For assistant messages (regenerate), auto-resend the user message text
            // The navigateTree went back to the parent (user message), so editorText
            // contains the user message text — send it to get a fresh response
            await send(result.editorText);
        }
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to edit message";
    } finally {
        navigating = false;
    }
}

/**
 * In-place edit of an assistant message.
 *
 * Navigates back to before the target assistant message, appends a new version
 * with the edited text, and replays all subsequent entries. Does NOT trigger
 * a new AI generation.
 */
export async function editAssistantMessage(messageId: string, newContent: string): Promise<void> {
    if (!currentConversationId) return;

    // If generating, abort first
    if (generating) {
        await abort();
    }

    // Finalize any streaming message before navigating
    if (streamingMessageId) {
        const msg = messages.find((m) => m.id === streamingMessageId);
        if (msg) {
            msg.streaming = false;
            msg.thinkingStreaming = false;
        }
        setStreamingMessageId(null, "editAssistantMessage");
    }

    navigating = true;
    error = null;

    try {
        await apiEditAssistant(currentConversationId, messageId, newContent);
        // Reload messages from server to reflect the new session state
        await reloadMessages();
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to edit assistant message";
    } finally {
        navigating = false;
    }
}

/**
 * Abort the current generation.
 */
export async function abort(): Promise<void> {
    if (!currentConversationId) return;

    try {
        await apiAbort(currentConversationId);
        generating = false;
        if (streamingMessageId) {
            const msg = messages.find((m) => m.id === streamingMessageId);
            if (msg) msg.streaming = false;
            setStreamingMessageId(null, "abort");
        }
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to abort";
    }
}

/**
 * Clear messages (e.g. when switching conversations).
 */
export function clearMessages(): void {
    messages = [];
    setStreamingMessageId(null, "clearMessages");
    generating = false;
    error = null;
    insideThinkingTag = false;
    lastModel = null;
    titleGenerationRequested = false;
    recoveryTurnGeneration = null;
}

/**
 * Switch to a different conversation — disconnect old stream, clear messages,
 * connect to the new one.
 */
export function switchConversation(conversationId: string): void {
    if (conversationId === currentConversationId) return;

    clearMessages();
    connectStream(conversationId);
}

/**
 * Reconnect to the current conversation after a session restart.
 * Used when conversation settings change and the server disposes the
 * in-memory session (it will be lazily recreated on next connect).
 */
export function reconnectStream(): void {
    const convId = currentConversationId;
    if (!convId) return;

    // Close the current EventSource without sending a release request
    // since the server already disposed the session.
    if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
    }
    connected = false;
    generating = false;
    setStreamingMessageId(null, "disconnectStream");
    insideThinkingTag = false;

    // Reconnect — the server will create a fresh session with updated settings
    clearMessages();
    connectStream(convId);
}
