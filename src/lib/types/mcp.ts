/**
 * @file Shared MCP (Model Context Protocol) server types.
 *
 * Used by both the backend (mcp-config, session-tools) and
 * the frontend API layer.
 */

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

/** MCP server connection status for a conversation */
export interface McpServerStatus {
	name: string;
	status: "connected" | "closed" | "needs-auth" | "unknown";
	toolCount?: number;
}
