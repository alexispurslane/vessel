import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import {
    listMcpServers,
    upsertMcpServer,
    deleteMcpServer,
    type McpServerEntry,
} from "$lib/server/agent/mcp-config.js";

/**
 * GET /api/mcp-servers
 * List all configured MCP servers.
 */
export const GET: RequestHandler = async () => {
    const servers = listMcpServers();
    return json(servers);
};

/**
 * PUT /api/mcp-servers
 * Add or update an MCP server configuration.
 * Body: { name: string, config: ServerEntry }
 */
export const PUT: RequestHandler = async ({ request }) => {
    const body = await request.json();
    const { name, config } = body as { name: string; config: McpServerEntry };

    if (!name || typeof name !== "string" || !name.trim()) {
        return json({ error: "name is required" }, { status: 400 });
    }

    if (!config || typeof config !== "object") {
        return json({ error: "config is required" }, { status: 400 });
    }

    // Validate: must have either command (stdio) or url (HTTP)
    if (!config.command && !config.url) {
        return json(
            { error: "config must have either 'command' (stdio) or 'url' (HTTP)" },
            { status: 400 }
        );
    }

    upsertMcpServer(name.trim(), config);
    return json({ success: true });
};

/**
 * DELETE /api/mcp-servers
 * Remove an MCP server configuration.
 * Body: { name: string }
 */
export const DELETE: RequestHandler = async ({ request }) => {
    const body = await request.json();
    const { name } = body as { name: string };

    if (!name || typeof name !== "string") {
        return json({ error: "name is required" }, { status: 400 });
    }

    const deleted = deleteMcpServer(name);
    if (!deleted) {
        return json({ error: `MCP server "${name}" not found` }, { status: 404 });
    }

    return json({ success: true });
};
