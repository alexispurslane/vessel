import { json } from "@sveltejs/kit";
import { tryApi } from "$lib/server/api-errors.js";
import { getSessionTree } from "$lib/server/agent/session-store.js";

/**
 * GET /api/sessions/[id]/tree
 *
 * Returns the full session tree as nodes and relations for DAG visualization.
 * Includes all entries across all branches, with metadata about which
 * entries are on the current active branch.
 */
export const GET = tryApi(async ({ params }) => {
    const id = params.id!;
    const tree = await getSessionTree(id);
    return json(tree);
});
