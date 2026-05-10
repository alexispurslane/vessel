/**
 * @file MCP server configuration management.
 *
 * MCP server configs are stored in the `settings` table under the key
 * `mcp.servers` as a JSON object: `{ "server-name": { ...ServerEntry }, ... }`
 *
 * When a session is created, this module writes the current config to
 * `data/agent/mcp.json` so that pi-mcp-adapter can load it via its
 * standard `loadMcpConfig()` function.
 */

import { resolve } from "path";
import { mkdir, rename } from "node:fs/promises";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { tryJsonParse } from "$lib/utils.js";
import { AGENT_DIR } from "$lib/server/data-dir.js";
import type { McpServerEntry, McpServerInfo } from "$lib/types/mcp.js";

export type { McpServerEntry, McpServerInfo };

/** Path to the global MCP config file written for pi-mcp-adapter */
export const MCP_CONFIG_PATH = resolve(AGENT_DIR, "mcp.json");

/** The settings key used to store the MCP servers config blob */
export const MCP_SETTINGS_KEY = "mcp.servers";

/** Zod schema for a single MCP server entry */
export const mcpServerEntrySchema = z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    auth: z.union([z.literal("oauth"), z.literal("bearer"), z.literal(false)]).optional(),
    bearerToken: z.string().optional(),
    lifecycle: z.enum(["keep-alive", "lazy", "eager"]).optional(),
    idleTimeout: z.number().optional(),
    exposeResources: z.boolean().optional(),
    directTools: z.union([z.boolean(), z.array(z.string())]).optional(),
    excludeTools: z.array(z.string()).optional(),
    debug: z.boolean().optional(),
    defaultEnabled: z.boolean().optional(),
});

/** Zod schema for the full MCP servers config */
const mcpServersSchema = z.record(z.string(), mcpServerEntrySchema);

/**
 * Get all MCP server configs from the DB.
 * Returns the raw `Record<string, McpServerEntry>` object.
 * @returns The MCP servers config object, or empty object on failure
 */
export function getMcpServersFromDb(): Record<string, McpServerEntry> {
    const db = getDb();
    const row = db
        .query("SELECT value FROM settings WHERE key = ?")
        .get(MCP_SETTINGS_KEY) as { value: string } | undefined;

    if (!row?.value) return {};

    try {
        return tryJsonParse(row.value, mcpServersSchema);
    } catch {
        return {};
    }
}

/**
 * Set the entire MCP servers config in the DB.
 * @param servers - The full MCP servers config to persist
 * @returns {void}
 */
export function setMcpServersToDb(servers: Record<string, McpServerEntry>): void {
    const db = getDb();
    const value = JSON.stringify(servers);
    db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(MCP_SETTINGS_KEY, value);
}

/**
 * List all MCP servers (for the frontend).
 * @returns Array of MCP server info with name and config
 */
export function listMcpServers(): McpServerInfo[] {
    const servers = getMcpServersFromDb();
    return Object.entries(servers).map(([name, config]) => ({ name, config }));
}

/**
 * Add or update a single MCP server.
 * @param name - The server name
 * @param config - The server configuration
 * @returns {Promise<void>}
 */
export async function upsertMcpServer(name: string, config: McpServerEntry): Promise<void> {
    const servers = getMcpServersFromDb();
    servers[name] = config;
    setMcpServersToDb(servers);
    await writeMcpConfigFile(servers);
}

/**
 * Delete a single MCP server by name.
 * Returns true if the server existed and was deleted.
 * @param name - The server name to delete
 * @returns Whether the server existed and was deleted
 */
export async function deleteMcpServer(name: string): Promise<boolean> {
    const servers = getMcpServersFromDb();
    if (!(name in servers)) return false;
    Reflect.deleteProperty(servers, name);
    setMcpServersToDb(servers);
    await writeMcpConfigFile(servers);
    return true;
}

