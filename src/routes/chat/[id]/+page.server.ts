import type { PageServerLoad } from "./$types.js";
import { getSessionHistory } from "$lib/server/agent/session-store.js";
import { messageHistoryToChatMessages } from "$lib/chat-history.js";

export const load: PageServerLoad = async ({ params }) => {
    const conversationId = params.id;

    try {
        const history = await getSessionHistory(conversationId);
        return {
            messageHistory: history,
            // Pre-converted ChatMessage[] for SSR rendering — avoids the client
            // having to do any conversion before first paint.
            messages: messageHistoryToChatMessages(history),
            lastModel: history.model,
        };
    } catch (e) {
        console.error(`[SSR] Failed to load history for ${conversationId}:`, e);
        // Return empty history so the page still renders — the client
        // can fall back to fetching via connectStream if needed.
        return {
            messageHistory: { messages: [], model: null },
            messages: [],
            lastModel: null,
        };
    }
};
