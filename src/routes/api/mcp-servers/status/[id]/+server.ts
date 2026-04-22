import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getMcpServerStatus } from "$lib/server/agent/session-store.js";

/**
 * GET /api/mcp-servers/status/[id]
 * Get MCP server connection status for an active conversation session.
 * Returns an array of { name, status, toolCount } for each configured server.
 */
export const GET: RequestHandler = async ({ params }) => {
    const { id } = params;
    const status = getMcpServerStatus(id);
    return json(status);
};
