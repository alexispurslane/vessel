/**
 * SSE event formatting, message serialization, and broadcast.
 *
 * All functions for formatting pi AgentSessionEvents into SSE payloads,
 * serializing messages, and broadcasting to subscribers.
 */

import type { AgentSessionEvent as PiAgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { ChatSSEEvent, ActiveSession } from "./types.js";

// --- Broadcast ---

/**
 * Broadcast an SSE event to all subscribers of a session.
 *
 * After broadcasting an agent_end event, checks if the session should be
 * disposed. If the generation just finished and the user has already
 * navigated away (no subscribers), the session was protected from disposal
 * while streaming — now it's safe to clean up.
 *
 * @param sessions - The sessions Map (passed in to avoid circular dependency on session-store)
 * @param _scheduleDisposeFn - Callback to schedule disposal (passed in to avoid circular dependency on session-store)
 * @param conversationId - The conversation/session ID
 * @param event - The SSE event to broadcast
 */
export function broadcast(
    sessions: Map<string, ActiveSession>,
    _scheduleDisposeFn: (conversationId: string) => void,
    disposeIfIdleFn: (conversationId: string) => void,
    conversationId: string,
    event: ChatSSEEvent
): void {
    const session = sessions.get(conversationId);
    if (!session) return;

    for (const [, subscriber] of session.subscribers) {
        subscriber.send(event);
    }

    // After broadcasting an agent_end event, immediately try to dispose
    // if there are no subscribers (user navigated away while generating).
    // This prevents memory leaks where a finished session stays in memory
    // until the 2-minute timer fires.
    if (event.event === "agent_end" && session.subscribers.size === 0) {
        disposeIfIdleFn(conversationId);
    }
}

// --- Message serialization ---

/**
 * Extract text output from a tool partial result (AgentToolResult).
 * The result has content: (TextContent | ImageContent)[] and details: T
 */
export function extractToolOutput(partialResult: unknown): string | undefined {
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
export function serializeStreamingMessageForRecovery(
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
export function serializeMessage(message: unknown): unknown {
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

// --- Event formatting ---

/**
 * Format pi AgentSessionEvent into a serializable payload for SSE.
 * Maps pi's generic event types to our chat-specific format.
 */
export function formatEventPayload(event: PiAgentSessionEvent): unknown {
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
