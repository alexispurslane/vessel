/**
 * @file Chat message store: SSE event handling, streaming state, and message list management.
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
    regenWithFeedback as apiRegenWithFeedback,
} from "$lib/api.js";
import type { MessageHistory } from "$lib/api.js";
import type { ChatMessage, FetchedSource, SessionTiming, TurnTiming } from "$lib/types.js";
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

const turnTimingSchema: z.ZodType<TurnTiming> = z.object({
    turn: z.number(),
    ttftMs: z.number().nullable(),
    tps: z.number().nullable(),
    outputTokens: z.number(),
    totalTurnMs: z.number().nullable(),
});

const sseTurnTimingSchema = z.object({
    timing: turnTimingSchema.optional(),
});

// --- State helpers (take ChatState as first parameter) ---

/**
 * Set streamingMessageId with diagnostic logging.
 * @param s - The chat state
 * @param id - The streaming message ID to set, or null to clear
 * @param reason - Reason for the change (for diagnostic logging)
 * @returns {void}
 */
export function setStreamingMessageId(s: ChatState, id: string | null, reason: string): void {
    if (id === null && s.streamingMessageId !== null) {
        console.log(`[chat] streamingMessageId CLEARED: was ${s.streamingMessageId}, reason: ${reason}`);
        console.trace(`[chat] streamingMessageId cleared at:`);
    } else if (id !== null) {
        console.log(`[chat] streamingMessageId SET: ${id}, reason: ${reason}`);
    }
    s.streamingMessageId = id;
}

/**
 * Find the currently streaming assistant message.
 * Uses streamingMessageId as a fast-path cache, but falls back to scanning
 * the messages array for a message with `streaming: true`.
 * @param s - The chat state
 * @returns The streaming message, or undefined if none found
 */
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

/**
 * Strip leading newlines from a string.
 * Models often start responses with extra newlines.
 * @param text - The text to strip leading newlines from
 * @returns The text with leading newlines removed
 */
export function stripLeadingNewlines(text: string): string {
    return text.replace(/^\n+/, "");
}

/**
 * Process remaining text while inside a <thinking> tag.
 * Looks for the closing tag and routes content to msg.thinking.
 *
 * @param s - The chat state (mutates insideThinkingTag)
 * @param msg - The message to append thinking content to
 * @param remaining - The remaining unprocessed text
 * @returns The new remaining text after processing
 */
function processInsideThinking(s: ChatState, msg: ChatMessage, remaining: string): string {
    const closeIdx = remaining.indexOf("</thinking>");
    if (closeIdx !== -1) {
        const thinkingChunk = remaining.substring(0, closeIdx);
        msg.thinking = (msg.thinking ?? "") + thinkingChunk;
        msg.thinkingStreaming = true;
        s.insideThinkingTag = false;
        msg.thinkingStreaming = false;
        return remaining.substring(closeIdx + "</thinking>".length);
    }
    msg.thinking = (msg.thinking ?? "") + remaining;
    msg.thinkingStreaming = true;
    return "";
}

/**
 * Process remaining text while outside a <thinking> tag.
 * Looks for an opening tag and routes content to msg.content.
 *
 * @param s - The chat state (mutates insideThinkingTag)
 * @param msg - The message to append regular content to
 * @param remaining - The remaining unprocessed text
 * @returns The new remaining text after processing
 */
function processOutsideThinking(s: ChatState, msg: ChatMessage, remaining: string): string {
    const openIdx = remaining.indexOf("<thinking>");
    if (openIdx !== -1) {
        const contentChunk = remaining.substring(0, openIdx);
        if (contentChunk) msg.content += contentChunk;
        s.insideThinkingTag = true;
        remaining = remaining.substring(openIdx + "<thinking>".length);
        msg.thinking = msg.thinking ?? "";
        msg.thinkingStreaming = true;
        return remaining;
    }
    msg.content += remaining;
    return "";
}

/**
 * Append a text delta to the message, handling <thinking>...</thinking> tags.
 * Routes content inside <thinking> tags to msg.thinking and other content to msg.content.
 * @param s - The chat state
 * @param msg - The message to append the delta to
 * @param delta - The text delta to append
 * @returns {void}
 */
