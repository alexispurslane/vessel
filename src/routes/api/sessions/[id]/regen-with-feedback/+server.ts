import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler } from "$lib/server/api-errors.js";
import { regenWithFeedback } from "$lib/server/agent/session-store.js";

const PostBody = z.object({
    targetEntryId: z.string().min(1),
    feedback: z.string().min(1),
    model_id: z.string().optional(),
});

/**
 * POST /api/sessions/[id]/regen-with-feedback
 *
 * Regenerate an assistant message with user feedback.
 * Navigates the session tree back to before the target assistant message
 * (creating a new branch), then sends the user's critique as a hidden
 * custom message that quotes the original response and triggers a new
 * LLM turn.
 *
 * Request body:
 *   { targetEntryId: string, feedback: string }
 *
 * Response:
 *   { cancelled: boolean }
 */
export const POST = apiHandler(PostBody, async ({ body, event }) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const id = event.params.id!;
    const result = await regenWithFeedback(id, body.targetEntryId, body.feedback, body.model_id);
    return json(result);
});
