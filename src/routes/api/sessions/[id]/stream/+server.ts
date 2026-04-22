import type { RequestHandler } from "./$types.js";
import {
    getOrCreateSession,
    subscribe,
    getBufferedEventsAfter,
} from "$lib/server/agent/session-store.js";
import type { ChatSSEEvent } from "$lib/server/agent/types.js";
import { randomUUID } from "crypto";

/**
 * GET /api/sessions/[id]/stream
 *
 * SSE event stream for a session. EventSource-compatible.
 * Client connects once and receives all agent events in real-time.
 * Supports catch-up replay via lastEventId query parameter or
 * Last-Event-Id header (sent by browsers on automatic reconnection).
 *
 * When a lastEventId is provided, the server replays all buffered events
 * after that ID before subscribing to live events. This ensures the client
 * doesn't miss any events that occurred during a page reload.
 */
export const GET: RequestHandler = async ({ params, request, url }) => {
    const conversationId = params.id;

    // Ensure the AgentSession is loaded (hydrates from .jsonl if needed)
    await getOrCreateSession(conversationId);

    // Check for lastEventId — support both the query parameter (for manual
    // reconnects on page reload) and the standard Last-Event-Id header
    // (sent by browsers on automatic EventSource reconnection).
    const lastEventId =
        url.searchParams.get("lastEventId") ||
        request.headers.get("Last-Event-Id") ||
        null;

    const subscriberId = randomUUID();

    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();

            const send = (event: ChatSSEEvent) => {
                const lines = [
                    `id: ${event.id}`,
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

            // Replay missed events if the client provided a lastEventId.
            // This is crucial for page reload resilience — the client saves
            // the last event ID to sessionStorage, and on reload, passes it
            // so we can replay everything that happened while they were disconnected.
            if (lastEventId) {
                const missedEvents = getBufferedEventsAfter(
                    conversationId,
                    lastEventId
                );
                for (const event of missedEvents) {
                    send(event);
                }
            }

            // Subscribe to agent events
            const unsubscribe = subscribe(conversationId, subscriberId, send);

            // Send initial connection event
            send({
                id: `init-${Date.now()}`,
                event: "connected",
                data: { conversationId, timestamp: Date.now() },
            });

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
