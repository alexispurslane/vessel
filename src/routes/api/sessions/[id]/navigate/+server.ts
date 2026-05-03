import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler } from "$lib/server/api-errors.js";
import { navigateMessage } from "$lib/server/agent/session-store.js";

const PostBody = z.object({
    targetEntryId: z.string().min(1),
});

/**
 * POST /api/sessions/[id]/navigate
 *
 * Navigate the session tree to a target entry. Used for delete/edit operations:
 * - Moves the conversation's "current position" back to before the target message
 * - Effectively abandons the target message and everything after it
 * - For user messages, returns the message text (for editing and re-sending)
 *
 * Request body:
 *   { targetEntryId: string }
 *
 * Response:
 *   { editorText?: string, cancelled: boolean }
 */
export const POST = apiHandler(PostBody, async ({ body, event }) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const id = event.params.id!;
    const result = await navigateMessage(id, body.targetEntryId);
    return json(result);
});
