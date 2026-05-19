/**
 * @file Sandboxed coding tools for pi-coding-agent.
 *
 * Builds each tool individually with custom Operations that route
 * through a zerobox Sandbox, instead of using the convenience
 * `createCodingTools()` which doesn't support per-tool operations.
 */

import type { Sandbox } from "zerobox";
import {
    createBashTool,
    createReadTool,
    createWriteTool,
    createEditTool,
    createFindTool,
    createLsTool,
} from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";

/**
 * Type for heterogeneous AgentTool arrays.
 * See pi-adapter.ts AnyAgentTool for rationale on the `any` generic.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAgentTool = AgentTool<any>;
import {
    createSandboxedBashOps,
    createSandboxedReadOps,
    createSandboxedWriteOps,
    createSandboxedEditOps,
    createSandboxedFindOps,
    createSandboxedLsOps,
} from "./sandboxed-ops.js";
import { createFetchTool } from "./sandboxed-fetch-tool.js";

export interface SandboxedCodingToolsOptions {
    /**
     * A shared Set shared with the search tool to track URLs that appeared in search results.
     * When the fetch tool encounters a URL in this set, it skips the actual fetch and
     * returns a message indicating the page was already seen in search results.
     */
    searchResultUrls?: Set<string>;
    /** The conversation ID, used to serve in-memory canvas content for read operations. */
    conversationId: string;
}

/**
 * Create the standard set of coding tools (bash, read, write, edit, find, ls, fetch)
 * with all operations routed through the given zerobox sandbox.
 *
 * This is the sandboxed equivalent of `createCodingTools(cwd)` + fetch.
 *
 * Note: The grep tool is intentionally omitted because its GrepOperations
 * interface only exposes helper hooks (isDirectory, readFile) — the actual
 * ripgrep search runs directly on the host and can't be intercepted. The agent
 * can use bash with grep/rg commands instead, which goes through the sandboxed
 * bash operations.
 *
 * @param cwd - The working directory for the tools
 * @param sandbox - The zerobox sandbox instance
 * @param options - Configuration including conversationId and optional search result URL tracker
 * @returns Array of sandboxed AgentTool instances
 */
export function createSandboxedCodingTools(cwd: string, sandbox: Sandbox, options: SandboxedCodingToolsOptions): AnyAgentTool[] {
    return [
        createBashTool(cwd, {
            operations: createSandboxedBashOps(sandbox),
        }),
        createReadTool(cwd, {
            operations: createSandboxedReadOps(sandbox, { conversationId: options.conversationId, workDir: cwd }),
        }),
        createWriteTool(cwd, {
            operations: createSandboxedWriteOps(sandbox),
        }),
        createEditTool(cwd, {
            operations: createSandboxedEditOps(sandbox),
        }),
        createFindTool(cwd, {
            operations: createSandboxedFindOps(sandbox),
        }),
        createLsTool(cwd, {
            operations: createSandboxedLsOps(sandbox),
        }),
        createFetchTool({
            sandbox,
            searchResultUrls: options?.searchResultUrls,
        }),
    ];
}
