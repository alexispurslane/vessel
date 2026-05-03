import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler } from "$lib/server/api-errors.js";
import { editAssistantMessage } from "$lib/server/agent/session-store.js";

const PostBody = z.object({
    targetEntryId: z.string().min(1),
    newContent: z.string(),
});

/**
 * POST /api/sessions/[id]/edit-assistant
 *
 * In-place edit of an assistant message in the session tree.
 * Navigates back to before the target message, appends the edited version,
 * then replays all subsequent entries from the abandoned branch.
 * Does NOT trigger a new AI generation.
 *
 * Request body:
 *   { targetEntryId: string, newContent: string }
 *
 * Response:
 *   { cancelled: boolean }
 */
export const POST = apiHandler(PostBody, async ({ body, event }) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const id = event.params.id!;
    const result = await editAssistantMessage(id, body.targetEntryId, body.newContent);
    return json(result);
});
