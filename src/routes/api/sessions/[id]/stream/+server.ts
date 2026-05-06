import type { RequestHandler } from "./$types.js";
import {
    getOrHydrateSession,
    subscribeToConversation,
} from "$lib/server/agent/session-store.js";
import type { ChatSSEEvent } from "$lib/server/agent/types.js";
import { randomUUID } from "crypto";
import { log } from "$lib/server/logger.js";

/**
 * GET /api/sessions/[id]/stream
 *
 * SSE event stream for a session. EventSource-compatible.
 * Client connects once and receives all agent events in real-time.
 *
 * @param root0 - The request handler params
 * @param root0.params - Route params (includes id)
 * @param root0.request - The incoming request
 * @param root0.url - The request URL
 * @returns SSE response stream
 */
export const GET: RequestHandler = async ({ params, request, url: _url }) => {
    const conversationId = params.id;

    // Ensure the AgentSession is loaded (hydrates from .jsonl if needed)
    await getOrHydrateSession(conversationId);

    const subscriberId = randomUUID();

    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();

            const send = (event: ChatSSEEvent) => {
                const lines = [
                    `event: ${event.event}`,
                    `data: ${JSON.stringify(event.data)}`,
                    "",
                ];
                controller.enqueue(encoder.encode(lines.join("\n") + "\n"));
            };

            // Heartbeat every 30s to keep the connection alive
            const heartbeat = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(": heartbeat\n\n"));
                } catch {
                    clearInterval(heartbeat);
                }
            }, 30_000);

            // Send initial connection event FIRST so the client knows the link is up
            // before any potential stream_recovery event arrives
            send({
                event: "connected",
                data: { conversationId, timestamp: Date.now() },
            });
            log.debug("stream", "Sent 'connected' event to client");

            // Subscribe to agent events (may send stream_recovery if a message is in-flight)
            const unsubscribe = subscribeToConversation(conversationId, subscriberId, send);
            log.debug("stream", `Subscribed ${subscriberId} to ${conversationId}`);

            // Clean up on disconnect
            request.signal.addEventListener("abort", () => {
                clearInterval(heartbeat);
                unsubscribe();
                try {
                    controller.close();
                } catch {
                    // Already closed
                }
            });
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        },
    });
};
