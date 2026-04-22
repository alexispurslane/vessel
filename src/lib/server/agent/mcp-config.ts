/**
 * MCP server configuration management.
 *
 * MCP server configs are stored in the `settings` table under the key
 * `mcp.servers` as a JSON object: `{ "server-name": { ...ServerEntry }, ... }`
 *
 * When a session is created, this module writes the current config to
 * `data/agent/mcp.json` so that pi-mcp-adapter can load it via its
 * standard `loadMcpConfig()` function.
 */

import { join, resolve } from "path";
import { writeFileSync, mkdirSync, existsSync, renameSync } from "fs";
import { getDb } from "../db/index.js";

const DATA_DIR = resolve(process.cwd(), "data");
const AGENT_DIR = resolve(DATA_DIR, "agent");

/** Path to the global MCP config file written for pi-mcp-adapter */
export const MCP_CONFIG_PATH = resolve(AGENT_DIR, "mcp.json");

/** The settings key used to store the MCP servers config blob */
export const MCP_SETTINGS_KEY = "mcp.servers";

/** A simplified MCP server entry matching Claude-like JSON config syntax */
export interface McpServerEntry {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
    auth?: "oauth" | "bearer" | false;
    bearerToken?: string;
    lifecycle?: "keep-alive" | "lazy" | "eager";
    idleTimeout?: number;
    exposeResources?: boolean;
    directTools?: boolean | string[];
    excludeTools?: string[];
    debug?: boolean;
    /** Whether this server is enabled by default in new conversations (default: true) */
    defaultEnabled?: boolean;
}

/** MCP server info returned to the frontend (sensitive fields masked) */
export interface McpServerInfo {
    name: string;
    config: McpServerEntry;
}

/**
 * Get all MCP server configs from the DB.
 * Returns the raw `Record<string, McpServerEntry>` object.
 */
export function getMcpServersFromDb(): Record<string, McpServerEntry> {
    const db = getDb();
    const row = db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get(MCP_SETTINGS_KEY) as { value: string } | undefined;

    if (!row?.value) return {};

    try {
        const parsed = JSON.parse(row.value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, McpServerEntry>;
        }
        return {};
    } catch {
        return {};
    }
}

/**
 * Set the entire MCP servers config in the DB.
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
 */
export function listMcpServers(): McpServerInfo[] {
    const servers = getMcpServersFromDb();
    return Object.entries(servers).map(([name, config]) => ({ name, config }));
}

/**
 * Add or update a single MCP server.
 */
export function upsertMcpServer(name: string, config: McpServerEntry): void {
    const servers = getMcpServersFromDb();
    servers[name] = config;
    setMcpServersToDb(servers);
    writeMcpConfigFile(servers);
}

/**
 * Delete a single MCP server by name.
 * Returns true if the server existed and was deleted.
 */
export function deleteMcpServer(name: string): boolean {
    const servers = getMcpServersFromDb();
    if (!(name in servers)) return false;
    delete servers[name];
    setMcpServersToDb(servers);
    writeMcpConfigFile(servers);
    return true;
}

/**
 * Write the MCP config to `data/agent/mcp.json` for pi-mcp-adapter to read.
 * This must be called whenever the config changes and before a session is created.
 *
 * The global config file only includes servers with `defaultEnabled !== false`,
 * since this is what new conversation sessions (with no per-conversation override)
 * will use. Per-conversation filtering is handled separately by filterMcpServers().
 */
export function writeMcpConfigFile(servers?: Record<string, McpServerEntry>): void {
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

    mkdirSync(AGENT_DIR, { recursive: true });

    // Atomic write: write to temp file then rename
    const tmpPath = `${MCP_CONFIG_PATH}.${process.pid}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(mcpJson, null, 2) + "\n", "utf-8");
    renameSync(tmpPath, MCP_CONFIG_PATH);
}

/**
 * Ensure the MCP config file exists on disk, writing it if necessary.
 * Called at startup and before session creation.
 */
export function ensureMcpConfigFile(): void {
    if (!existsSync(MCP_CONFIG_PATH)) {
        writeMcpConfigFile();
    }
}

/**
 * Filter MCP servers based on a conversation's enabled list.
 *
 * - `enabledMcpServers === null or undefined`: use per-server `defaultEnabled`
 *   (servers with `defaultEnabled !== false` are included, i.e. `true` or missing = on)
 * - `enabledMcpServers === []`: no servers included
 * - `enabledMcpServers === ["github", "fs"]`: only those named servers
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
 */
export function writeConversationMcpConfig(
    conversationId: string,
    enabledMcpServers: string[] | null | undefined
): string {
    const filtered = filterMcpServers(enabledMcpServers);

    const mcpJson = {
        mcpServers: filtered,
        settings: {
            toolPrefix: "server" as const,
            idleTimeout: 10,
        },
    };

    const convDir = resolve(AGENT_DIR, "conversations", conversationId);
    mkdirSync(convDir, { recursive: true });

    const configPath = resolve(convDir, "mcp.json");
    const tmpPath = `${configPath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(mcpJson, null, 2) + "\n", "utf-8");
    renameSync(tmpPath, configPath);

    return configPath;
}
