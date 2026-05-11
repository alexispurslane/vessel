import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getSessionWorkDir, createFileManagementSandbox } from "$lib/server/agent/sandbox-factory.js";
import { getOrHydrateSession } from "$lib/server/agent/session-store.js";
import { sanitizeFilename, sanitizeAndResolvePath } from "$lib/server/fs-security.js";
import { badRequest, notFound, internalError } from "$lib/server/api-errors.js";
import { resolve, dirname, join } from "path";
import { mkdir, rename } from "node:fs/promises";

/**
 * Read all chunks from a ReadableStreamBody and return them as a Blob.
 *
 * @param body - The readable stream to consume
 * @returns A Blob containing all chunks
 */
async function readBodyAsBlob(body: ReadableStream<Uint8Array>): Promise<Blob> {
    const chunks: ArrayBuffer[] = [];
    const reader = body.getReader();
    try {
        /* eslint-disable @typescript-eslint/no-unnecessary-condition */
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            /* eslint-enable @typescript-eslint/no-unnecessary-condition */
            chunks.push(value.buffer as ArrayBuffer);
        }
    } finally {
        reader.releaseLock();
    }
    return new Blob(chunks);
}

/**
 * Validate the upload request and return the validated paths, or an error response.
 *
 * @param params - The route params
 * @param params.id - The conversation/session ID
 * @param request - The incoming request
 * @returns The validated paths, or an error Response if validation fails
 */
// { id: string } is structurally the same as session entry in session-history, but semantically distinct
// oxlint-disable similarity-ts/no-duplicates-error
async function validateUploadRequest(
    params: { id: string },
    request: Request
): Promise<{ workDir: string; filename: string; filePath: string; dir: string } | Response> {
    const conversationId = params.id;

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

    let filename: string;
    try {
        filename = sanitizeFilename(rawFilename);
    } catch {
        return badRequest("Invalid filename");
    }

    let filePath: string;
    try {
        filePath = sanitizeAndResolvePath(workDir, filename);
    } catch {
        return badRequest("Invalid file path");
    }

    if (!filePath.startsWith(resolve(workDir))) {
        return badRequest("Invalid file path");
    }

    return { workDir, filename, filePath, dir: dirname(filePath) };
}

/**
 * Move a temp file into the workspace through the sandbox.
 *
 * @param sandbox - The sandbox instance, or null if sandboxing is disabled
 * @param tmpAbsPath - Absolute path to the temp file
 * @param filePath - Absolute path to the final destination
 * @param dir - Directory of the final destination
 */
async function moveFileToDestination(
    sandbox: Awaited<ReturnType<typeof createFileManagementSandbox>>,
    tmpAbsPath: string,
    filePath: string,
    dir: string
): Promise<void> {
    if (sandbox) {
        await mkdir(dir, { recursive: true });
        const result = await sandbox
            .exec("mv", [tmpAbsPath, filePath])
            .output();
        if (result.code !== 0) {
            throw new Error(`Sandbox mv failed: ${result.stderr}`);
        }
        return;
    }

    await mkdir(dir, { recursive: true });
    try {
        await rename(tmpAbsPath, filePath);
    } catch {
        // rename can fail across mount points; fall back to copy + delete
        await Bun.write(filePath, Bun.file(tmpAbsPath));
        try { await Bun.file(tmpAbsPath).unlink(); } catch { /* ignore cleanup errors */ }
    }
}

/**
 * POST /api/sessions/[id]/upload
 *
 * Upload a file to the agent's sandbox workspace using streaming.
 *
 * The file is sent as raw binary in the request body with metadata in headers:
 * - `X-Filename`: the original filename (required)
 * - `Content-Type`: the file's MIME type
 *
 * The body streams directly to disk via Bun.write() —
 * no size limits, no encoding overhead.
 *
 * Files are written to `data/sessions/<id>/workspace/<filename>`,
 * which is the agent's sandbox working directory.
 *
 * @param root0 - The request handler params
 * @param root0.params - The route params (includes id)
 * @param root0.request - The incoming request
 * @returns JSON response with upload result
 */
export const POST: RequestHandler = async ({ params, request }) => {
    const validated = await validateUploadRequest(params, request);
    if (validated instanceof Response) return validated;

    const { workDir, filename, filePath, dir } = validated;
    const sandbox = await createFileManagementSandbox(params.id);

    // Strategy: stream to a temp file in .upload-tmp (excluded from
    // snapshots), then mv into place via the sandbox.
    const UPLOAD_TMP_DIR = ".upload-tmp";
    const tmpSuffix = `${String(Date.now())}.${crypto.randomUUID().slice(0, 8)}`;
    const tmpRelPath = join(UPLOAD_TMP_DIR, `${filename}.tmp.${tmpSuffix}`);
    const tmpAbsPath = resolve(workDir, tmpRelPath);
    await mkdir(dirname(tmpAbsPath), { recursive: true });

    try {
        if (request.body) {
            const combined = await readBodyAsBlob(request.body);
            await Bun.write(tmpAbsPath, combined);
        }

        await moveFileToDestination(sandbox, tmpAbsPath, filePath, dir);

        return json({
            success: true,
            filename,
            path: join("/", filename),
        });
    } catch (err) {
        console.error(`[upload] Error uploading file to session ${params.id}:`, err);
        const message = err instanceof Error ? err.message : "Upload failed";
        return internalError(message);
    }
};