export function appendTextDelta(s: ChatState, msg: ChatMessage, delta: string): void {
    let remaining = delta;

    while (remaining.length > 0) {
        remaining = s.insideThinkingTag
            ? processInsideThinking(s, msg, remaining)
            : processOutsideThinking(s, msg, remaining);
    }
}

/**
 * Extract text from pi's AssistantMessage.content array.
 * Content is an array of { type: "text", text: "..." } or { type: "thinking", thinking: "..." } etc.
 * Also handles <thinking>...</thinking> tags in text blocks for non-reasoning providers.
 * @param content - The content to extract text from (string, array of parts, or nullish)
 * @returns The extracted text string
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
 * @param content - The content to extract thinking from
 * @returns The extracted thinking text, or undefined if none found
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
 * @param text - The text to search for thinking tags
 * @returns The extracted thinking text, or undefined if no tags found
 */
export function extractThinkingFromTags(text: string): string | undefined {
    const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/;
    const match = thinkingRegex.exec(text);
    return match?.[1]?.trim() || undefined;
}

/**
 * Strip <thinking>...</thinking> tags from text content.
 * @param text - The text to strip thinking tags from
 * @returns The text with thinking tags and their content removed
 */
export function stripThinkingTagsFromText(text: string): string {
    // oxlint-disable-next-line secure-coding/no-improper-sanitization -- AI tag strip
    return text.replace(/<thinking>[\s\S]*?<\/thinking>\n?/g, "").trim();
}

// --- Message population and manipulation ---

/**
 * Populate the messages array from a MessageHistory payload.
 * Uses the shared messageHistoryToChatMessages for the pure conversion,
 * then applies store-specific side effects (conversationDefaultModel, title generation).
 * @param s - The chat state
 * @param history - The message history from the server
 * @param conversationId - The conversation ID for title generation
 * @returns {void}
 */
