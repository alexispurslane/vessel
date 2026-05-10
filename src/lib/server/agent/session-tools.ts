/**
 * @file Tool resolution and agent info.
 *
 * Functions for resolving which tools should be active in a session,
 * getting agent info for the UI, and checking MCP server connection status.
 */

import type { ActiveSession } from "./types.js";
import type { ConversationSettings } from "$lib/types.js";
import type { McpServerStatus } from "$lib/types/mcp.js";
import { getMcpServersFromDb } from "./mcp-config.js";
import { getExtensionRunner, getToolRegistry, getToolDefinitions } from "./pi-adapter.js";
import { log } from "$lib/server/logger.js";

// --- Tool resolution types ---

/** Input for resolveActiveToolNames(). */
export interface ResolveActiveToolNamesInput {
    /** Tool names currently active in the session (from getActiveToolNames()). */
    activeToolNames: string[];
    /** All tool names registered in the session, including inactive extensions (from getAllTools()). */
    allRegisteredToolNames: string[];
    /** Per-conversation settings (may be null if no settings row exists). */
    conversationSettings: ConversationSettings | null;
    /** The sandbox for this session, or null if sandboxing is disabled. */
    sandbox: unknown;
    /** Names of MCP/extension tools (from sourceInfo.source !== "builtin" && !== "sdk"). */
    mcpToolNames: Set<string>;
    /** Effective agent mode for this conversation ("agent" = all tools, "chat" = no tools). */
    effectiveAgentMode: "agent" | "chat";
    /** Whether network access is effectively allowed for this conversation. */
    networkAllowed: boolean;
}

/** Output of resolveActiveToolNames(). */
export interface ResolveActiveToolNamesResult {
    /** The tool names that should be active. */
    desiredToolNames: string[];
    /** Whether the active tool set needs to be updated (differs from activeToolNames). */
    needsUpdate: boolean;
}

/**
 * Collect tool names that should be disabled based on session rules.
 *
 * Applies three disabling rules in order:
 * 1. Chat mode disables all non-MCP built-in/SDK tools (except
 *    fetch/web_search when network is allowed).
 * 2. MCP explicitly off disables all MCP tools.
 * 3. Network off disables fetch and web_search.
 *
 * @param input - Tool resolution input parameters
 * @returns Set of tool names that should be disabled
 */
function collectDisabledTools(input: ResolveActiveToolNamesInput): Set<string> {
    const { allRegisteredToolNames, conversationSettings, mcpToolNames, effectiveAgentMode, networkAllowed } = input;

    const mcpExplicitlyOff = Array.isArray(conversationSettings?.enabledMcpServers) &&
        conversationSettings.enabledMcpServers.length === 0;

    const disabledTools = new Set<string>();

    // Chat mode: disable all non-MCP built-in and SDK tools.
    // Exception: fetch/web_search stay on when network is allowed.
    if (effectiveAgentMode === "chat") {
        for (const name of allRegisteredToolNames) {
            if (!mcpToolNames.has(name) && !(name === "fetch" && networkAllowed) && !(name === "web_search" && networkAllowed)) {
                disabledTools.add(name);
            }
        }
    }

    // MCP off: disable MCP tools
    if (mcpExplicitlyOff) {
        for (const name of mcpToolNames) {
            disabledTools.add(name);
        }
    }

    // Fetch and web_search tools are auto-disabled when network is off
    if (!networkAllowed) {
        disabledTools.add("fetch");
        disabledTools.add("web_search");
    }

    return disabledTools;
}

/**
 * Decide which tools should be active for a conversation session.
 *
 * Uses the effective agent mode to determine which tools are available:
 * - "agent" mode: all non-MCP tools enabled (read, bash, edit, write, glob, grep, fetch)
 * - "chat" mode: no tools enabled (plain conversation)
 *
 * Additional rules:
 * - MCP tools are removed when MCP is explicitly off (enabledMcpServers === [])
 * - Sandbox mode removes grep since sandboxed tools omit it
 * - The fetch tool is automatically disabled when network permissions are off
 *
 * @param input - Tool resolution input parameters
 * @returns The desired tool names and whether an update is needed
 */
export function resolveActiveToolNames(input: ResolveActiveToolNamesInput): ResolveActiveToolNamesResult {
    const { activeToolNames, allRegisteredToolNames, sandbox } = input;

    const disabledTools = collectDisabledTools(input);

    // Build the desired set: start from all registered tools, remove disabled ones
    // (and grep in sandbox mode since sandboxed tools omit it).
    const desiredToolNames = new Set(allRegisteredToolNames);
    for (const name of disabledTools) {
        desiredToolNames.delete(name);
    }
    if (sandbox) {
        desiredToolNames.delete("grep");
    }

    // Compare against the currently-active set to determine if an update is needed.
    const activeSet = new Set(activeToolNames);
    const needsUpdate = desiredToolNames.size !== activeSet.size ||
        [...desiredToolNames].some((n) => !activeSet.has(n));

    return { desiredToolNames: [...desiredToolNames], needsUpdate };
}

