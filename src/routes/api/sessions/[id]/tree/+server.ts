import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getSessionTree } from "$lib/server/agent/session-store.js";

/**
 * GET /api/sessions/[id]/tree
 *
 * Returns the full session tree as nodes and relations for DAG visualization.
 * Includes all entries across all branches, with metadata about which
 * entries are on the current active branch.
 */
export const GET: RequestHandler = async ({ params }) => {
    const conversationId = params.id;

    try {
        const tree = await getSessionTree(conversationId);
        return json(tree);
    } catch (e) {
        console.error(`Failed to get session tree for ${conversationId}:`, e);
        const message = e instanceof Error ? e.message : "Failed to get session tree";
        return json({ error: message }, { status: 500 });
    }
};
