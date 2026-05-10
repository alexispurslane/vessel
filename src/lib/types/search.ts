/**
 * @file Shared search result types.
 *
 * Used by both the backend (sandboxed-search-tool) and
 * the frontend (FetchedSource, search results panel).
 */

/** A single search result from a web search */
export interface SearchResultItem {
	url: string;
	title: string;
	text?: string;
	publishedDate?: string;
}
