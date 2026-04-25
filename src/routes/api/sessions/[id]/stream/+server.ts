import type { RequestHandler } from "./$types.js";
import {
    getOrCreateSession,
    subscribe,
} from "$lib/server/agent/session-store.js";
import type { ChatSSEEvent } from "$lib/server/agent/types.js";
import { randomUUID } from "crypto";

/**
 * GET /api/sessions/[id]/stream
 *
 * SSE event stream for a session. EventSource-compatible.
 * Client connects once and receives all agent events in real-time.
 */
export const GET: RequestHandler = async ({ params, request, url }) => {
    const conversationId = params.id;

    // Ensure the AgentSession is loaded (hydrates from .jsonl if needed)
    await getOrCreateSession(conversationId);

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

            // Subscribe to agent events
            const unsubscribe = subscribe(conversationId, subscriberId, send);
            console.log(`[stream] Subscribed ${subscriberId} to ${conversationId}`);

            // Send initial connection event
            send({
                event: "connected",
                data: { conversationId, timestamp: Date.now() },
            });
            console.log(`[stream] Sent 'connected' event to client`);

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
