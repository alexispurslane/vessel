import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getConversationsByTag } from "$lib/server/db/index.js";

/**
 * GET /api/tags/[tag]
 * List all conversations that have this tag.
 */
export const GET: RequestHandler = async ({ params }) => {
    const conversations = getConversationsByTag(params.tag);
    return json({ tag: params.tag, conversations });
};
