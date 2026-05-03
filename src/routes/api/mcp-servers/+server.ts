import { json } from "@sveltejs/kit";
import { z } from "zod";
import {
    listMcpServers,
    upsertMcpServer,
    deleteMcpServer,
} from "$lib/server/agent/mcp-config.js";
import { notFound, apiHandler, tryApi } from "$lib/server/api-errors.js";

const PutBody = z.object({
    name: z.string().trim().min(1),
    config: z.object({
        command: z.string().optional(),
        url: z.string().optional(),
    }).loose().refine(
        (c) => c.command || c.url,
        "config must have either 'command' (stdio) or 'url' (HTTP)"
    ),
});

const DeleteBody = z.object({
    name: z.string().min(1),
});

/**
 * GET /api/mcp-servers
 * List all configured MCP servers.
 */
export const GET = tryApi(() => {
    const servers = listMcpServers();
    return json(servers);
});

/**
 * PUT /api/mcp-servers
 * Add or update an MCP server configuration.
 * Body: { name: string, config: ServerEntry }
 */
export const PUT = apiHandler(PutBody, ({ body }) => {
    upsertMcpServer(body.name, body.config);
    return json({ success: true });
});

/**
 * DELETE /api/mcp-servers
 * Remove an MCP server configuration.
 * Body: { name: string }
 */
export const DELETE = apiHandler(DeleteBody, ({ body }) => {
    const deleted = deleteMcpServer(body.name);
    if (!deleted) {
        return notFound(`MCP server "${body.name}" not found`);
    }

    return json({ success: true });
});
