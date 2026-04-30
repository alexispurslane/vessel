/**
 * Web search tool — performs a web search using an Exa-compatible API.
 *
 * Supports both the Exa API (`https://api.exa.ai/search`) and the
 * Synthetic API (`https://api.synthetic.new/v2/search`) for testing.
 * The base URL and API key are provided at tool creation time via options.
 * When settings change in the UI, all active sessions are restarted so
 * they pick up the new values.
 *
 * The request is built to target the intersection of both APIs:
 * - Both accept `query` in the request body
 * - Both return `results[]` with `url`, `title`, `text`, and `published`/`publishedDate`
 * - Exa supports `contents.highlights` which Synthetic gracefully ignores
 *
 * Settings keys:
 * - `search.baseUrl` — the API endpoint (default: `https://api.exa.ai/search`)
 * - `search.apiKey`  — the API key (required)
 *
 * This tool is always active when network access is enabled, just like the
 * fetch tool. It's auto-disabled when network is off.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";

// --- Settings keys ---

export const SEARCH_SETTINGS_KEYS = {
    /** Base URL for the search API (default: "https://api.exa.ai/search") */
    BASE_URL: "search.baseUrl",
    /** API key for the search API (required) */
    API_KEY: "search.apiKey",
};

// --- Schema ---

const searchSchema = Type.Object({
    query: Type.String({
        description: "The search query",
    }),
    numResults: Type.Optional(
        Type.Number({
            description:
                "Maximum number of search results to return (default: 10, max: 100)",
        })
    ),
});

export type SearchToolInput = Static<typeof searchSchema>;

// --- Result types ---

export interface SearchResult {
    url: string;
    title: string;
    text?: string;
    publishedDate?: string;
}

export interface SearchToolDetails {
    /** The search query that was executed. */
    query: string;
    /** Number of results returned. */
    resultCount: number;
    /** The actual search results. */
    results: SearchResult[];
}

// --- API response types ---

/** Shape returned by the Synthetic API */
interface SyntheticSearchResponse {
    results: Array<{
        url: string;
        title: string;
        text?: string;
        published?: string;
    }>;
}

/** Shape returned by the Exa API */
interface ExaSearchResponse {
    requestId?: string;
    results: Array<{
        title?: string;
        url: string;
        publishedDate?: string;
        text?: string;
        highlights?: string[];
        summary?: string;
        author?: string;
    }>;
}

// --- Normalize results ---

function normalizeResults(data: unknown): SearchResult[] {
    if (!data || typeof data !== "object" || !Array.isArray((data as any).results)) {
        return [];
    }

    const rawResults = (data as any).results as Array<Record<string, unknown>>;

    return rawResults.map((r) => ({
        url: String(r.url ?? ""),
        title: String(r.title ?? ""),
        // Exa returns text in `text` or `highlights`; Synthetic returns it in `text`
        text: r.text ? String(r.text) : r.highlights ? (r.highlights as string[]).join("\n") : undefined,
        publishedDate: r.publishedDate
            ? String(r.publishedDate)
            : r.published
                ? String(r.published)
                : undefined,
    }));
}

// --- Format results as text ---

function formatResults(results: SearchResult[], query: string): string {
    if (results.length === 0) {
        return `No results found for: "${query}"`;
    }

    const lines: string[] = [`Search results for: "${query}"`, ""];

    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        lines.push(`## ${i + 1}. ${r.title || "Untitled"}`);
        lines.push(`URL: ${r.url}`);
        if (r.publishedDate) {
            lines.push(`Published: ${r.publishedDate}`);
        }
        if (r.text) {
            lines.push("");
            lines.push(r.text);
        }
        lines.push("");
    }

    return lines.join("\n");
}

// --- Tool options ---

export interface SearchToolOptions {
    /** Base URL for the search API. Defaults to "https://api.exa.ai/search" if not set. */
    baseUrl?: string;
    /** API key for the search API. Required — the tool returns a helpful message if missing. */
    apiKey?: string;
    /**
     * A shared Set shared with the fetch tool to track URLs that appeared in search results.
     * When the fetch tool encounters a URL in this set, it skips the actual fetch and
     * returns a message indicating the page was already seen in search results.
     */
    searchResultUrls?: Set<string>;
}

