/**
 * Chat message management — handles message state, text extraction/parsing,
 * SSE message handlers, and message CRUD operations.
 *
 * This module is the "message half" of the chat store, split from chat.svelte.ts
 * along the same lines as session-store.ts: general conversation/session/chat
 * management vs. message management within chats.
 *
 * All functions take `ChatState` as their first parameter (explicit state pattern).
 * ChatState is imported as a type-only import from chat.svelte.ts — no circular
 * runtime dependency.
 */
import {
    getMessageHistory,
    generateTitle,
    navigateMessage as apiNavigate,
    editAssistantMessage as apiEditAssistant,
} from "$lib/api.js";
import type { MessageHistory } from "$lib/api.js";
import type { ChatMessage, FetchedSource } from "$lib/types.js";
import { messageHistoryToChatMessages } from "$lib/chat-history.js";
import { updateConversationTitleAndTags } from "./conversations.svelte.js";

// --- Type import from chat.svelte.ts (type-only, no circular runtime dependency) ---

import type { ChatState } from "./chat.svelte.js";
import { z } from "zod";
import { safeJsonParse } from "$lib/utils.js";

// --- Zod schemas for SSE event data ---
// These schemas provide runtime validation and type-safe parsing
// of SSE event payloads, replacing raw JSON.parse (which returns `any`).

const usageSchema = z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    totalTokens: z.number(),
});

const toolCallSchema = z.object({
    name: z.string().optional(),
    toolName: z.string().optional(),
    status: z.string().optional(),
    arguments: z.record(z.string(), z.unknown()).optional(),
    output: z.string().optional(),
    isError: z.boolean().optional(),
});

const sseMessageSchema = z.object({
    role: z.string().optional(),
    content: z.unknown().optional(),
    thinking: z.string().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    usage: usageSchema.optional(),
    errorMessage: z.string().optional(),
    stopReason: z.string().optional(),
    timestamp: z.number().optional(),
    toolCalls: z.array(toolCallSchema).optional(),
});

const sseStreamRecoverySchema = z.object({
    message: sseMessageSchema.optional(),
    turnGeneration: z.unknown().optional(),
});

const sseMessageStartSchema = z.object({
    message: sseMessageSchema.optional(),
});

const sseMessageUpdateSchema = z.object({
    type: z.string().optional(),
    delta: z.string().optional(),
    content: z.unknown().optional(),
    message: sseMessageSchema.optional(),
    error: z.object({ errorMessage: z.string().optional() }).optional(),
    reason: z.string().optional(),
});

const sseMessageEndSchema = z.object({
    message: sseMessageSchema.optional(),
});

const sseToolExecutionStartSchema = z.object({
    toolName: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
});

const sseToolExecutionUpdateSchema = z.object({
    output: z.string().optional(),
});

const sseToolExecutionEndSchema = z.object({
    toolName: z.string().optional(),
    isError: z.boolean().optional(),
    result: z.string().optional(),
});

// FetchedSource is a discriminated union — validate with proper schemas.
const searchResultItemSchema = z.object({
    url: z.string(),
    title: z.string(),
    text: z.string().optional(),
    publishedDate: z.string().optional(),
});

const fetchedSourceSchema: z.ZodType<FetchedSource> = z.union([
    z.object({
        type: z.literal("page"),
        url: z.string(),
        title: z.string(),
        contentLength: z.number(),
        truncated: z.boolean(),
        content: z.string(),
        turn: z.number(),
    }),
    z.object({
        type: z.literal("search"),
        query: z.string(),
        resultCount: z.number(),
        results: z.array(searchResultItemSchema),
        turn: z.number(),
    }),
]);

const sseFetchedSourcesSchema = z.object({
    sources: z.array(fetchedSourceSchema).optional(),
});

// --- State helpers (take ChatState as first parameter) ---

