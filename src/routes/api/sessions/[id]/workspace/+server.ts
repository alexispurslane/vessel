import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getSessionWorkDir, createFileManagementSandbox } from "$lib/server/agent/sandbox-factory.js";
import { sanitizeAndResolvePath } from "$lib/server/fs-security.js";
import { existsSync, readdirSync, statSync, unlinkSync, rmdirSync } from "fs";
import { resolve, relative, dirname } from "path";

/**
 * Recursively list files in a directory, returning paths relative to the base.
 */
function listFilesRecursive(dir: string, base: string): string[] {
    const results: string[] = [];
    if (!existsSync(dir)) return results;

    for (const entry of readdirSync(dir)) {
        const fullPath = resolve(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            results.push(...listFilesRecursive(fullPath, base));
        } else {
            results.push(relative(base, fullPath));
        }
    }
    return results;
}

/**
 * Remove empty parent directories up to the workspace root.
 * This keeps the workspace tidy after deleting nested files.
 */
function removeEmptyParents(filePath: string, rootDir: string) {
    let dir = dirname(filePath);
    while (dir !== rootDir && dir.startsWith(rootDir)) {
        try {
            const entries = readdirSync(dir);
            if (entries.length === 0) {
                rmdirSync(dir);
                dir = dirname(dir);
            } else {
                break;
            }
        } catch {
            break;
        }
    }
}

/**
 * GET /api/sessions/[id]/workspace
 *
 * List files in the agent's sandbox workspace.
 * Returns an array of file paths relative to the workspace root.
 */
export const GET: RequestHandler = async ({ params }) => {
    const conversationId = params.id;
    const workDir = getSessionWorkDir(conversationId);

    if (!existsSync(workDir)) {
        return json({ files: [] });
    }

    const files = listFilesRecursive(workDir, workDir);
    return json({ files });
};

/**
 * DELETE /api/sessions/[id]/workspace
 *
 * Delete a file from the agent's sandbox workspace.
 * Expects a JSON body with the relative file path:
 *   { "path": "subdir/file.txt" }
 *
 * Security: the resolved path is validated to stay within the workspace.
 */
export const DELETE: RequestHandler = async ({ params, request }) => {
    const conversationId = params.id;
    const workDir = getSessionWorkDir(conversationId);
    const sandbox = createFileManagementSandbox(conversationId);

    const body = await request.json();
    const { path: relativePath } = body;

    if (!relativePath || typeof relativePath !== "string") {
        return json({ error: "path is required and must be a string" }, { status: 400 });
    }

    // Resolve and validate the path stays within the workspace
    let filePath: string;
    try {
        filePath = sanitizeAndResolvePath(workDir, relativePath);
    } catch {
        return json({ error: "Invalid file path" }, { status: 400 });
    }

    const resolvedWorkDir = resolve(workDir);

    if (!existsSync(filePath)) {
        return json({ error: "File not found" }, { status: 404 });
    }

    try {
        if (sandbox) {
            // Route the deletion through the sandbox so the snapshot records it.
            // The baseline captures the file as existing, the incremental sees it
            // gone after rm — so the diff shows the file as "Deleted".
            //
            // We use a dedicated file-management sandbox (not the agent's sandbox)
            // so user file operations always succeed regardless of the agent's
            // read/write restrictions.
            const result = await sandbox
                .exec("rm", [filePath])
                .output();
            if (result.code !== 0) {
                throw new Error(`Sandbox rm failed: ${result.stderr}`);
            }
            // Clean up any empty parent directories left behind (done on host since
            // rmdir on empty dirs doesn't need snapshot tracking)
            removeEmptyParents(filePath, resolvedWorkDir);
        } else {
            // No sandbox — delete directly
            unlinkSync(filePath);
            removeEmptyParents(filePath, resolvedWorkDir);
        }

        return json({ success: true });
    } catch (err) {
        console.error(`[workspace] Error deleting file ${relativePath} from session ${conversationId}:`, err);
        return json(
            { error: err instanceof Error ? err.message : "Delete failed" },
            { status: 500 }
        );
    }
};
