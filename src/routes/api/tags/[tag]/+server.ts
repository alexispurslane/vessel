import { json } from "@sveltejs/kit";
import { tryApi } from "$lib/server/api-errors.js";
import { getConversationsByTag } from "$lib/server/db/index.js";

/**
 * GET /api/tags/[tag]
 * List all conversations that have this tag.
 */
export const GET = tryApi(({ params }) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const tag = params.tag!;
    const conversations = getConversationsByTag(tag);
    return json({ tag, conversations });
});