/** Set streamingMessageId with diagnostic logging. */
export function setStreamingMessageId(s: ChatState, id: string | null, reason: string): void {
    if (id === null && s.streamingMessageId !== null) {
        console.log(`[chat] streamingMessageId CLEARED: was ${s.streamingMessageId}, reason: ${reason}`);
        console.trace(`[chat] streamingMessageId cleared at:`);
    } else if (id !== null) {
        console.log(`[chat] streamingMessageId SET: ${id}, reason: ${reason}`);
    }
    s.streamingMessageId = id;
}

/** Find the currently streaming assistant message.
 *  Uses streamingMessageId as a fast-path cache, but falls back to scanning
 *  the messages array for a message with `streaming: true`. */
export function getStreamingMsg(s: ChatState): ChatMessage | undefined {
    if (s.streamingMessageId) {
        const msg = s.messages.find((m) => m.id === s.streamingMessageId);
        if (msg) return msg;
    }
    const streamingMsg = s.messages.find((m) => m.streaming);
    if (streamingMsg) {
        setStreamingMessageId(s, streamingMsg.id, "getStreamingMsg fallback recovery");
    }
    return streamingMsg;
}

// --- Text extraction/parsing helpers (pure functions or take state) ---

/** Strip leading newlines from a string.
 * Models often start responses with extra newlines. */
export function stripLeadingNewlines(text: string): string {
    return text.replace(/^\n+/, "");
}

/**
 * Append a text delta to the message, handling <thinking>...</thinking> tags.
 * Routes content inside <thinking> tags to msg.thinking and other content to msg.content.
 */
