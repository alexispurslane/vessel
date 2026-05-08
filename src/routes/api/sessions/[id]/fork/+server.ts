import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler, badRequest } from "$lib/server/api-errors.js";
import { forkConversation } from "$lib/server/agent/session-store.js";

const PostBody = z.object({
    beforeEntryId: z.string().min(1),
});

/**
 * POST /api/sessions/[id]/fork
 *
 * Fork a conversation before a specific entry point.
 * Creates a brand new conversation whose session contains the history
 * from root up to and including the parent of the specified entry,
 * capturing any custom messages (fetched sources, etc.) between the
 * last displayed message and the entry.
 *
 * Request body:
 *   { beforeEntryId: string }
 *
 * Response:
 *   { id: string } — the new conversation ID
 */
export const POST = apiHandler(PostBody, async ({ body, event }) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const id = event.params.id!;
    if (!id) return badRequest("Missing session id");

    const newId = await forkConversation(id, body.beforeEntryId);
    return json({ id: newId }, { status: 201 });
});
