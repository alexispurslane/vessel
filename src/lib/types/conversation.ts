/**
 * @file Shared conversation types used by both the backend and frontend.
 *
 * Includes search results, bulk actions, and related types.
 */

/** Action types for bulk conversation operations */
export type BulkAction = "archive" | "unarchive" | "delete" | "tag";

/** Per-action result counts returned in the bulk response */
export interface BulkResult {
	action: BulkAction;
	succeeded: number;
	failed: number;
	failures?: Array<{ id: string; error: string }>;
}

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
