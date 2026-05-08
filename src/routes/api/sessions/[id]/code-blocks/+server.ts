/**
 * @file API endpoint to extract code blocks from a message using marked's markdown parser.
 */

import { json } from "@sveltejs/kit";
import { marked } from "marked";
import type { Token, Tokens } from "marked";
import { tryApi, badRequest, notFound } from "$lib/server/api-errors.js";
import { getSessionHistory } from "$lib/server/agent/session-store.js";

/** A single code block extracted from a message */
interface CodeBlock {
    /** The language identifier (e.g. "typescript", "python"), or empty string if none */
    lang: string;
    /** The raw code content (no trailing newline) */
    text: string;
}

/**
 * Recursively walk the marked token tree and collect all fenced code blocks.
 * Skips indented code blocks (codeBlockStyle === "indented") and inline
 * code spans (type === "codespan").
 *
 * @param tokens - The token array from marked.lexer() or a nested tokens property
 * @param blocks - Accumulator for collected code blocks
 */
function collectFencedCodeBlocks(tokens: Token[], blocks: CodeBlock[]): void {
    for (const token of tokens) {
        if (token.type === "code") {
            const codeToken = token as Tokens.Code;
            // Skip indented code blocks — only want fenced ones
            if (codeToken.codeBlockStyle === "indented") continue;
            blocks.push({
                lang: codeToken.lang ?? "",
                text: codeToken.text,
            });
        }
        // Recurse into nested token trees — depth bounded by markdown AST (< 10 levels)
        // oxlint-disable-next-line secure-coding/no-unlimited-resource-allocation
        if ("tokens" in token && Array.isArray(token.tokens)) {
            collectFencedCodeBlocks(token.tokens, blocks);
        }
    }
}

/**
 * Extract all fenced code blocks from markdown content using marked's AST.
 *
 * @param markdown - The raw markdown string to parse
 * @returns Array of fenced code blocks with their language and text
 */
function extractCodeBlocks(markdown: string): CodeBlock[] {
    const tokens = marked.lexer(markdown);
    const blocks: CodeBlock[] = [];
    collectFencedCodeBlocks(tokens, blocks);
    return blocks;
}

/**
 * GET /api/sessions/[id]/code-blocks?messageId=...
 *
 * Parses the markdown content of a specific message using marked
 * and returns all fenced code blocks found.
 *
 * Query params:
 *   messageId (required) — the ID of the message to extract code blocks from
 *
 * Response:
 *   { codeBlocks: Array<{ lang: string, text: string }>, concatenated: string }
 */
export const GET = tryApi(async ({ params, url }) => {
    const id = params.id;
    if (!id) return badRequest("Missing session id");

    const messageId = url.searchParams.get("messageId");
    if (!messageId) return badRequest("Missing messageId query parameter");

    const history = await getSessionHistory(id);
    const message = history.messages.find((m) => m.id === messageId);
    if (!message) return notFound(`Message ${messageId} not found in session ${id}`);

    const codeBlocks = extractCodeBlocks(message.content);
    // Collapse consecutive whitespace-only separated blocks with a single blank line
    const concatenated = codeBlocks.map((b) => b.text).join("\n\n");

    return json({ codeBlocks, concatenated });
});
