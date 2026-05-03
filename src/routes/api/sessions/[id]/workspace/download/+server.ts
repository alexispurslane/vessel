import { tryApi, badRequest, notFound } from "$lib/server/api-errors.js";
import { getSessionWorkDir } from "$lib/server/agent/sandbox-factory.js";
import { sanitizeAndResolvePath } from "$lib/server/fs-security.js";
import { existsSync, statSync, createReadStream } from "fs";
import { basename, extname } from "path";

/**
 * Simple MIME type lookup for common file extensions.
 * Falls back to application/octet-stream for unknown types,
 * which is appropriate for downloads (the browser won't try
 * to display it inline).
 */
const MIME_TYPES: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".xml": "application/xml",
    ".yaml": "application/x-yaml",
    ".yml": "application/x-yaml",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".ts": "application/typescript",
    ".py": "text/x-python",
    ".rs": "text/x-rust",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/**
 * GET /api/sessions/[id]/workspace/download?path=<relative-path>
 *
 * Download a file from the agent's sandbox workspace.
 * Returns the file contents as a binary stream with appropriate
 * Content-Disposition header to trigger a browser download.
 *
 * The workspace directory on disk IS the sandbox filesystem — zerobox
 * enforces access at the OS level, but the actual file bytes are the same
 * whether read through the sandbox or directly. So we read directly from
 * disk for simplicity and correctness with binary files.
 *
 * Security: the resolved path is validated to stay within the workspace.
 */
export const GET = tryApi(({ params, url }) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const id = params.id!;
    const workDir = getSessionWorkDir(id);
    const relativePath = url.searchParams.get("path");

    if (!relativePath || typeof relativePath !== "string") {
        return badRequest("path query parameter is required");
    }

    // Resolve and validate the path stays within the workspace
    let filePath: string;
    try {
        filePath = sanitizeAndResolvePath(workDir, relativePath);
    } catch {
        return badRequest("Invalid file path");
    }

    if (!existsSync(filePath)) {
        return notFound("File not found");
    }

    const stat = statSync(filePath);
    if (!stat.isFile()) {
        return badRequest("Path is not a file");
    }

    const fileName = basename(filePath);
    const ext = extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || "application/octet-stream";

    // Stream the file directly from disk
    const fileStream = createReadStream(filePath);

    // Use RFC 5987 to encode the filename, avoiding header injection
    // from double-quote characters in filenames. The filename* parameter
    // with UTF-8 encoding is supported by all modern browsers.
    const encodedFileName = encodeURIComponent(fileName);

    return new Response(
        new ReadableStream({
            start(controller) {
                fileStream.on("data", (chunk: Buffer) => {
                    controller.enqueue(chunk);
                });
                fileStream.on("end", () => {
                    controller.close();
                });
                fileStream.on("error", (err) => {
                    console.error(`[workspace/download] Error streaming file:`, err);
                    controller.error(err);
                });
            },
            cancel() {
                fileStream.destroy();
            },
        }),
        {
            status: 200,
            headers: {
                "Content-Type": mimeType,
                "Content-Disposition": `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`,
            },
        }
    );
});
