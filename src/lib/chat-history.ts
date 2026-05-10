/**
 * @file Converts server-side HistoryResult payloads into client-side ChatMessage objects.
 */
import type { ChatMessage, HistoryResult } from "$lib/types.js";

/**
 * Pure function: convert a HistoryResult payload (from the server) into
 * ChatMessage objects suitable for the client-side chat store and rendering.
 *
 * This is shared between server-side (+page.server.ts) and client-side code,
 * so it must not reference any client-only APIs (no $app/stores, no EventSource, etc.).
 *
 * @param history - The message history payload from the server
 * @returns Array of ChatMessage objects for the client
 */
export function messageHistoryToChatMessages(history: HistoryResult): ChatMessage[] {
    return history.messages.map((msg) => ({
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
}
