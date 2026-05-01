import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getSessionWorkDir, createFileManagementSandbox } from "$lib/server/agent/sandbox-factory.js";
import { getOrHydrateSession } from "$lib/server/agent/session-store.js";
import { sanitizeFilename, sanitizeAndResolvePath } from "$lib/server/fs-security.js";
import { badRequest, notFound, internalError } from "$lib/server/api-errors.js";
import { mkdirSync, createWriteStream, unlinkSync } from "fs";
import { resolve, dirname, join } from "path";

/**
 * POST /api/sessions/[id]/upload
 *
 * Upload a file to the agent's sandbox workspace using streaming.
 *
 * The file is sent as raw binary in the request body with metadata in headers:
 * - `X-Filename`: the original filename (required)
 * - `Content-Type`: the file's MIME type
 *
 * The body streams directly to disk with backpressure handling —
 * no size limits, no encoding overhead.
 *
 * Files are written to `data/sessions/<id>/workspace/<filename>`,
 * which is the agent's sandbox working directory.
 */
export const POST: RequestHandler = async ({ params, request }) => {
    const conversationId = params.id;

    // Verify the conversation/session exists
    try {
        await getOrHydrateSession(conversationId);
    } catch {
        return notFound("Conversation not found");
    }

    const workDir = getSessionWorkDir(conversationId);
    if (!workDir) {
        return internalError("No workspace directory for this conversation");
    }

    const rawFilename = request.headers.get("x-filename");
    if (!rawFilename) {
        return badRequest("X-Filename header is required");
    }

    // Sanitize the filename: strip directory components, reject traversal
    let filename: string;
    try {
        filename = sanitizeFilename(rawFilename);
    } catch {
        return badRequest("Invalid filename");
    }

    // Resolve and validate the full path stays within the workspace
    let filePath: string;
    try {
        filePath = sanitizeAndResolvePath(workDir, filename);
    } catch {
        return badRequest("Invalid file path");
    }

    const dir = dirname(filePath);

    // Defense-in-depth: re-verify the resolved path is still within the workspace
    if (!filePath.startsWith(resolve(workDir))) {
        return badRequest("Invalid file path");
    }

    const sandbox = createFileManagementSandbox(conversationId);

    // When the sandbox is active, we need to route the file write through
    // it so zerobox's snapshot records the change. Each sandbox.exec() call
    // creates its own snapshot session (baseline → command → incremental diff).
    // If we write directly to disk, the file appears in the baseline of the
    // next sandboxed tool call — not as a change in any diff.
    //
    // We use a dedicated file-management sandbox (not the agent's sandbox)
    // so that user file operations always succeed regardless of the agent's
    // read/write restrictions. The file-management sandbox still records
    // snapshots so the changes appear in the audit trail.
    //
    // Strategy: stream to a temp file inside the workspace (excluded from
    // snapshots via .upload-tmp in snapshotExclude), then mv it into place
    // through the sandbox. The snapshot will record the file as "Created".
    //
    // When the sandbox is not available (sandboxing disabled), we write
    // directly — snapshots are off anyway in that case.
    const UPLOAD_TMP_DIR = ".upload-tmp";
    const tmpSuffix = `${String(Date.now())}.${Math.random().toString(36).slice(2)}`;
    const tmpRelPath = join(UPLOAD_TMP_DIR, `${filename}.tmp.${tmpSuffix}`);
    const tmpAbsPath = resolve(workDir, tmpRelPath);
    mkdirSync(dirname(tmpAbsPath), { recursive: true });

    try {
        // Stream the request body to the temp file (inside workspace but excluded from snapshots)
        if (request.body) {
            const fileStream = createWriteStream(tmpAbsPath);
            const reader = request.body.getReader();

            try {
                /* eslint-disable @typescript-eslint/no-unnecessary-condition -- while(true) is the idiomatic stream reading pattern */
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    /* eslint-enable @typescript-eslint/no-unnecessary-condition */
                    if (!fileStream.write(value)) {
                        // Handle backpressure
                        await new Promise<void>((resolve) => fileStream.once("drain", resolve));
                    }
                }
            } finally {
                fileStream.end();
                await new Promise<void>((resolve) => fileStream.on("finish", resolve));
            }
        }

        if (sandbox) {
            // Move the file through the sandbox so the snapshot records it as "Created".
            // The .upload-tmp directory is excluded from snapshots, so the temp file
            // won't appear in the baseline — only the final destination will show up
            // as a new file in the incremental diff.
            mkdirSync(dir, { recursive: true });
            const result = await sandbox
                .exec("mv", [tmpAbsPath, filePath])
                .output();
            if (result.code !== 0) {
                throw new Error(`Sandbox mv failed: ${result.stderr}`);
            }
        } else {
            // No sandbox — move the temp file directly into the workspace
            mkdirSync(dir, { recursive: true });
            try {
                const { renameSync } = await import("fs");
                renameSync(tmpAbsPath, filePath);
            } catch {
                // rename can fail across mount points; fall back to copy + delete
                const { copyFileSync } = await import("fs");
                copyFileSync(tmpAbsPath, filePath);
                try { unlinkSync(tmpAbsPath); } catch { /* ignore cleanup errors */ }
            }
        }

        return json({
            success: true,
            filename,
            path: join("/", filename), // Relative to sandbox root
        });
    } catch (err) {
        console.error(`[upload] Error uploading file to session ${conversationId}:`, err);
        const message = err instanceof Error ? err.message : "Upload failed";
        return internalError(message);
    }
};
