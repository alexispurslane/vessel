/**
 * @file Conversation listing and full-text search.
 *
 * Queries the conversations DB table and (for search) reads session files
 * via the pi-coding-agent SDK to match against message content.
 */

import { SessionManager } from "@mariozechner/pi-coding-agent";
import { getDb } from "../db/index.js";
import { safeJsonParse, stringArraySchema } from "$lib/utils.js";
import { log } from "$lib/server/logger.js";
import { SESSIONS_DIR } from "./model-registry.js";
import type { ConversationListItem } from "./types.js";

// --- Types ---

/** A single search result with context snippets */
export interface ConversationSearchResult {
    id: string;
    title: string;
    tags: string[];
    archived: boolean;
    updatedAt: string;
    /** Where the match was found */
    matchSource: "title" | "content" | "both";
    /** Context snippets showing the match in surrounding text, with the message ID the match was found in */
    snippets: Array<{ text: string; messageId: string | null }>;
}

/** Row from the conversations table — shared by list and search queries. */
interface ConversationRow {
    id: string;
    title: string;
    tags: string;
    session_file_path: string;
    pinned: number;
    archived: number;
    created_at: string;
    updated_at: string;
}

// --- Constants ---

/** Number of characters of context around a match in a snippet. */
const SNIPPET_RADIUS = 60;
/** Maximum number of snippets to return per conversation. */
const MAX_SNIPPETS_PER_CONVERSATION = 3;

// --- DB query ---

/**
 * Fetch all conversations ordered by most recently updated.
 *
 * @returns All conversation rows from the DB, newest first.
 */
function fetchAllConversationRows(): ConversationRow[] {
    const db = getDb();
    return db
        .query(
            `SELECT id, title, tags, session_file_path, pinned, archived, created_at, updated_at FROM conversations ORDER BY updated_at DESC`
        )
        .all() as ConversationRow[];
}

// --- List ---

/**
 * List all conversations from our DB (for sidebar).
 *
 * @returns Conversation list items for the sidebar.
 */
export function listConversations(): ConversationListItem[] {
    return fetchAllConversationRows().map((row) => ({
        id: row.id,
        title: row.title,
        tags: safeJsonParse(row.tags, stringArraySchema) ?? [],
        pinned: Boolean(row.pinned),
        archived: Boolean(row.archived),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));
}

// --- Search helpers ---

/**
 * Extract text content from a message entry's content field.
 * Handles both string content and content-block arrays.
 *
 * @param content - The message content (string or content-block array).
 * @returns Extracted text, or empty string if no text content found.
 */
function extractTextFromContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .filter((block: Record<string, unknown>) => block.type === "text" && typeof block.text === "string")
            .map((block: Record<string, unknown>) => block.text as string)
            .join("");
    }
    return "";
}

/**
 * Search for a query string in text and return surrounding context snippets.
 *
 * @param text - The text to search within.
 * @param query - The query string to find.
 * @param maxSnippets - Maximum number of snippets to return.
 * @param messageId - Optional message ID to associate with each snippet.
 * @returns Array of context snippets with surrounding text.
 */
function findSnippets(
    text: string,
    query: string,
    maxSnippets: number,
    messageId: string | null = null,
): Array<{ text: string; messageId: string | null }> {
    const snippets: Array<{ text: string; messageId: string | null }> = [];
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let searchFrom = 0;

    while (searchFrom < lowerText.length && snippets.length < maxSnippets) {
        const idx = lowerText.indexOf(lowerQuery, searchFrom);
        if (idx === -1) break;

        const start = Math.max(0, idx - SNIPPET_RADIUS);
        const end = Math.min(text.length, idx + query.length + SNIPPET_RADIUS);
        let snippet = text.slice(start, end).trim();

        // Add ellipsis if truncated
        if (start > 0) snippet = "..." + snippet;
        if (end < text.length) snippet = snippet + "...";

        snippets.push({ text: snippet, messageId });
        searchFrom = idx + query.length;
    }

    return snippets;
}

/**
 * Scan a session's branch entries for messages matching the query and collect snippets.
 *
 * @param branchEntries - Session branch entries to scan.
 * @param query - The original query string (for snippet extraction).
 * @param lowerQuery - Lowercased query (for case-insensitive matching).
 * @param maxSnippets - Maximum number of snippets to collect.
 * @returns Matching snippets from user/assistant messages.
 */
