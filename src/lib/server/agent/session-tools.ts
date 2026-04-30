/**
 * Tool resolution and agent info.
 *
 * Functions for resolving which tools should be active in a session,
 * getting agent info for the UI, and checking MCP server connection status.
 */

import type { ActiveSession } from "./types.js";
import type { ConversationSettings } from "$lib/types.js";
import { getMcpServersFromDb } from "./mcp-config.js";
import { getExtensionRunner, getToolRegistry, getToolDefinitions } from "./pi-adapter.js";

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
 */
export function resolveActiveToolNames(input: ResolveActiveToolNamesInput): ResolveActiveToolNamesResult {
    const { activeToolNames, allRegisteredToolNames, conversationSettings, sandbox, mcpToolNames, effectiveAgentMode, networkAllowed } = input;

    // Identify MCP extension tools so we can disable them when MCP is off.
    const mcpExplicitlyOff = Array.isArray(conversationSettings?.enabledMcpServers) &&
        conversationSettings.enabledMcpServers.length === 0;

    // Collect all tool names that should be disabled.
    const disabledTools = new Set<string>();

    // Chat mode: disable all non-MCP built-in and SDK tools.
    // In chat mode, the agent is used as a plain conversation with no tools.
    // Exception: the fetch tool is kept available when network access is on,
    // so the model can still fetch web pages even in chat mode.
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
            : [rawAppend as string]
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
        source: s.sourceInfo?.source ?? "unknown",
        scope: s.sourceInfo?.scope ?? "unknown",
        disableModelInvocation: s.disableModelInvocation ?? false,
    }));

    return { systemPrompt, customSystemPrompt, appendSystemPrompt, tools, skills };
}

// --- MCP server status ---

/**
 * MCP server connection status for a conversation.
 */
export interface McpServerStatus {
    name: string;
    status: "connected" | "closed" | "needs-auth" | "unknown";
    toolCount?: number;
}

/**
 * Get the MCP server connection status for an active conversation session.
 * Reads from pi-mcp-adapter's internal McpServerManager via the extension runner.
 *
 * @param activeSession - The active session to read from (caller passes it in)
 */
export function getMcpServerStatus(activeSession: ActiveSession): McpServerStatus[] {
    try {
        // Access the extension runner (private but accessible at runtime)
        const runner = getExtensionRunner(activeSession.agentSession);
        if (!runner?.extensions) return [];

        // Find the MCP adapter extension by looking for the one that registered the "mcp" tool
        for (const ext of runner.extensions) {
            if (ext.tools?.has("mcp")) {
                // This is the MCP adapter extension. Its state holds the McpServerManager.
                // The state isn't on the Extension object — it's in the closure.
                // We need to access it through the manager on the state.
                // Since state is a closure variable, we can try getting it from tool metadata.
                break;
            }
        }

        // Direct approach: access the McpServerManager from the state.
        // The state is stored in a closure, but the toolMetadata map is accessible
        // through the pi extension API. Let's try reading the MCP tool's description
        // which includes server names + tool counts in its dynamically generated description.
        const toolRegistry = getToolRegistry(activeSession.agentSession);
        const toolDefMap = getToolDefinitions(activeSession.agentSession);

        // The MCP proxy tool's description is dynamically built and includes server names + tool counts.
        // But it doesn't include connection status directly.
        // For a more direct approach, let's look at the extension runner's state.
        // The runner stores extensions, and the MCP adapter stores its state locally.
        // We can access it through the runner's private _extensions field.

        // Actually, the cleanest path: use the tool metadata cache file that pi-mcp-adapter writes
        // at data/agent/.mcp-metadata-cache.json. This contains per-server tool lists.
        // But it won't have connection status.

        // Most practical: interrogate the McpServerManager directly.
        // The adapter's `state` variable holds a reference to the manager.
        // We can't get at the closure variable, but we CAN invoke the mcp tool
        // with no arguments (which returns status) by calling the execute function.

        // However, that's complex. For now, let's read the active tool list
        // and report which MCP-related tools are present as a proxy for "connected".
        const result: McpServerStatus[] = [];
        const allServers = getMcpServersFromDb();

        for (const name of Object.keys(allServers)) {
            // Check if any tools with the server's prefix are registered
            const prefix = name.replace(/-/g, "_");
            let toolCount = 0;
            for (const toolName of toolDefMap?.keys() ?? []) {
                if (toolName === "mcp" || toolName.startsWith(prefix + "_")) {
                    toolCount++;
                }
            }

            // If we see tools from this server, it's connected.
            // The MCP gateway tool is always present, so check for server-specific direct tools.
            result.push({
                name,
                status: toolCount > 0 ? "connected" : "unknown",
                toolCount: toolCount > 0 ? toolCount : undefined,
            });
        }

        return result;
    } catch {
        return [];
    }
}
