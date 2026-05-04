import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler, tryApi, badRequest, notFound } from "$lib/server/api-errors.js";
import { getSessionWorkDir, createFileManagementSandbox } from "$lib/server/agent/sandbox-factory.js";
import { sanitizeAndResolvePath } from "$lib/server/fs-security.js";
import { resolve, relative, dirname } from "path";
import { readdir, rm } from "node:fs/promises";

/**
 * Recursively list files in a directory, returning paths relative to the base.
 */
async function listFilesRecursive(dir: string, base: string): Promise<string[]> {
    const results: string[] = [];
    if (!(await Bun.file(dir).exists())) return results;

    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...await listFilesRecursive(fullPath, base));
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
async function removeEmptyParents(filePath: string, rootDir: string) {
    let dir = dirname(filePath);
    while (dir !== rootDir && dir.startsWith(rootDir)) {
        try {
            const entries = await readdir(dir);
            if (entries.length === 0) {
                await rm(dir, { recursive: false });
                dir = dirname(dir);
            } else {
                break;
            }
        } catch {
            break;
        }
    }
}

const DeleteBody = z.object({
    path: z.string().min(1),
});

/**
 * GET /api/sessions/[id]/workspace
 *
 * List files in the agent's sandbox workspace.
 * Returns an array of file paths relative to the workspace root.
 */
export const GET = tryApi(async ({ params }) => {
    const id = params.id;
    if (!id) return badRequest("Missing session id");
    const workDir = getSessionWorkDir(id);
    if (!(await Bun.file(workDir).exists())) {
        return json({ files: [] });
    }

    const files = await listFilesRecursive(workDir, workDir);
    return json({ files });
});

/**
 * DELETE /api/sessions/[id]/workspace
 *
 * Delete a file from the agent's sandbox workspace.
 * Expects a JSON body with the relative file path:
 *   { "path": "subdir/file.txt" }
 *
 * Security: the resolved path is validated to stay within the workspace.
 */
export const DELETE = apiHandler(DeleteBody, async ({ body, event }) => {
    const id = event.params.id;
    if (!id) return badRequest("Missing session id");
    const workDir = getSessionWorkDir(id);
    const sandbox = await createFileManagementSandbox(id);

    // Resolve and validate the path stays within the workspace
    let filePath: string;
    try {
        filePath = sanitizeAndResolvePath(workDir, body.path);
    } catch {
        return json({ error: "Invalid file path" }, { status: 400 });
    }

    const resolvedWorkDir = resolve(workDir);

    if (!(await Bun.file(filePath).exists())) {
        return notFound("File not found");
    }

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
        await removeEmptyParents(filePath, resolvedWorkDir);
    } else {
        // No sandbox — delete directly
        await Bun.file(filePath).unlink();
        await removeEmptyParents(filePath, resolvedWorkDir);
    }

    return json({ success: true });
});
