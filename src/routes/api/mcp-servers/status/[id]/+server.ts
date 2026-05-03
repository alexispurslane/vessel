import { json } from "@sveltejs/kit";
import { getMcpServerStatus } from "$lib/server/agent/session-store.js";
import { tryApi } from "$lib/server/api-errors.js";

/**
 * GET /api/mcp-servers/status/[id]
 * Get MCP server connection status for an active conversation session.
 * Returns an array of { name, status, toolCount } for each configured server.
 */
export const GET = tryApi(({ params }) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const status = getMcpServerStatus(params.id!);
    return json(status);
});