export function appendTextDelta(s: ChatState, msg: ChatMessage, delta: string): void {
    let remaining = delta;

    while (remaining.length > 0) {
        if (s.insideThinkingTag) {
            // Look for the closing </thinking> tag
            const closeIdx = remaining.indexOf("</thinking>");
            if (closeIdx !== -1) {
                // Found the closing tag — everything before it is thinking content
                const thinkingChunk = remaining.substring(0, closeIdx);
                msg.thinking = (msg.thinking ?? "") + thinkingChunk;
                msg.thinkingStreaming = true;
                s.insideThinkingTag = false;
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
                s.insideThinkingTag = true;
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
export function extractTextFromContent(content: unknown): string {
    if (!content) return "";
    if (typeof content === "string") return stripThinkingTagsFromText(content);
    if (!Array.isArray(content)) return "";

    // If content is a serialized array of text parts (from serializeMessage)
    if (content.length > 0 && typeof content[0] === "string") {
        return stripThinkingTagsFromText((content as string[]).join(""));
    }

    return content
        .filter((block: Record<string, unknown>) => block.type === "text" && typeof block.text === "string")
        .map((block: Record<string, unknown>) => block.text as string)
        .join("");
}

/**
 * Extract thinking content from pi's AssistantMessage.content array.
 * Content blocks of type "thinking" have a "thinking" field.
 * Also extracts content from <thinking>...</thinking> tags in text blocks.
 */
export function extractThinkingFromContent(content: unknown): string | undefined {
    if (!content || !Array.isArray(content)) return undefined;

    // First try actual thinking blocks
    const thinking = content
        .filter((block: Record<string, unknown>) => block.type === "thinking" && typeof block.thinking === "string")
        .map((block: Record<string, unknown>) => block.thinking as string)
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
export function extractThinkingFromTags(text: string): string | undefined {
    const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/;
    const match = thinkingRegex.exec(text);
    return match?.[1]?.trim() || undefined;
}

/**
 * Strip <thinking>...</thinking> tags from text content.
 */
export function stripThinkingTagsFromText(text: string): string {
    return text.replace(/<thinking>[\s\S]*?<\/thinking>\n?/g, "").trim();
}

// --- Message population and manipulation ---

/**
 * Populate the messages array from a MessageHistory payload.
 * Uses the shared messageHistoryToChatMessages for the pure conversion,
 * then applies store-specific side effects (lastModel, title generation).
 */
export function populateFromHistory(s: ChatState, history: MessageHistory, conversationId: string): void {
    const chatMessages = messageHistoryToChatMessages(history);
    console.log(`[chat-lifecycle] populateFromHistory: convId=${conversationId}, incoming=${String(chatMessages.length)}, existing=${String(s.messages.length)}`);
    for (const msg of chatMessages) {
        s.messages.push(msg);
    }
    console.log(`[chat-lifecycle] populateFromHistory: done, messages.length=${String(s.messages.length)}`);
    // Set the last model used from the history
    if (history.model) {
        s.lastModel = history.model;
    }

    // If this conversation already has messages but we haven't generated a title yet,
    // request one now (the server checks if the title is still "New Chat")
    if (history.messages.length > 0 && !s.titleGenerationRequested) {
        s.titleGenerationRequested = true;
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

/** Clear all message state. */
export function clearMessages(s: ChatState): void {
    s.messages = [];
    setStreamingMessageId(s, null, "clearMessages");
    s.generating = false;
    s.error = null;
    s.insideThinkingTag = false;
    s.lastModel = null;
    s.titleGenerationRequested = false;
    s.recoveryTurnGeneration = null;
}

/**
 * Reload message history from the server and update the local message list.
 * Used after navigating the session tree (delete/edit) to sync local state.
 */
export async function reloadMessages(s: ChatState): Promise<void> {
    if (!s.currentConversationId) return;

    try {
        const history = await getMessageHistory(s.currentConversationId);
        console.log(`[chat-lifecycle] reloadMessages: convId=${s.currentConversationId}, serverMsgCount=${String(history.messages.length)}, localMsgCount=${String(s.messages.length)}`);
        // Rebuild messages array from server state
        s.messages = history.messages.map((msg) => ({
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
            errorMessage: msg.errorMessage,
            usage: msg.usage,
            fetchedSources: msg.fetchedSources,
            streaming: false,
            thinkingStreaming: false,
        }));
        if (history.model) {
            s.lastModel = history.model;
        }
    } catch (e) {
        s.error = e instanceof Error ? e.message : "Failed to reload messages";
    }
}

// --- Message CRUD operations ---

/**
 * Delete a message (and all subsequent messages) by navigating the session tree.
 * Uses the pi SDK's navigateTree to move the leaf pointer back, which effectively
 * "deletes" the message and everything after it from the conversation branch.
 *
 * @param s - The chat state
 * @param messageId - The ID of the message to delete
 * @param role - The role of the message ("user" or "assistant")
 * @param abortFn - Callback to abort current generation (from chat.svelte.ts)
 */
export async function deleteMessage(
    s: ChatState,
    messageId: string,
    _role: string,
    abortFn: () => Promise<void>
): Promise<void> {
    if (!s.currentConversationId) return;

    // If generating, abort first
    if (s.generating) {
        await abortFn();
    }

    // Finalize any streaming message before navigating
    if (s.streamingMessageId) {
        const msg = s.messages.find((m) => m.id === s.streamingMessageId);
        if (msg) {
            msg.streaming = false;
            msg.thinkingStreaming = false;
        }
        setStreamingMessageId(s, null, "deleteMessage");
    }

    s.navigating = true;
    s.error = null;

    try {
        await apiNavigate(s.currentConversationId, messageId);
        // Reload messages from server to reflect the new session state
        await reloadMessages(s);
    } catch (e) {
        s.error = e instanceof Error ? e.message : "Failed to delete message";
    } finally {
        s.navigating = false;
    }
}

/**
 * Edit a message by navigating the session tree back to before that message.
 * For user messages: navigates back and re-sends with the new text (in-place edit).
 * For assistant messages: navigates back to before the assistant message,
 * then re-sends the preceding user message to trigger re-generation.
 *
 * @param s - The chat state
 * @param messageId - The ID of the message to edit
 * @param role - The role of the message ("user" or "assistant")
 * @param newText - For user messages: the edited text to send. If not provided, falls back to the original text.
 * @param abortFn - Callback to abort current generation (from chat.svelte.ts)
 * @param sendFn - Callback to send a message (from chat.svelte.ts)
 */
export async function editMessage(
    s: ChatState,
    messageId: string,
    role: string,
    newText: string | undefined,
    abortFn: () => Promise<void>,
    sendFn: (content: string) => Promise<void>
): Promise<void> {
    if (!s.currentConversationId) return;

    // If generating, abort first
    if (s.generating) {
        await abortFn();
    }

    // Finalize any streaming message before navigating
    if (s.streamingMessageId) {
        const msg = s.messages.find((m) => m.id === s.streamingMessageId);
        if (msg) {
            msg.streaming = false;
            msg.thinkingStreaming = false;
        }
        setStreamingMessageId(s, null, "editMessage");
    }

    s.navigating = true;
    s.error = null;

    try {
        const result = await apiNavigate(s.currentConversationId, messageId);
        // Reload messages from server to reflect the new session state
        await reloadMessages(s);
        if (role === "user") {
            // For user messages, send the edited text (or the original if no edits were made)
            const textToSend = newText || result.editorText || "";
            if (textToSend) {
                await sendFn(textToSend);
            }
        } else if (role === "assistant" && result.editorText) {
            // For assistant messages (regenerate), auto-resend the user message text
            // The navigateTree went back to the parent (user message), so editorText
            // contains the user message text — send it to get a fresh response
            await sendFn(result.editorText);
        }
    } catch (e) {
        s.error = e instanceof Error ? e.message : "Failed to edit message";
    } finally {
        s.navigating = false;
    }
}

/**
 * In-place edit of an assistant message.
 *
 * Navigates back to before the target assistant message, appends a new version
 * with the edited text, and replays all subsequent entries. Does NOT trigger
 * a new AI generation.
 *
 * @param s - The chat state
 * @param messageId - The ID of the message to edit
 * @param newContent - The new content for the assistant message
 * @param abortFn - Callback to abort current generation (from chat.svelte.ts)
 */
export async function editAssistantMessage(
    s: ChatState,
    messageId: string,
    newContent: string,
    abortFn: () => Promise<void>
): Promise<void> {
    if (!s.currentConversationId) return;

    // If generating, abort first
    if (s.generating) {
        await abortFn();
    }

    // Finalize any streaming message before navigating
    if (s.streamingMessageId) {
        const msg = s.messages.find((m) => m.id === s.streamingMessageId);
        if (msg) {
            msg.streaming = false;
            msg.thinkingStreaming = false;
        }
        setStreamingMessageId(s, null, "editAssistantMessage");
    }

    s.navigating = true;
    s.error = null;

    try {
        await apiEditAssistant(s.currentConversationId, messageId, newContent);
        // Reload messages from server to reflect the new session state
        await reloadMessages(s);
    } catch (e) {
        s.error = e instanceof Error ? e.message : "Failed to edit assistant message";
    } finally {
        s.navigating = false;
    }
}

// --- SSE handlers that modify message state ---

/** Handle the 'stream_recovery' SSE event. */
export function handleStreamRecovery(s: ChatState, e: MessageEvent): void {
    console.log(`[chat] SSE 'stream_recovery' event received`);
    try {
        const data = safeJsonParse(e.data as string, sseStreamRecoverySchema);
        if (data?.message) {
            s.generating = true;
            s.recoveryTurnGeneration = typeof data.turnGeneration === "number" ? data.turnGeneration : null;

            const id = `assistant-recovered-${String(Date.now())}`;
            setStreamingMessageId(s, id, "stream_recovery");

            // Extract text content — serializeMessage returns content as string[]
            const text = extractTextFromContent(data.message.content) || "";
            // Thinking is already extracted by serializeMessage into a separate field
            const thinking = data.message.thinking ?? undefined;
            // Map tool calls from the enriched recovery format.
            // serializeStreamingMessageForRecovery adds status/output/isError
            // by cross-referencing ToolResultMessage entries, so completed
            // tools show up correctly instead of being stuck as "running".
            const toolCalls = (data.message.toolCalls ?? []).map((tc) => ({
                toolName: tc.name ?? tc.toolName ?? "unknown",
                status: (tc.status ?? "running") as "running" | "completed" | "error",
                arguments: tc.arguments,
                output: tc.output,
                isError: tc.isError,
            }));

            s.messages.push({
                id,
                role: "assistant",
                content: text,
                timestamp: data.message.timestamp ?? Date.now(),
                thinking: thinking,
                thinkingStreaming: !!thinking,
                model: data.message.model,
                modelProvider: data.message.provider,
                toolCalls,
                fetchedSources: undefined,
                streaming: true,
            });
            console.log(`[chat-lifecycle] handleStreamRecovery: pushed assistant msg id=${id}, messages.length=${String(s.messages.length)}, contentLen=${String(text.length)}, thinkingLen=${String(thinking?.length ?? 0)}`);
        }
    } catch {
        // ignore parse errors
    }
}

/** Handle the 'message_start' SSE event. */
export function handleMessageStart(s: ChatState, e: MessageEvent): void {
    console.log(`[chat] SSE 'message_start': lastEventId=${e.lastEventId}`);
    try {
        const data = safeJsonParse(e.data as string, sseMessageStartSchema);
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
                    const alreadyExists = s.messages.some(
                        (m) => m.role === "user" && m.content === content
                    );
                    if (!alreadyExists) {
                        s.messages.push({
                            id: `user-sse-${String(Date.now())}`,
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
    if (s.streamingMessageId) {
        const prevMsg = s.messages.find((m) => m.id === s.streamingMessageId);
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
    s.generating = true;
    const id = `assistant-${String(Date.now())}`;
    setStreamingMessageId(s, id, "message_start assistant");
    console.log(`[chat-lifecycle] handleMessageStart: BEFORE push assistant msg id=${id}, messages.length=${String(s.messages.length)}, generating=${String(s.generating)}, connected=${String(s.connected)}, streamingMessageId=${s.streamingMessageId ?? "null"}`);
    s.messages.push({
        id,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        toolCalls: [],
        fetchedSources: undefined,
        streaming: true,
    });
    console.log(`[chat-lifecycle] handleMessageStart: AFTER push assistant msg id=${id}, messages.length=${String(s.messages.length)}, msg.streaming=${String(s.messages[s.messages.length - 1]?.streaming)}`);

    // message_start data includes { type: "message_start", message: AgentMessage }
    // The partial message might already have content, thinking, or model info
    try {
        const data = safeJsonParse(e.data as string, sseMessageStartSchema);
        if (data?.message) {
            const msg = s.messages.find((m) => m.id === id);
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
}

/** Handle the 'message_update' SSE event. */
export function handleMessageUpdate(s: ChatState, e: MessageEvent): void {
    const msg = getStreamingMsg(s);
    if (!msg) {
        console.log(`[chat-lifecycle] handleMessageUpdate: DROPPED (no streaming message found), streamingMessageId=${s.streamingMessageId ?? "null"}, messages.length=${String(s.messages.length)}, lastEventId=${e.lastEventId}`);
        return;
    }

    try {
        const data = safeJsonParse(e.data as string, sseMessageUpdateSchema);

        if (!data) {
            // If not valid JSON or doesn't match schema, treat as raw text
            if (e.data && typeof e.data === "string") {
                msg.content += e.data;
            }
            return;
        }

        // Log first content arrival and every 50th delta for streaming diagnostics
        if (data.type === "text_delta" && data.delta) {
            if (!msg.content || msg.content.length < 10) {
                console.log(`[chat-lifecycle] handleMessageUpdate: first text_delta for msg id=${msg.id}, contentLen=${String(msg.content.length)}, deltaLen=${String(data.delta.length)}`);
            }
        }

        // pi's AssistantMessageEvent format:
        // { type: "text_delta", delta: "chunk", contentIndex: 0, partial: ... }
        // { type: "text_end", content: "full text", contentIndex: 0, partial: ... }
        // { type: "thinking_delta", delta: "chunk", contentIndex: 0, partial: ... }
        // { type: "toolcall_start", contentIndex: 0, partial: ... }
        // { type: "toolcall_delta", delta: "chunk", contentIndex: 0, partial: ... }
        // { type: "toolcall_end", toolCall: {...}, contentIndex: 0, partial: ... }
        // { type: "done", reason: "stop", message: AssistantMessage }
        // { type: "error", reason: "error", error: AssistantMessage }

        if (data.type === "text_delta" && data.delta) {
            // Check if the delta starts with or is inside a <thinking> tag
            // Some providers send thinking as text with <thinking>...</thinking> tags
            appendTextDelta(s, msg, data.delta);
        } else if (data.type === "text_end" && data.content) {
            // text_end includes the full content for this content block — we can ignore
            // since we've been accumulating deltas, or use it to verify
        } else if (data.type === "thinking_start") {
            // Model is starting to think/reason
            msg.thinkingStreaming = true;
            msg.thinking = "";
        } else if (data.type === "thinking_delta" && data.delta) {
            // Accumulate thinking content
            msg.thinking = (msg.thinking ?? "") + data.delta;
            msg.thinkingStreaming = true;
        } else if (data.type === "thinking_end") {
            // Thinking complete
            msg.thinkingStreaming = false;
        } else if (data.type === "done") {
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
            if (data.message?.usage)
                msg.usage = data.message.usage;
        } else if (data.type === "error") {
            // Pi error event (timeout, rate limit, rejection, etc.)
            console.error(`[chat-lifecycle] handleMessageUpdate ERROR event:`, JSON.stringify(data).substring(0, 1000));
            msg.streaming = false;
            msg.thinkingStreaming = false;
            msg.isError = true;
            // Try multiple error message sources
            const errorMsg =
                data.error?.errorMessage ||
                data.message?.errorMessage ||
                data.reason ||
                "An error occurred";
            msg.errorMessage = errorMsg;
            msg.content = errorMsg;
            // End the message since it errored
            setStreamingMessageId(s, null, "message_update error");
            s.generating = false;
        }
    } catch {
        // Catch unexpected errors in message processing
    }
}

/** Handle the 'message_end' SSE event. */
export function handleMessageEnd(s: ChatState, e: MessageEvent): void {
    console.log(`[chat-lifecycle] handleMessageEnd: lastEventId=${e.lastEventId}, streamingMessageId=${s.streamingMessageId ?? "null"}, messages.length=${String(s.messages.length)}`);
    // Recovery is no longer relevant — the message is finalized
    s.recoveryTurnGeneration = null;

    // message_end data includes { type: "message_end", message: AgentMessage }
    // pi emits message_end for ALL message types, including toolResult —
    // we must skip non-assistant messages to avoid treating tool output as chat text
    try {
        const data = safeJsonParse(e.data as string, sseMessageEndSchema);
        if (data?.message?.role && data.message.role !== "assistant") {
            // This is a toolResult or other non-assistant message — skip it
            return;
        }
    } catch {
        // If we can't parse, proceed with best-effort handling
    }

    // Try to extract final text and thinking from the complete message
    const msg = getStreamingMsg(s);
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
            const data = safeJsonParse(e.data as string, sseMessageEndSchema);
            if (data?.message) {
                // Check if the final message indicates an error (stopReason "error" or errorMessage)
                if (data.message.stopReason === "error" || data.message.errorMessage) {
                    console.error(`[chat-lifecycle] handleMessageEnd: error detected in final message, stopReason=${String(data.message.stopReason)}, errorMessage=${String(data.message.errorMessage)}`);
                    if (!msg.isError) {
                        msg.isError = true;
                    }
                    if (!msg.errorMessage) {
                        msg.errorMessage = data.message.errorMessage || "An error occurred";
                    }
                    if (!msg.content) {
                        msg.content = data.message.errorMessage || "An error occurred";
                    }
                }
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
    setStreamingMessageId(s, null, "message_end");
    // Don't set generating = false here — in multi-turn agent loops,
    // the agent continues after message_end with more tool calls and
    // messages. The agent_end event is the authoritative signal that
    // generation is truly done.
}

/** Handle the 'tool_execution_start' SSE event. */
export function handleToolExecutionStart(s: ChatState, e: MessageEvent): void {
    console.log(`[chat-lifecycle] handleToolExecutionStart: streamingMessageId=${s.streamingMessageId ?? "null"}, messages.length=${String(s.messages.length)}`);
    // Tool execution can happen outside of a streaming message (e.g., after message_end)
    // Create a new assistant message if we don't have one
    if (!s.streamingMessageId) {
        const id = `assistant-tool-${String(Date.now())}`;
        setStreamingMessageId(s, id, "tool_execution_start new msg");
        s.messages.push({
            id,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            toolCalls: [],
            fetchedSources: undefined,
            streaming: true,
        });
        console.log(`[chat-lifecycle] handleToolExecutionStart: pushed new assistant msg id=${id}, messages.length=${String(s.messages.length)}`);
    }

    const msg = getStreamingMsg(s);
    if (!msg) return;

    try {
        const data = safeJsonParse(e.data as string, sseToolExecutionStartSchema);
        if (!data) return;
        msg.toolCalls = msg.toolCalls ?? [];
        msg.toolCalls.push({
            toolName: data.toolName ?? "unknown",
            status: "running",
            arguments: data.args ?? undefined,
        });
    } catch {
        // ignore parse errors
    }
}

/** Handle the 'tool_execution_update' SSE event. */
export function handleToolExecutionUpdate(s: ChatState, e: MessageEvent): void {
    const msg = getStreamingMsg(s);
    if (!msg?.toolCalls?.length) return;

    try {
        const data = safeJsonParse(e.data as string, sseToolExecutionUpdateSchema);
        if (!data) return;
        // Find the running tool call by toolName (since tool_execution_update may not include toolCallId)
        const runningTool = msg.toolCalls.find((t) => t.status === "running");
        if (runningTool && data.output) {
            runningTool.output = (runningTool.output ?? "") + data.output;
        }
    } catch {
        // ignore
    }
}

/** Handle the 'tool_execution_end' SSE event. */
export function handleToolExecutionEnd(s: ChatState, e: MessageEvent): void {
    const msg = getStreamingMsg(s);
    if (!msg?.toolCalls?.length) return;

    try {
        const data = safeJsonParse(e.data as string, sseToolExecutionEndSchema);
        if (!data) return;
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
            setStreamingMessageId(s, null, "tool_execution_end all done");
        }
    } catch {
        // ignore
    }
}

/** Handle the 'fetched_sources' SSE event. */
export function handleFetchedSources(s: ChatState, e: MessageEvent): void {
    try {
        const data = safeJsonParse(e.data as string, sseFetchedSourcesSchema);
        if (!data) return;
        const sources = data.sources;
        if (!sources || sources.length === 0) return;
        // Try the streaming message first (sources flushed before message_end)
        let msg = getStreamingMsg(s);
        if (!msg || msg.role !== "assistant") {
            // Fallback: find the last assistant message (sources flushed after message_end)
            for (let i = s.messages.length - 1; i >= 0; i--) {
                if (s.messages[i].role === "assistant") {
                    msg = s.messages[i];
                    break;
                }
            }
        }
        if (msg && msg.role === "assistant") {
            // Accumulate sources across multiple flushes within one turn
            msg.fetchedSources = [...(msg.fetchedSources ?? []), ...sources];
        }
    } catch {
        // ignore parse errors
    }
}

// --- New helpers ---

/**
 * Finalize the current streaming message: mark it as non-streaming,
 * clean up thinking tags and leading newlines, and clear the streaming ID.
 */
export function finalizeStreamingMessage(s: ChatState, reason: string): void {
    const msg = getStreamingMsg(s);
    if (msg) {
        msg.streaming = false;
        msg.thinkingStreaming = false;
        if (msg.content)
            msg.content = stripLeadingNewlines(stripThinkingTagsFromText(msg.content));
        if (msg.thinking) msg.thinking = stripLeadingNewlines(msg.thinking);
    }
    setStreamingMessageId(s, null, reason);
}
