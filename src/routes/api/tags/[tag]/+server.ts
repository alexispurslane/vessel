import { json } from "@sveltejs/kit";
import { tryApi } from "$lib/server/api-errors.js";
import { getConversationsByTag } from "$lib/server/db/index.js";

/**
 * GET /api/tags/[tag]
 * List all conversations that have this tag.
 */
export const GET = tryApi(async ({ params }) => {
    const tag = params.tag!;
    const conversations = getConversationsByTag(tag);
    return json({ tag, conversations });
});
