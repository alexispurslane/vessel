import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler, badRequest } from "$lib/server/api-errors.js";
import { setSessionLeaf } from "$lib/server/agent/session-store.js";

const PostBody = z.object({
    targetEntryId: z.string().min(1),
});

/**
 * POST /api/sessions/[id]/set-leaf
 *
 * Set the session's current leaf position to a specific entry.
 * Used by the DAG viewer to navigate to a different point in the tree.
 *
 * Request body:
 *   { targetEntryId: string }
 *
 * Response:
 *   { success: boolean }
 */
export const POST = apiHandler(PostBody, async ({ body, event }) => {
    const id = event.params.id;
    if (!id) return badRequest("Missing session id");
    await setSessionLeaf(id, body.targetEntryId);
    return json({ success: true });
});
