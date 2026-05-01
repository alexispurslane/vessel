import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler, notFound, tryApi } from "$lib/server/api-errors.js";
import {
    getOrHydrateSession,
    getSessionAgentInfo,
    updateSessionSystemPrompt,
} from "$lib/server/agent/session-store.js";

const PatchBody = z.object({
    customSystemPrompt: z.string().nullable().optional(),
    appendSystemPrompt: z.array(z.string()).nullable().optional(),
}).refine(
    (data) => data.customSystemPrompt !== undefined || data.appendSystemPrompt !== undefined,
    { message: "No valid fields to update" }
);

/**
 * GET /api/sessions/[id]/agent-info
 *
 * Returns the current system prompt and available tools/skills for
 * the conversation's active AgentSession. The session is hydrated
 * on demand if not already in memory.
 */
export const GET = tryApi(async ({ params }) => {
    const id = params.id!;
    // Ensure the session is loaded in memory so we can read from it
    await getOrHydrateSession(id);

    const info = await getSessionAgentInfo(id);
    if (!info) {
        return notFound("Session not active");
    }

    return json(info);
});

/**
 * PATCH /api/sessions/[id]/agent-info
 *
 * Update the system prompt for this conversation's active session.
 * Accepts `customSystemPrompt` (replaces default) or `appendSystemPrompt`
 * (adds to default). Pass null to clear. Changes are applied immediately
 * to the live session and persisted to conversation settings.
 */
export const PATCH = apiHandler(PatchBody, async ({ body, event }) => {
    const id = event.params.id!;
    const options: {
        customSystemPrompt?: string | null;
        appendSystemPrompt?: string[] | null;
    } = {};

    if (body.customSystemPrompt !== undefined) {
        options.customSystemPrompt = body.customSystemPrompt;
    }
    if (body.appendSystemPrompt !== undefined) {
        options.appendSystemPrompt = body.appendSystemPrompt;
    }

    // Ensure session is loaded
    await getOrHydrateSession(id);

    const updated = updateSessionSystemPrompt(id, options);
    if (!updated) {
        return notFound("Session not active");
    }

    // Return the updated agent info so the client can refresh
    const info = await getSessionAgentInfo(id);
    return json({ success: true, info });
});