function scanBranchForSnippets(
    branchEntries: import("@mariozechner/pi-coding-agent").SessionEntry[],
    query: string,
    lowerQuery: string,
    maxSnippets: number,
): Array<{ text: string; messageId: string | null }> {
    const snippets: Array<{ text: string; messageId: string | null }> = [];
    for (const entry of branchEntries) {
        if (snippets.length >= maxSnippets) break;
        if (entry.type !== "message") continue;
        const msg = entry.message;
        if (msg.role !== "user" && msg.role !== "assistant") continue;
        const text = extractTextFromContent(msg.content);
        if (text.toLowerCase().includes(lowerQuery)) {
            snippets.push(...findSnippets(text, query, maxSnippets - snippets.length, entry.id));
        }
    }
    return snippets;
}

/**
 * Collect search snippets from a session file's message content.
 * Opens the session via the SDK and scans user/assistant messages for the query.
 *
 * @param sessionFilePath - Path to the session file, or null/undefined.
 * @param query - The original query string (for snippet extraction).
 * @param lowerQuery - Lowercased query (for case-insensitive matching).
 * @param maxSnippets - Maximum number of snippets to return.
 * @returns Matching snippets from the session's messages.
 */
async function collectSnippetsFromSession(
    sessionFilePath: string | null | undefined,
    query: string,
    lowerQuery: string,
    maxSnippets: number,
): Promise<Array<{ text: string; messageId: string | null }>> {
    if (!sessionFilePath || !(await Bun.file(sessionFilePath).exists())) return [];

    try {
        const sessionManager = SessionManager.open(sessionFilePath, SESSIONS_DIR);
        return scanBranchForSnippets(sessionManager.getBranch(), query, lowerQuery, maxSnippets);
    } catch (err) {
        log.debug("session-store", `Failed to search session file ${sessionFilePath}`, err);
        return [];
    }
}

/**
 * Build a ConversationSearchResult for a row that matched the query.
 * Combines title and content snippets, capped at the max.
 *
 * @param row - The matching conversation row from the DB.
 * @param row.id - Conversation ID.
 * @param row.title - Conversation title.
 * @param row.tags - JSON-encoded tags string.
 * @param row.archived - Whether the conversation is archived.
 * @param row.updated_at - Last updated timestamp.
 * @param titleMatch - Whether the title matched the query.
 * @param contentSnippets - Snippets from message content matches.
 * @param query - The search query (for title snippet extraction).
 * @returns A fully populated search result.
 */
function buildSearchResult(
    row: { id: string; title: string; tags: string; archived: number; updated_at: string },
    titleMatch: boolean,
    contentSnippets: Array<{ text: string; messageId: string | null }>,
    query: string,
): ConversationSearchResult {
    const contentMatch = contentSnippets.length > 0;
    const matchSource = titleMatch && contentMatch ? "both" : titleMatch ? "title" : "content";

    // Build snippet list: title snippets (no messageId) then content snippets
    const snippets: Array<{ text: string; messageId: string | null }> = [];
    if (titleMatch) {
        snippets.push(...findSnippets(row.title, query, MAX_SNIPPETS_PER_CONVERSATION, null));
    }
    if (contentMatch) {
        const remaining = MAX_SNIPPETS_PER_CONVERSATION - snippets.length;
        if (remaining > 0) {
            snippets.push(...contentSnippets.slice(0, remaining));
        }
    }

    return {
        id: row.id,
        title: row.title,
        tags: safeJsonParse(row.tags, stringArraySchema) ?? [],
        archived: Boolean(row.archived),
        updatedAt: row.updated_at,
        matchSource,
        snippets,
    };
}

// --- Search ---

/**
 * Full-text search across conversation titles and message content.
 *
 * Fetches all conversations once, then does a single pass checking both
 * title and content for each conversation, marking the match source.
 *
 * @param query - The search query string.
 * @param limit - Maximum number of results to return.
 * @returns Search results with match source and context snippets.
 */
export async function searchConversations(query: string, limit = 20): Promise<ConversationSearchResult[]> {
    const lowerQuery = query.toLowerCase();
    const rows = fetchAllConversationRows();
    const results: ConversationSearchResult[] = [];

    for (const row of rows) {
        if (results.length >= limit) break;

        const titleMatch = row.title.toLowerCase().includes(lowerQuery);
        const contentSnippets = await collectSnippetsFromSession(row.session_file_path, query, lowerQuery, MAX_SNIPPETS_PER_CONVERSATION);

        if (!titleMatch && contentSnippets.length === 0) continue;

        results.push(buildSearchResult(row, titleMatch, contentSnippets, query));
    }

    return results;
}