/**
 * Write the MCP config to `data/agent/mcp.json` for pi-mcp-adapter to read.
 * This must be called whenever the config changes and before a session is created.
 *
 * The global config file only includes servers with `defaultEnabled !== false`,
 * since this is what new conversation sessions (with no per-conversation override)
 * will use. Per-conversation filtering is handled separately by filterMcpServers().
 *
 * @param servers - Optional server configs to write; reads from DB if omitted
 * @returns {Promise<void>}
 */
export async function writeMcpConfigFile(servers?: Record<string, McpServerEntry>): Promise<void> {
    const allServers = servers ?? getMcpServersFromDb();

    // Only include servers enabled by default in the global config file
    const enabledServers: Record<string, McpServerEntry> = {};
    for (const [name, entry] of Object.entries(allServers)) {
        if (entry.defaultEnabled !== false) {
            enabledServers[name] = entry;
        }
    }

    const mcpJson = {
        mcpServers: enabledServers,
        settings: {
            toolPrefix: "server" as const,
            idleTimeout: 10,
        },
    };

    await mkdir(AGENT_DIR, { recursive: true });

    // Atomic write: write to temp file then rename
    const tmpPath = `${MCP_CONFIG_PATH}.${String(process.pid)}.tmp`;
    await Bun.write(tmpPath, JSON.stringify(mcpJson, null, 2) + "\n");
    await rename(tmpPath, MCP_CONFIG_PATH);
}

/**
 * Ensure the MCP config file exists on disk, writing it if necessary.
 * Called at startup and before session creation.
 */
export async function ensureMcpConfigFile(): Promise<void> {
    if (!(await Bun.file(MCP_CONFIG_PATH).exists())) {
        await writeMcpConfigFile();
    }
}

/**
 * Filter MCP servers based on a conversation's enabled list.
 *
 * - `enabledMcpServers === null or undefined`: use per-server `defaultEnabled`
 *   (servers with `defaultEnabled !== false` are included, i.e. `true` or missing = on)
 * - `enabledMcpServers === []`: no servers included
 * - `enabledMcpServers === ["github", "fs"]`: only those named servers
 *
 * @param enabledMcpServers - Explicit list of server names, or null/undefined for defaults
 * @returns Filtered MCP servers config
 */
export function filterMcpServers(
    enabledMcpServers: string[] | null | undefined
): Record<string, McpServerEntry> {
    const allServers = getMcpServersFromDb();

    if (enabledMcpServers === null || enabledMcpServers === undefined) {
        // Use per-server defaultEnabled (true if unspecified)
        const filtered: Record<string, McpServerEntry> = {};
        for (const [name, entry] of Object.entries(allServers)) {
            if (entry.defaultEnabled !== false) {
                filtered[name] = entry;
            }
        }
        return filtered;
    }

    // Explicit list of enabled server names
    const filtered: Record<string, McpServerEntry> = {};
    for (const name of enabledMcpServers) {
        if (name in allServers) {
            filtered[name] = allServers[name];
        }
    }
    return filtered;
}

/**
 * Write a per-conversation MCP config file and return its path.
 * This is used when a conversation only enables a subset of MCP servers.
 * @param conversationId - The conversation ID
 * @param enabledMcpServers - Explicit list of server names, or null/undefined for defaults
 * @returns The path to the written config file
 */
export async function writeConversationMcpConfig(
    conversationId: string,
    enabledMcpServers: string[] | null | undefined
): Promise<string> {
    const filtered = filterMcpServers(enabledMcpServers);

    const mcpJson = {
        mcpServers: filtered,
        settings: {
            toolPrefix: "server" as const,
            idleTimeout: 10,
        },
    };

    const convDir = resolve(AGENT_DIR, "conversations", conversationId);
    await mkdir(convDir, { recursive: true });

    const configPath = resolve(convDir, "mcp.json");
    const tmpPath = `${configPath}.${String(process.pid)}.tmp`;
    await Bun.write(tmpPath, JSON.stringify(mcpJson, null, 2) + "\n");
    await rename(tmpPath, configPath);

    return configPath;
}
