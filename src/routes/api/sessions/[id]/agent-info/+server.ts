import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import {
    getOrCreateSession,
    getSessionAgentInfo,
    updateSessionSystemPrompt,
} from "$lib/server/agent/session-store.js";

/**
 * GET /api/sessions/[id]/agent-info
 *
 * Returns the current system prompt and available tools/skills for
 * the conversation's active AgentSession. The session is hydrated
 * on demand if not already in memory.
 */
export const GET: RequestHandler = async ({ params }) => {
    const conversationId = params.id;

    try {
        // Ensure the session is loaded in memory so we can read from it
        await getOrCreateSession(conversationId);

        const info = await getSessionAgentInfo(conversationId);
        if (!info) {
            return json({ error: "Session not active" }, { status: 404 });
        }

        return json(info);
    } catch (e) {
        console.error(`Failed to get agent info for ${conversationId}:`, e);
        return json({ error: "Failed to get agent info" }, { status: 500 });
    }
};

/**
 * PATCH /api/sessions/[id]/agent-info
 *
 * Update the system prompt for this conversation's active session.
 * Accepts `customSystemPrompt` (replaces default) or `appendSystemPrompt`
 * (adds to default). Pass null to clear. Changes are applied immediately
 * to the live session and persisted to conversation settings.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
    const conversationId = params.id;

    try {
        const body = await request.json();

        if (!body || typeof body !== "object") {
            return json({ error: "Request body must be a JSON object" }, { status: 400 });
        }

        // Build options — only include fields that were explicitly provided
        const options: {
            customSystemPrompt?: string | null;
            appendSystemPrompt?: string[] | null;
        } = {};

        if ("customSystemPrompt" in body) {
            if (body.customSystemPrompt !== null && typeof body.customSystemPrompt !== "string") {
                return json({ error: "customSystemPrompt must be a string or null" }, { status: 400 });
            }
            options.customSystemPrompt = body.customSystemPrompt;
        }
        if ("appendSystemPrompt" in body) {
            if (body.appendSystemPrompt !== null && !Array.isArray(body.appendSystemPrompt)) {
                return json({ error: "appendSystemPrompt must be an array of strings or null" }, { status: 400 });
            }
            if (body.appendSystemPrompt !== null) {
                for (const item of body.appendSystemPrompt) {
                    if (typeof item !== "string") {
                        return json({ error: "appendSystemPrompt must be an array of strings" }, { status: 400 });
                    }
                }
            }
            options.appendSystemPrompt = body.appendSystemPrompt;
        }

        if (Object.keys(options).length === 0) {
            return json({ error: "No valid fields to update" }, { status: 400 });
        }

        // Ensure session is loaded
        await getOrCreateSession(conversationId);

        const updated = updateSessionSystemPrompt(conversationId, options);
        if (!updated) {
            return json({ error: "Session not active" }, { status: 404 });
        }

        // Return the updated agent info so the client can refresh
        const info = await getSessionAgentInfo(conversationId);
        return json({ success: true, info });
    } catch (e) {
        console.error(`Failed to update system prompt for ${conversationId}:`, e);
        return json({ error: "Failed to update system prompt" }, { status: 500 });
    }
};
