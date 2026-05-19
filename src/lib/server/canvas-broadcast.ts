/**
 * @file Canvas broadcast integration with the session-store's SSE subscriber system.
 *
 * Provides a way to broadcast canvas_update events to all subscribers
 * of a conversation using the session-store's broadcastToSession function.
 */

import type { ChatSSEEvent } from "$lib/types.js";
import { broadcastToSession, getOrHydrateSession } from "$lib/server/agent/session-store.js";

/**
 * Broadcast a canvas_update SSE event to all subscribers of a conversation.
 * Ensures the session is loaded before broadcasting.
 *
 * @param conversationId - The conversation ID to broadcast to
 * @param event - The SSE event to broadcast
 */
export async function broadcastCanvasUpdate(conversationId: string, event: ChatSSEEvent): Promise<void> {
    // Ensure the session is hydrated so subscribers exist
    await getOrHydrateSession(conversationId);
    broadcastToSession(conversationId, event);
}
