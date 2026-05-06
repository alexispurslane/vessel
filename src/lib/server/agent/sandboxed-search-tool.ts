/**
 * @file Web search tool — performs a web search using an Exa-compatible API.
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

// --- Normalize results ---

function normalizeResults(data: unknown): SearchResult[] {
    if (!data || typeof data !== "object" || !Array.isArray((data as { results?: unknown[] }).results)) {
        return [];
    }

    const rawResults = (data as { results: Array<Record<string, unknown>> }).results;

    return rawResults.map((r) => ({
        url: typeof r.url === "string" ? r.url : String(r.url),
        title: typeof r.title === "string" ? r.title : String(r.title),
        // Exa returns text in `text` or `highlights`; Synthetic returns it in `text`
        text: typeof r.text === "string" ? r.text : r.highlights ? (r.highlights as string[]).join("\n") : undefined,
        publishedDate: typeof r.publishedDate === "string" ? r.publishedDate
            : r.published
                ? typeof r.published === "string" ? r.published : undefined
                : undefined,
    }));
}

// --- Format results as text ---

/**
 * Record search result URLs in the shared tracker so the fetch tool
 * can skip re-fetching pages already seen in search results.
 *
 * @param results - The search results to track
 * @param tracker - The shared Set of URLs, if any
 */
function trackSearchResultUrls(results: SearchResult[], tracker?: Set<string>): void {
    if (!tracker) return;
    for (const r of results) {
        if (r.url) {
            tracker.add(r.url);
        }
    }
}

/**
 * Build the request body for the search API.
 *
 * Targets the intersection of Exa and Synthetic APIs:
 * both accept `query`; Exa additionally supports `contents.text`.
 *
 * @param query - The search query string
 * @param numResults - Optional max results count
 * @param baseUrl - The API base URL (checked for Exa-specific features)
 * @returns The request body object
 */
function buildSearchRequestBody(
    query: string,
    numResults: number | undefined,
    baseUrl: string
): Record<string, unknown> {
    const requestBody: Record<string, unknown> = {
        query,
        numResults: Math.min(numResults ?? 10, 100),
    };

    // For Exa API, request full text of each page.
    if (baseUrl.includes("exa.ai")) {
        requestBody.contents = {
            text: {
                maxCharacters: 8000,
                includeHtmlTags: false,
            },
        };
    }

    return requestBody;
}

/**
 * Throw an error for a non-ok HTTP response, including status and body detail.
 *
 * @param response - The fetch Response object
 */
async function throwForNonOkResponse(response: Response): Promise<void> {
    const statusText = response.statusText || "Unknown error";
    let errorBody = "";
    try {
        errorBody = await response.text();
    } catch {
        // Ignore body read errors
    }
    const errorDetail = errorBody ? `: ${errorBody.slice(0, 500)}` : "";
    throw new Error(
        `Search API returned ${String(response.status)} ${statusText}${errorDetail}`
    );
}

function formatResults(results: SearchResult[], query: string): string {
    if (results.length === 0) {
        return `No results found for: "${query}"`;
    }

    const lines: string[] = [`Search results for: "${query}"`, ""];

    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        lines.push(`## ${String(i + 1)}. ${r.title || "Untitled"}`);
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
 *
 * @param options - Optional configuration (base URL, API key, search result URL tracker)
 * @returns The web search AgentTool
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
                const requestBody = buildSearchRequestBody(query, numResults, baseUrl);

                const response = await fetch(baseUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        // Using Bearer works for both Exa (also supports x-api-key)
                        // and Synthetic (only supports Bearer).
                        Authorization: `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify(requestBody),
                    signal: _signal ?? undefined,
                });

                if (!response.ok) {
                    // Throwing marks the tool call as isError — the correct
                    // semantic for a semantically failed search.
                    await throwForNonOkResponse(response);
                }

                const data: unknown = await response.json();
                const results = normalizeResults(data);
                trackSearchResultUrls(results, searchResultUrls);

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
