import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getSessionWorkDir } from "$lib/server/agent/sandbox-factory.js";
import { getOrCreateSession, getSessionSandbox } from "$lib/server/agent/session-store.js";
import { mkdirSync, createWriteStream } from "fs";
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
        await getOrCreateSession(conversationId);
    } catch {
        return json({ error: "Conversation not found" }, { status: 404 });
    }

    const workDir = getSessionWorkDir(conversationId);
    if (!workDir) {
        return json({ error: "No workspace directory for this conversation" }, { status: 500 });
    }

    const filename = request.headers.get("x-filename");
    if (!filename) {
        return json({ error: "X-Filename header is required" }, { status: 400 });
    }

    const filePath = resolve(workDir, filename);
    const dir = dirname(filePath);

    // Security: ensure the resolved path is still within the workspace
    if (!filePath.startsWith(resolve(workDir))) {
        return json({ error: "Invalid file path" }, { status: 400 });
    }

    // Create parent directories if needed
    mkdirSync(dir, { recursive: true });

    try {
        // Write the file by streaming the request body to disk
        if (request.body) {
            const fileStream = createWriteStream(filePath);
            const reader = request.body.getReader();

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
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

        // Trigger a sandbox snapshot by running a no-op command through the sandbox.
        // The upload bypasses the sandbox (writes directly to the host filesystem),
        // so zerobox doesn't record the change. Running a trivial command forces
        // a snapshot diff that captures the externally-written file.
        const sandbox = getSessionSandbox(conversationId);
        if (sandbox) {
            try {
                await sandbox.exec("true").output();
            } catch (snapshotErr) {
                // Snapshot trigger is best-effort — don't fail the upload
                console.warn(
                    `[upload] Failed to trigger sandbox snapshot for session ${conversationId}:`,
                    snapshotErr
                );
            }
        }

        return json({
            success: true,
            filename,
            path: join("/", filename), // Relative to sandbox root
        });
    } catch (err) {
        console.error(`[upload] Error uploading file to session ${conversationId}:`, err);
        return json(
            { error: err instanceof Error ? err.message : "Upload failed" },
            { status: 500 }
        );
    }
};