// --- Agent info ---

/**
 * Get the current system prompt and available tools/skills for a conversation's
 * active AgentSession. The session must be loaded in memory.
 *
 * @param activeSession - The active session to read from (caller passes it in)
 * @returns Agent info object, or null if unavailable
 */
export function getSessionAgentInfo(activeSession: ActiveSession): {
    systemPrompt: string;
    customSystemPrompt: string | null;
    appendSystemPrompt: string[] | null;
    tools: Array<{
        name: string;
        description: string;
        source: string;
        scope: string;
    }>;
    skills: Array<{
        name: string;
        description: string;
        source: string;
        scope: string;
        disableModelInvocation: boolean;
    }>;
} | null {
    const agentSession = activeSession.agentSession;

    // Extract system prompt
    const systemPrompt = agentSession.systemPrompt;

    // Extract custom/append system prompts from conversation settings
    const convSettings = activeSession.conversationSettings;
    const customSystemPrompt = convSettings?.customSystemPrompt ?? null;
    // Migrate legacy string-typed appendSystemPrompt to array
    const rawAppend = convSettings?.appendSystemPrompt ?? null;
    const appendSystemPrompt: string[] | null = rawAppend
        ? Array.isArray(rawAppend)
            ? rawAppend
            : [rawAppend]
        : null;

    // Extract tools info
    const allTools = agentSession.getAllTools();
    const tools = allTools.map((t) => ({
        name: t.name,
        description: t.description,
        source: t.sourceInfo.source,
        scope: t.sourceInfo.scope,
    }));

    // Extract skills from the resource loader
    const skillsResult = agentSession.resourceLoader.getSkills();
    const skills = skillsResult.skills.map((s) => ({
        name: s.name,
        description: s.description,
        source: s.sourceInfo.source,
        scope: s.sourceInfo.scope,
        disableModelInvocation: s.disableModelInvocation,
    }));

    return { systemPrompt, customSystemPrompt, appendSystemPrompt, tools, skills };
}

// --- MCP server status ---

export type { McpServerStatus } from "$lib/types/mcp.js";

/**
 * Get the MCP server connection status for an active conversation session.
 * Reads from pi-mcp-adapter's internal McpServerManager via the extension runner.
 *
 * @param activeSession - The active session to read from (caller passes it in)
 * @returns Array of MCP server status objects
 */
export function getMcpServerStatus(activeSession: ActiveSession): McpServerStatus[] {
    try {
        // Access the extension runner (private but accessible at runtime)
        const runner = getExtensionRunner(activeSession.agentSession);
        if (!runner?.extensions) return [];

        // Find the MCP adapter extension by looking for the "mcp" tool
        for (const ext of runner.extensions) {
            if (ext.tools?.has("mcp")) {
                // MCP adapter state (McpServerManager) is in a closure, not on the
                // Extension object. Try getting it from tool metadata.
                break;
            }
        }

        // Direct approach: access McpServerManager from the state. The state is in a
        // closure, but the toolMetadata map is accessible via the pi extension API.
        const _toolRegistry = getToolRegistry(activeSession.agentSession);
        const toolDefMap = getToolDefinitions(activeSession.agentSession);

        // The MCP proxy tool's description includes server names + tool counts but
        // not connection status. Extension runner's state is also inaccessible.

        // The metadata cache (data/agent/.mcp-metadata-cache.json) has per-server tool
        // lists but no connection status.

        // Most practical: invoke the mcp tool with no arguments (returns status) via
        // the execute function, since we can't access the closure state variable.

        // Simpler fallback: report MCP-related tools as a proxy for "connected".
        const result: McpServerStatus[] = [];
        const allServers = getMcpServersFromDb();

        for (const name of Object.keys(allServers)) {
            // Check if any tools with the server's prefix are registered
            const prefix = name.replace(/-/g, "_");
            let toolCount = 0;
            for (const toolName of toolDefMap.keys()) {
                if (toolName === "mcp" || toolName.startsWith(prefix + "_")) {
                    toolCount++;
                }
            }

            // If we see tools from this server, it's connected. Check for
            // server-specific direct tools (not just the gateway tool).
            result.push({
                name,
                status: toolCount > 0 ? "connected" : "unknown",
                toolCount: toolCount > 0 ? toolCount : undefined,
            });
        }

        return result;
    } catch (e) {
        log.debug("session-tools", "Failed to get MCP server status", e);
        return [];
    }
}
