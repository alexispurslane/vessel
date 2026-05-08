/**
 * @file Export a conversation as PDF, Markdown, or JSON.
 *
 * GET /api/sessions/[id]/export?format=pdf|markdown|json
 *
 * - **pdf**: Returns a typographically clean PDF document
 * - **markdown**: Returns a clean Markdown file
 * - **json**: Returns the raw session file (pi JSONL format)
 */

import { tryApi, badRequest, notFound } from "$lib/server/api-errors.js";
import { getSessionHistory } from "$lib/server/agent/session-store.js";
import { conversationToMarkdown } from "$lib/server/export/markdown.js";
import { conversationToPdf } from "$lib/server/export/pdf.js";
import type { ExportOptions } from "$lib/server/export/types.js";
import { readFile } from "node:fs/promises";
import { getDb } from "$lib/server/db/index.js";

/**
 * GET /api/sessions/[id]/export?format=pdf|markdown|json
 * Export a conversation in the requested format.
 */
export const GET = tryApi(async ({ params, url }) => {
    const id = params.id;
    if (!id) return badRequest("Missing session id");

    const format = url.searchParams.get("format");
    if (!format || !["pdf", "markdown", "json"].includes(format)) {
        return badRequest("Invalid format. Use: pdf, markdown, or json");
    }

    // Parse export options from query params
    const options: ExportOptions = {
        includeThinking: url.searchParams.get("includeThinking") === "true",
        includeToolCalls: url.searchParams.get("includeToolCalls") === "true",
    };

    // Get conversation metadata for the title
    const db = getDb();
    const row = db
        .query("SELECT title, session_file_path FROM conversations WHERE id = ?")
        .get(id) as { title: string; session_file_path: string } | undefined;

    if (!row) return notFound("Conversation not found");

    if (format === "json") {
        return await exportJson(row.session_file_path, id);
    }

    // For PDF and Markdown, we need the message history
    const history = await getSessionHistory(id);
    const title = row.title || "Untitled Conversation";

    if (format === "markdown") {
        const md = conversationToMarkdown(title, history.messages, options);
        return new Response(md, {
            headers: {
                "Content-Type": "text/markdown; charset=utf-8",
                "Content-Disposition": `attachment; filename="${sanitizeFilename(title)}.md"`,
            },
        });
    }

    if (format === "pdf") {
        const pdfBuffer = await conversationToPdf(title, history.messages, options);
        return new Response(Buffer.from(pdfBuffer), {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${sanitizeFilename(title)}.pdf"`,
            },
        });
    }

    return badRequest("Unsupported format");
});

/**
 * Export the raw session file as JSON (downloading the .jsonl file).
 *
 * @param sessionFilePath - Path to the pi session file
 * @param conversationId - The conversation ID
 * @returns A Response with the raw session file content
 */
async function exportJson(sessionFilePath: string, conversationId: string): Promise<Response> {
    try {
        const content = await readFile(sessionFilePath, "utf-8");
        return new Response(content, {
            headers: {
                "Content-Type": "application/jsonl; charset=utf-8",
                "Content-Disposition": `attachment; filename="${conversationId}.jsonl"`,
            },
        });
    } catch {
        // Session file might not exist yet for new conversations
        return new Response("", {
            headers: {
                "Content-Type": "application/jsonl; charset=utf-8",
                "Content-Disposition": `attachment; filename="${conversationId}.jsonl"`,
            },
        });
    }
}

/**
 * Sanitize a filename by removing characters unsafe for filenames.
 *
 * @param name - The raw filename string
 * @returns A sanitized filename safe for Content-Disposition headers
 */
function sanitizeFilename(name: string): string {
    // Strip unsafe filename characters (<>:"/\|?*) and control characters
    const UNSAFE = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
    const filtered = Array.from(name).filter(ch => !UNSAFE.has(ch) && ch.charCodeAt(0) >= 32).join("");
    return filtered.replace(/\s+/g, " ").trim().slice(0, 100) || "conversation";
}