// --- Tool ---

/**
 * Create the web search tool.
 *
 * Settings (base URL, API key) are provided at creation time. When the user
 * changes settings in the UI, all active sessions are restarted so they
 * pick up the new values.
 */
export function createSearchTool(options?: SearchToolOptions): AgentTool<typeof searchSchema, SearchToolDetails> {
    const baseUrl = options?.baseUrl || "https://api.exa.ai/search";
    const apiKey = options?.apiKey;
    const searchResultUrls = options?.searchResultUrls;

    return {
        name: "web_search",
        label: "web_search",
        description:
            "Search the web for information using a search API. " +
            "Returns a list of results with titles, URLs, and the full text content of each page. " +
            "The page content included in search results is typically complete and high-quality — " +
            "it is usually better and more complete than what you'd get by manually fetching the page. " +
            "Use this tool as your primary way to research topics. Only use the fetch tool as a " +
            "secondary fallback if a search result's page content is missing or clearly incomplete.",
        parameters: searchSchema,

        async execute(
            _toolCallId: string,
            params: SearchToolInput,
            _signal?: AbortSignal
        ): Promise<AgentToolResult<SearchToolDetails>> {
            const { query, numResults } = params;

            if (!apiKey) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Web search is not configured. Please set a search API key in Settings → Search Grounding.",
                        },
                    ],
                    details: { query, resultCount: 0, results: [] },
                };
            }

            try {
                // Build the request body targeting the intersection of Exa and Synthetic APIs.
                // Both accept `query`. Exa supports `contents.highlights` for text extraction;
                // Synthetic ignores unknown fields gracefully.
                const requestBody: Record<string, unknown> = {
                    query,
                    numResults: Math.min(numResults ?? 10, 100),
                };

                // If this looks like an Exa API, request the full text content of each page.
                // Exa's `text` mode returns the full page content as clean markdown — this is
                // typically more complete than what the fetch tool can scrape (which uses
                // happy-dom + defuddle). The model should prefer search result content over
                // fetching individual pages.
                if (baseUrl.includes("exa.ai")) {
                    requestBody.contents = {
                        text: {
                            maxCharacters: 8000,
                            includeHtmlTags: false,
                        },
                    };
                }

                const response = await fetch(baseUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        // Exa supports both x-api-key and Authorization: Bearer.
                        // Synthetic only supports Authorization: Bearer.
                        // Using Bearer works for both.
                        Authorization: `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify(requestBody),
                    signal: _signal ?? undefined,
                });

                if (!response.ok) {
                    const statusText = response.statusText || "Unknown error";
                    let errorBody = "";
                    try {
                        errorBody = await response.text();
                    } catch {
                        // Ignore body read errors
                    }
                    const errorDetail = errorBody ? `: ${errorBody.slice(0, 500)}` : "";
                    // Throwing causes the agent loop to mark the tool call as isError,
                    // which is the correct semantic for a semantically failed search
                    // (mirrors the fetch tool's behavior for HTTP 400+).
                    throw new Error(
                        `Search API returned ${response.status} ${statusText}${errorDetail}`
                    );
                }

                const data: unknown = await response.json();
                const results = normalizeResults(data);

                // Record search result URLs in the shared tracker so the fetch tool
                // can skip re-fetching pages the model already has excerpts from.
                if (searchResultUrls) {
                    for (const r of results) {
                        if (r.url) {
                            searchResultUrls.add(r.url);
                        }
                    }
                }

                const text = formatResults(results, query);

                const textContent: TextContent[] = [
                    { type: "text", text },
                ];

                return {
                    content: textContent,
                    details: {
                        query,
                        resultCount: results.length,
                        results,
                    },
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [
                        { type: "text", text: `Error searching for "${query}": ${message}` },
                    ],
                    details: { query, resultCount: 0, results: [] },
                };
            }
        },
    };
}
