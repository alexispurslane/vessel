/**
 * Sandboxed coding tools for pi-coding-agent.
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
import {
    createSandboxedBashOps,
    createSandboxedReadOps,
    createSandboxedWriteOps,
    createSandboxedEditOps,
    createSandboxedFindOps,
    createSandboxedLsOps,
} from "./sandboxed-ops.js";
import { createFetchTool } from "./sandboxed-fetch-tool.js";

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
 */
export function createSandboxedCodingTools(cwd: string, sandbox: Sandbox): AgentTool<any>[] {
    return [
        createBashTool(cwd, {
            operations: createSandboxedBashOps(sandbox),
        }),
        createReadTool(cwd, {
            operations: createSandboxedReadOps(sandbox),
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
        }),
    ];
}
