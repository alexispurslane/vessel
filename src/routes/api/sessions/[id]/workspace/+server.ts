import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getSessionWorkDir } from "$lib/server/agent/sandbox-factory.js";
import { getSessionSandbox } from "$lib/server/agent/session-store.js";
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

    const body = await request.json();
    const { path: relativePath } = body;

    if (!relativePath || typeof relativePath !== "string") {
        return json({ error: "path is required and must be a string" }, { status: 400 });
    }

    const resolvedWorkDir = resolve(workDir);
    const filePath = resolve(workDir, relativePath);

    // Security: ensure the resolved path is within the workspace
    if (!filePath.startsWith(resolvedWorkDir)) {
        return json({ error: "Invalid file path" }, { status: 400 });
    }

    if (!existsSync(filePath)) {
        return json({ error: "File not found" }, { status: 404 });
    }

    try {
        unlinkSync(filePath);
        // Clean up any empty parent directories left behind
        removeEmptyParents(filePath, resolvedWorkDir);

        // Trigger a sandbox snapshot by running a no-op command through the sandbox.
        // The deletion bypasses the sandbox (removes directly from the host filesystem),
        // so zerobox doesn't record the change. Running a trivial command forces
        // a snapshot diff that captures the externally-deleted file.
        const sandbox = getSessionSandbox(conversationId);
        if (sandbox) {
            try {
                await sandbox.exec("true").output();
            } catch (snapshotErr) {
                // Snapshot trigger is best-effort — don't fail the delete
                console.warn(
                    `[workspace] Failed to trigger sandbox snapshot for session ${conversationId}:`,
                    snapshotErr
                );
            }
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