export function populateFromHistory(s: ChatState, history: MessageHistory, conversationId: string): void {
    const chatMessages = messageHistoryToChatMessages(history);
    console.log(`[chat-lifecycle] populateFromHistory: convId=${conversationId}, incoming=${String(chatMessages.length)}, existing=${String(s.messages.length)}`);
    for (const msg of chatMessages) {
        s.messages.push(msg);
    }
    console.log(`[chat-lifecycle] populateFromHistory: done, messages.length=${String(s.messages.length)}`);
    // Set the conversation's default model from the history
    if (history.model) {
        s.conversationDefaultModel = history.model;
    }
    if (history.timing) {
        s.timing = history.timing;
    }

    // If this conversation has messages but no title yet, request
    // one now (server checks if the title is still "New Chat")
    if (history.messages.length > 0 && !s.titleGenerationRequested) {
        s.titleGenerationRequested = true;
        const convId = conversationId;
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

/**
 * Clear all message state.
 * @param s - The chat state
 * @returns {void}
 */
export function clearMessages(s: ChatState): void {
    s.messages = [];
    setStreamingMessageId(s, null, "clearMessages");
    s.generating = false;
    s.error = null;
    s.insideThinkingTag = false;
    s.conversationDefaultModel = null;
    s.timing = null;
    s.titleGenerationRequested = false;
    s.recoveryTurnGeneration = null;
}

/**
 * Reload message history from the server and update the local message list.
 * Used after navigating the session tree (delete/edit) to sync local state.
 * @param s - The chat state
 * @returns {void}
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
            s.conversationDefaultModel = history.model;
        }
        if (history.timing) {
            s.timing = history.timing;
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
 * @param _role - The role of the message ("user" or "assistant")
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
/**
 * Abort current generation and finalize any streaming message.
 * @param s - The chat state
 * @param abortFn - Callback to abort current generation
 * @param reason - Reason for abort (used in diagnostic logging)
 * @returns {void}
 */
async function abortAndFinalize(s: ChatState, abortFn: () => Promise<void>, reason: string): Promise<void> {
    if (s.generating) await abortFn();
    if (s.streamingMessageId) {
        const msg = s.messages.find((m) => m.id === s.streamingMessageId);
        if (msg) {
            msg.streaming = false;
            msg.thinkingStreaming = false;
        }
        setStreamingMessageId(s, null, reason);
    }
}

/**
 * Send the appropriate message after an edit/navigation.
 * @param role - The role of the edited message ("user" or "assistant")
 * @param newText - For user messages: the new text to send
 * @param editorText - The editor text from the navigation result
 * @param sendFn - Callback to send a message
 * @returns {void}
 */
async function sendEditedMessage(
    role: string,
    newText: string | undefined,
    editorText: string | undefined,
    sendFn: (content: string) => Promise<void>
): Promise<void> {
    if (role === "user") {
        const textToSend = newText || editorText || "";
        if (textToSend) await sendFn(textToSend);
    } else if (role === "assistant" && editorText) {
        // For assistant messages (regenerate), resend the user message text
        await sendFn(editorText);
    }
}

/** Options for editing a message (new text + callbacks). */
interface EditMessageOptions {
    /** New text for the edited message, or undefined to use server-provided editor text. */
    newText: string | undefined;
    /** Callback to abort the current generation. */
    abortFn: () => Promise<void>;
    /** Callback to send a message with the given content. */
    sendFn: (content: string) => Promise<void>;
}

/**
 * Edit a message by navigating back and re-sending.
 *
 * @param s - The chat state
 * @param messageId - The ID of the message to edit
 * @param role - The role of the message ("user" or "assistant")
 * @param options - Edit options (new text, abort callback, send callback)
 * @returns {void}
 */
export async function editMessage(
    s: ChatState,
    messageId: string,
    role: string,
    options: EditMessageOptions
): Promise<void> {
    if (!s.currentConversationId) return;

    await abortAndFinalize(s, options.abortFn, "editMessage");

    s.navigating = true;
    s.error = null;

    try {
        const result = await apiNavigate(s.currentConversationId, messageId);
        await reloadMessages(s);
        await sendEditedMessage(role, options.newText, result.editorText, options.sendFn);
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

/**
 * Regenerate an assistant message with user feedback.
 *
 * Navigates back to before the target assistant message (creating a new branch),
 * then sends the user's critique as a hidden custom message that quotes the
 * original response and triggers a new LLM turn. The AI generates a corrected
 * response based on the feedback.
 *
 * @param s - The chat state
 * @param messageId - The ID of the assistant message to regenerate
 * @param feedback - The user's critique of what was wrong
 * @param abortFn - Callback to abort current generation
 */
export async function regenWithFeedback(
    s: ChatState,
    messageId: string,
    feedback: string,
    abortFn: () => Promise<void>
): Promise<void> {
    if (!s.currentConversationId) return;

    await abortAndFinalize(s, abortFn, "regenWithFeedback");

    // Trim messages to remove target assistant msg and all after
    // it. Only the new response is visible during SSE streaming.
    const targetIdx = s.messages.findIndex((m) => m.id === messageId);
    if (targetIdx !== -1) {
        s.messages = s.messages.slice(0, targetIdx);
    }

    s.navigating = true;
    s.error = null;

    try {
        await apiRegenWithFeedback(s.currentConversationId, messageId, feedback);
        // Reload messages from server to reflect the new session state
        await reloadMessages(s);
    } catch (e) {
        s.error = e instanceof Error ? e.message : "Failed to regenerate with feedback";
    } finally {
        s.navigating = false;
    }
}

// --- SSE handlers that modify message state ---

/**
 * Map tool calls from the enriched recovery format.
 * @param tcs - Raw tool call data from the SSE recovery schema
 * @returns Mapped tool calls for a ChatMessage
 */
function mapRecoveryToolCalls(tcs: z.infer<typeof toolCallSchema>[] | undefined): ChatMessage["toolCalls"] {
    return (tcs ?? []).map((tc) => ({
        toolName: tc.name ?? tc.toolName ?? "unknown",
        status: (tc.status ?? "running") as "running" | "completed" | "error",
        arguments: tc.arguments,
        output: tc.output,
        isError: tc.isError,
    }));
}

/**
 * Handle the 'stream_recovery' SSE event.
 * @param s - The chat state
 * @param e - The SSE MessageEvent
 * @returns {void}
 */
export function handleStreamRecovery(s: ChatState, e: MessageEvent): void {
    console.log(`[chat] SSE 'stream_recovery' event received`);
    try {
        const data = safeJsonParse(e.data as string, sseStreamRecoverySchema);
        if (!data?.message) return;

        s.generating = true;
        s.recoveryTurnGeneration = typeof data.turnGeneration === "number" ? data.turnGeneration : null;

        const id = `assistant-recovered-${String(Date.now())}`;
        setStreamingMessageId(s, id, "stream_recovery");

        const text = extractTextFromContent(data.message.content) || "";
        const thinking = data.message.thinking ?? undefined;
        const toolCalls = mapRecoveryToolCalls(data.message.toolCalls);

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
    } catch {
        // ignore parse errors
    }
}

/**
 * Handle a non-assistant message_start (user messages from external sources).
 * @param s - The chat state
 * @param data - Parsed SSE message_start data
 * @returns {void}
 */
function handleNonAssistantStart(s: ChatState, data: z.infer<typeof sseMessageStartSchema>): void {
    if (data.message?.role !== "user") return;
    const content =
        typeof data.message.content === "string"
            ? data.message.content
            : extractTextFromContent(data.message.content);
    if (!content) return;
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

/**
 * Finalize a previous streaming message (content cleanup, stop streaming).
 * @param s - The chat state
 * @returns {void}
 */
function finalizePrevStreamingMessage(s: ChatState): void {
    if (!s.streamingMessageId) return;
    const prevMsg = s.messages.find((m) => m.id === s.streamingMessageId);
    if (!prevMsg) return;
    prevMsg.streaming = false;
    prevMsg.thinkingStreaming = false;
    if (prevMsg.content) {
        prevMsg.content = stripLeadingNewlines(stripThinkingTagsFromText(prevMsg.content));
    }
    if (prevMsg.thinking) {
        prevMsg.thinking = stripLeadingNewlines(prevMsg.thinking);
    }
}

/**
 * Apply initial message data (content, thinking, model, usage) to a message from a start/end event.
 * @param msg - The chat message to update
 * @param message - The SSE message data to apply
 * @returns {void}
 */
function applyStartMessageData(msg: ChatMessage, message: z.infer<typeof sseMessageSchema>): void {
    if (message.content) {
        const text = extractTextFromContent(message.content);
        if (text) msg.content = text;
    }
    const thinking =
        message.thinking ??
        (message.content ? extractThinkingFromContent(message.content) : undefined);
    if (thinking) {
        msg.thinking = thinking;
        msg.thinkingStreaming = true;
    }
    applyMessageMeta(msg, message);
}

/**
 * Check if a message_start event is for a non-assistant message.
 * @param e - The SSE MessageEvent
 * @returns True if the event is for a non-assistant role
 */
function isNonAssistantStart(e: MessageEvent): boolean {
    try {
        const data = safeJsonParse(e.data as string, sseMessageStartSchema);
        if (data?.message?.role && data.message.role !== "assistant") return true;
    } catch {
        // If we can't parse, treat as assistant (best effort)
    }
    return false;
}

/**
 * Create a new streaming assistant message and return its ID.
 * @param s - The chat state
 * @returns The ID of the newly created assistant message
 */
function createAssistantMessage(s: ChatState): string {
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
    return id;
}

/**
 * Handle the 'message_start' SSE event.
 * @param s - The chat state
 * @param e - The SSE MessageEvent
 * @returns {void}
 */
export function handleMessageStart(s: ChatState, e: MessageEvent): void {
    console.log(`[chat] SSE 'message_start': lastEventId=${e.lastEventId}`);

    // Handle non-assistant messages (user, toolResult, etc.)
    if (isNonAssistantStart(e)) {
        try {
            const data = safeJsonParse(e.data as string, sseMessageStartSchema);
            if (data) handleNonAssistantStart(s, data);
        } catch {
            // ignore
        }
        return;
    }

    // Finalize any previous streaming message before starting a new one
    finalizePrevStreamingMessage(s);

    // Begin a new assistant message
    const id = createAssistantMessage(s);

    // The partial message might already have content, thinking, or model info
    try {
        const data = safeJsonParse(e.data as string, sseMessageStartSchema);
        if (data?.message) {
            const msg = s.messages.find((m) => m.id === id);
            if (msg) applyStartMessageData(msg, data.message);
        }
    } catch {
        // ignore parse errors
    }
}

// --- Message update sub-handlers (per event type) ---

/**
 * Apply a text delta to the streaming message.
 * @param s - The chat state
 * @param msg - The message to apply the delta to
 * @param data - The SSE message update data containing the delta
 * @returns {void}
 */
function applyTextDelta(s: ChatState, msg: ChatMessage, data: z.infer<typeof sseMessageUpdateSchema>): void {
    if (!data.delta) return;
    // Log first content arrival for streaming diagnostics
    if (!msg.content || msg.content.length < 10) {
        console.log(`[chat-lifecycle] handleMessageUpdate: first text_delta for msg id=${msg.id}, contentLen=${String(msg.content.length)}, deltaLen=${String(data.delta.length)}`);
    }
    // Some providers send thinking as text with <thinking>...</thinking> tags
    appendTextDelta(s, msg, data.delta);
}

/**
 * Mark thinking as started on the message.
 * @param msg - The chat message to update
 * @returns {void}
 */
function applyThinkingStart(msg: ChatMessage): void {
    msg.thinkingStreaming = true;
    msg.thinking = "";
}

/**
 * Append a thinking delta to the message.
 * @param msg - The chat message to update
 * @param data - The SSE message update data containing the delta
 * @returns {void}
 */
function applyThinkingDelta(msg: ChatMessage, data: z.infer<typeof sseMessageUpdateSchema>): void {
    if (!data.delta) return;
    msg.thinking = (msg.thinking ?? "") + data.delta;
    msg.thinkingStreaming = true;
}

/**
 * Check if any tool calls have output (used to skip content extraction).
 * @param msg - The chat message to check
 * @returns True if any tool call has output
 */
function hasToolOutput(msg: ChatMessage): boolean {
    return !!msg.toolCalls && msg.toolCalls.length > 0 && msg.toolCalls.some((tc) => tc.output);
}

/**
 * Extract missing model/usage info from a final message.
 * @param msg - The chat message to update
 * @param message - The SSE message data with model/usage info
 * @returns {void}
 */
function applyMessageMeta(msg: ChatMessage, message: z.infer<typeof sseMessageSchema>): void {
    if (message.model) msg.model = message.model;
    if (message.provider) msg.modelProvider = message.provider;
    if (message.usage) msg.usage = message.usage;
}

/**
 * Apply a 'done' update: finalize content and apply message metadata.
 * @param msg - The chat message to update
 * @param data - The SSE message update data
 * @returns {void}
 */
function applyDone(msg: ChatMessage, data: z.infer<typeof sseMessageUpdateSchema>): void {
    if (data.message?.content && !msg.content && !hasToolOutput(msg)) {
        msg.content = stripLeadingNewlines(extractTextFromContent(data.message.content));
    } else if (msg.content) {
        msg.content = stripLeadingNewlines(stripThinkingTagsFromText(msg.content));
    }
    if (data.message) applyMessageMeta(msg, data.message);
}

/**
 * Apply an error state to the streaming message and stop generation.
 * @param s - The chat state
 * @param msg - The chat message to update
 * @param data - The SSE message update data with error info
 * @returns {void}
 */
function applyError(s: ChatState, msg: ChatMessage, data: z.infer<typeof sseMessageUpdateSchema>): void {
    console.error(`[chat-lifecycle] handleMessageUpdate ERROR event:`, JSON.stringify(data).substring(0, 1000));
    msg.streaming = false;
    msg.thinkingStreaming = false;
    msg.isError = true;
    const errorMsg =
        data.error?.errorMessage ||
        data.message?.errorMessage ||
        data.reason ||
        "An error occurred";
    msg.errorMessage = errorMsg;
    msg.content = errorMsg;
    setStreamingMessageId(s, null, "message_update error");
    s.generating = false;
}

/**
 * Dispatch a message_update event by type to the appropriate sub-handler.
 * @param s - The chat state
 * @param msg - The streaming message to update
 * @param data - The SSE message update data
 * @returns {void}
 */
function dispatchMessageUpdate(s: ChatState, msg: ChatMessage, data: z.infer<typeof sseMessageUpdateSchema>): void {
    const handlers: Partial<Record<string, () => void>> = {
        text_delta: () => { applyTextDelta(s, msg, data); },
        thinking_start: () => { applyThinkingStart(msg); },
        thinking_delta: () => { applyThinkingDelta(msg, data); },
        thinking_end: () => { msg.thinkingStreaming = false; },
        done: () => { applyDone(msg, data); },
        error: () => { applyError(s, msg, data); },
    };
    const handler = handlers[data.type ?? ""];
    if (handler) handler();
}

/**
 * Handle the 'message_update' SSE event.
 * @param s - The chat state
 * @param e - The SSE MessageEvent
 * @returns {void}
 */
export function handleMessageUpdate(s: ChatState, e: MessageEvent): void {
    const msg = getStreamingMsg(s);
    if (!msg) {
        console.log(`[chat-lifecycle] handleMessageUpdate: DROPPED (no streaming message found), streamingMessageId=${s.streamingMessageId ?? "null"}, messages.length=${String(s.messages.length)}, lastEventId=${e.lastEventId}`);
        return;
    }

    try {
        const data = safeJsonParse(e.data as string, sseMessageUpdateSchema);

        if (!data) {
            if (e.data && typeof e.data === "string") {
                msg.content += e.data;
            }
            return;
        }

        dispatchMessageUpdate(s, msg, data);
    } catch {
        // Catch unexpected errors in message processing
    }
}

/**
 * Apply error state from a message_end event if the final message indicates an error.
 * @param msg - The chat message to update
 * @param message - The SSE message data from the end event
 * @returns {void}
 */
function applyEndErrorState(msg: ChatMessage, message: z.infer<typeof sseMessageSchema>): void {
    if (message.stopReason !== "error" && !message.errorMessage) return;
    console.error(`[chat-lifecycle] handleMessageEnd: error detected in final message, stopReason=${String(message.stopReason)}, errorMessage=${String(message.errorMessage)}`);
    if (!msg.isError) msg.isError = true;
    if (!msg.errorMessage) msg.errorMessage = message.errorMessage || "An error occurred";
    if (!msg.content) msg.content = message.errorMessage || "An error occurred";
}

/**
 * Apply final message data (content, thinking, model, usage) from a message_end event.
 * @param msg - The chat message to update
 * @param message - The SSE message data from the end event
 * @returns {void}
 */
function applyEndMessageData(msg: ChatMessage, message: z.infer<typeof sseMessageSchema>): void {
    applyEndErrorState(msg, message);
    if (!msg.content && message.content && !hasToolOutput(msg)) {
        msg.content = extractTextFromContent(message.content);
    }
    if (!msg.thinking) {
        msg.thinking =
            message.thinking ??
            (message.content ? extractThinkingFromContent(message.content) : undefined);
    }
    if (!msg.model || !msg.modelProvider || !msg.usage) {
        applyMessageMeta(msg, message);
    }
}

/**
 * Clean up content on a finalized message (strip leading newlines and thinking tags).
 * @param msg - The chat message to finalize
 * @returns {void}
 */
function finalizeMessageContent(msg: ChatMessage): void {
    if (msg.content) {
        msg.content = stripLeadingNewlines(stripThinkingTagsFromText(msg.content));
    }
    if (msg.thinking) {
        msg.thinking = stripLeadingNewlines(msg.thinking);
    }
}

/**
 * Check if a message_end event is for a non-assistant message (should be skipped).
 * @param e - The SSE MessageEvent
 * @returns True if the event is for a non-assistant role
 */
function isNonAssistantEnd(e: MessageEvent): boolean {
    try {
        const data = safeJsonParse(e.data as string, sseMessageEndSchema);
        return !!(data?.message?.role && data.message.role !== "assistant");
    } catch {
        return false;
    }
}

/**
 * Handle the 'message_end' SSE event.
 * @param s - The chat state
 * @param e - The SSE MessageEvent
 * @returns {void}
 */
export function handleMessageEnd(s: ChatState, e: MessageEvent): void {
    console.log(`[chat-lifecycle] handleMessageEnd: lastEventId=${e.lastEventId}, streamingMessageId=${s.streamingMessageId ?? "null"}, messages.length=${String(s.messages.length)}`);
    // Recovery is no longer relevant — the message is finalized
    s.recoveryTurnGeneration = null;

    // pi emits message_end for ALL message types, including toolResult —
    // skip non-assistant messages to avoid treating tool output as chat text
    if (isNonAssistantEnd(e)) return;

    const msg = getStreamingMsg(s);
    if (msg) {
        msg.streaming = false;
        msg.thinkingStreaming = false;
        try {
            const data = safeJsonParse(e.data as string, sseMessageEndSchema);
            if (data?.message) applyEndMessageData(msg, data.message);
        } catch {
            // ignore
        }
        finalizeMessageContent(msg);
    }
    setStreamingMessageId(s, null, "message_end");
    // Don't set generating = false here — agent loops continue
    // after message_end. agent_end is the authoritative done signal.
}

/**
 * Handle the 'tool_execution_start' SSE event.
 * @param s - The chat state
 * @param e - The SSE MessageEvent
 * @returns {void}
 */
export function handleToolExecutionStart(s: ChatState, e: MessageEvent): void {
    console.log(`[chat-lifecycle] handleToolExecutionStart: streamingMessageId=${s.streamingMessageId ?? "null"}, messages.length=${String(s.messages.length)}`);
    // Tool execution can happen outside streaming (e.g., after message_end)
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

/**
 * Handle the 'tool_execution_update' SSE event.
 * @param s - The chat state
 * @param e - The SSE MessageEvent
 * @returns {void}
 */
export function handleToolExecutionUpdate(s: ChatState, e: MessageEvent): void {
    const msg = getStreamingMsg(s);
    if (!msg?.toolCalls?.length) return;

    try {
        const data = safeJsonParse(e.data as string, sseToolExecutionUpdateSchema);
        if (!data) return;
        // Find running tool call by toolName (tool_execution_update may lack toolCallId)
        const runningTool = msg.toolCalls.find((t) => t.status === "running");
        if (runningTool && data.output) {
            runningTool.output = (runningTool.output ?? "") + data.output;
        }
    } catch {
        // ignore
    }
}

type ToolCall = NonNullable<ChatMessage["toolCalls"]>[number];

/**
 * Finalize a completed tool call with status, error, and output.
 * @param tool - The tool call to finalize
 * @param data - The SSE tool execution end data
 * @returns {void}
 */
function finalizeToolCall(tool: ToolCall | undefined, data: z.infer<typeof sseToolExecutionEndSchema>): void {
    if (!tool) return;
    tool.status = data.isError ? "error" : "completed";
    tool.isError = data.isError;
    if (data.result && !tool.output) {
        tool.output = data.result;
    }
}

/**
 * Check if all tool calls on a message are completed.
 * @param msg - The chat message to check
 * @returns True if all tool calls are completed or errored
 */
function allToolCallsDone(msg: ChatMessage): boolean {
    return !!msg.toolCalls && msg.toolCalls.every(
        (t) => t.status === "completed" || t.status === "error"
    );
}

/**
 * Handle the 'tool_execution_end' SSE event.
 * @param s - The chat state
 * @param e - The SSE MessageEvent
 * @returns {void}
 */
export function handleToolExecutionEnd(s: ChatState, e: MessageEvent): void {
    const msg = getStreamingMsg(s);
    if (!msg?.toolCalls?.length) return;

    try {
        const data = safeJsonParse(e.data as string, sseToolExecutionEndSchema);
        if (!data) return;
        const tool = msg.toolCalls.find(
            (t) => t.toolName === data.toolName && t.status === "running"
        );
        finalizeToolCall(tool, data);

        if (allToolCallsDone(msg)) {
            msg.streaming = false;
            msg.thinkingStreaming = false;
            setStreamingMessageId(s, null, "tool_execution_end all done");
        }
    } catch {
        // ignore
    }
}

/**
 * Find an assistant message for attaching sources (streaming first, then last assistant).
 * @param s - The chat state
 * @returns The best assistant message for sources, or undefined
 */
function findAssistantMessageForSources(s: ChatState): ChatMessage | undefined {
    const streaming = getStreamingMsg(s);
    if (streaming?.role === "assistant") return streaming;
    // Fallback: find the last assistant message (sources flushed after message_end)
    for (let i = s.messages.length - 1; i >= 0; i--) {
        if (s.messages[i].role === "assistant") return s.messages[i];
    }
    return undefined;
}

/**
 * Handle the 'fetched_sources' SSE event.
 * @param s - The chat state
 * @param e - The SSE MessageEvent
 * @returns {void}
 */
export function handleFetchedSources(s: ChatState, e: MessageEvent): void {
    try {
        const data = safeJsonParse(e.data as string, sseFetchedSourcesSchema);
        if (!data?.sources?.length) return;
        const msg = findAssistantMessageForSources(s);
        if (msg) {
            // Accumulate sources across multiple flushes within one turn
            msg.fetchedSources = [...(msg.fetchedSources ?? []), ...data.sources];
        }
    } catch {
        // ignore parse errors
    }
}

/**
 * Handle the 'turn_timing' SSE event.
 * Updates the aggregate SessionTiming on ChatState with the new turn data.
 * @param s - The chat state
 * @param e - The SSE MessageEvent
 * @returns {void}
 */
export function handleTurnTiming(s: ChatState, e: MessageEvent): void {
    try {
        const data = safeJsonParse(e.data as string, sseTurnTimingSchema);
        if (!data?.timing) return;
        s.timing = mergeTurnTiming(s.timing, data.timing);
    } catch {
        // ignore parse errors
    }
}

/**
 * Merge a single turn's timing into the running aggregate.
 * If no aggregate exists yet, creates one from the single turn.
 *
 * @param current - The current aggregate, or null if none exists
 * @param turn - The new turn timing to merge in
 * @returns The updated aggregate
 */
function mergeTurnTiming(current: SessionTiming | null, turn: TurnTiming): SessionTiming {
    if (!current) {
        return {
            turnCount: 1,
            ttftCount: turn.ttftMs !== null ? 1 : 0,
            avgTtftMs: turn.ttftMs,
            tpsCount: turn.tps !== null ? 1 : 0,
            avgTps: turn.tps,
            totalOutputTokens: turn.outputTokens,
        };
    }

    const newTtftCount = turn.ttftMs !== null ? current.ttftCount + 1 : current.ttftCount;
    const newTpsCount = turn.tps !== null ? current.tpsCount + 1 : current.tpsCount;

    // Running-average: newAvg = (oldAvg * oldCount + newValue) / newCount
    const newAvgTtftMs = turn.ttftMs !== null && current.ttftCount > 0
        ? (current.avgTtftMs! * current.ttftCount + turn.ttftMs) / newTtftCount
        : turn.ttftMs ?? current.avgTtftMs;

    const newAvgTps = turn.tps !== null && current.tpsCount > 0
        ? (current.avgTps! * current.tpsCount + turn.tps) / newTpsCount
        : turn.tps ?? current.avgTps;

    return {
        turnCount: current.turnCount + 1,
        ttftCount: newTtftCount,
        avgTtftMs: newAvgTtftMs,
        tpsCount: newTpsCount,
        avgTps: newAvgTps,
        totalOutputTokens: current.totalOutputTokens + turn.outputTokens,
    };
}

// --- New helpers ---

/**
 * Finalize the current streaming message: mark it as non-streaming,
 * clean up thinking tags and leading newlines, and clear the streaming ID.
 * @param s - The chat state
 * @param reason - Reason for finalization (used in diagnostic logging)
 * @returns {void}
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
