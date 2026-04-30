/**
 * Source tracker extension for pi-coding-agent.
 *
 * Tracks which sources the agent has consulted (fetched pages and web searches)
 * since the model's last full message to the user. Uses the extension lifecycle
 * events:
 *
 *   - tool_result (toolName === "fetch")    → record the page
 *   - tool_result (toolName === "web_search") → record the search
 *   - turn_end (only when the turn produced visible text) → persist & notify, then clear
 *   - agent_end → final flush (catches the case where the loop ends mid-turn)
 *
 * Persistence: `pi.appendEntry()` writes a `CustomEntry` to the .jsonl session
 * file. These entries are NOT sent to the LLM context window, so they don't
 * waste tokens. On session reload, scan entries for `customType: "fetched_sources"`
 * to reconstruct state.
 *
 * Real-time delivery: `pi.events.emit("fetched_sources", ...)` signals the host
 * app (session-store) via the shared EventBus, which broadcasts an SSE event
 * to the frontend.
 */

import type { ExtensionFactory, TurnEndEvent } from "@mariozechner/pi-coding-agent";
import type { FetchToolDetails } from "../sandboxed-fetch-tool.js";
import type { SearchToolDetails } from "../sandboxed-search-tool.js";
import type { FetchedSource } from "$lib/types.js";
import { log } from "$lib/server/logger.js";

export type { FetchedSource };

/**
 * Check if a turn's assistant message contains visible text content for the
 * user, as opposed to being an intermediate step (just tool calls + thinking).
 * Intermediate turns typically have only a newline or empty text plus tool calls.
 */
function hasVisibleText(message: TurnEndEvent["message"]): boolean {
    if (message.role !== "assistant") return false;

    const content = message.content;
    if (!Array.isArray(content)) return false;

    for (const block of content) {
        if (block.type === "text") {
            const text = block.text?.trim() ?? "";
            // Skip turns that are just a bare newline or empty — those are
            // intermediate "call a tool" turns, not substantive responses.
            if (text.length > 0) return true;
        }
    }
    return false;
}

export const fetchTracker: ExtensionFactory = (pi) => {
    let sources: FetchedSource[] = [];
    let currentTurn = 0;

    pi.on("tool_result", (event) => {
        if (event.isError) return;

        if (event.toolName === "fetch") {
            const details = event.details as FetchToolDetails | undefined;

            // Skip if this was a skipped fetch (URL was already in search results)
            if (details?.wasSearchResult) return;

            if (details?.url) {
                log.debug("fetch-tracker", "Recorded fetch", details.url);
                sources.push({
                    type: "page",
                    url: details.url,
                    title: details.title ?? "",
                    contentLength: details.contentLength ?? 0,
                    truncated: details.truncated ?? false,
                    content: details.content ?? "",
                    turn: currentTurn,
                });
            }
        } else if (event.toolName === "web_search") {
            const details = event.details as SearchToolDetails | undefined;

            if (details?.query) {
                log.debug("fetch-tracker", "Recorded search", details.query);
                sources.push({
                    type: "search",
                    query: details.query,
                    resultCount: details.resultCount ?? 0,
                    results: (details.results ?? []).map((r) => ({
                        url: r.url,
                        title: r.title,
                        text: r.text,
                        publishedDate: r.publishedDate,
                    })),
                    turn: currentTurn,
                });
            }
        }
    });

    const flush = () => {
        if (sources.length === 0) return;

        log.debug("fetch-tracker", `Flushing ${sources.length} sources`);

        // Persist in session file as a CustomEntry — NOT sent to LLM context.
        pi.appendEntry("fetched_sources", sources);

        // Signal the SSE layer outside the extension system via the shared EventBus.
        pi.events.emit("fetched_sources", sources);

        sources = [];
    };

    pi.on("turn_end", (event: TurnEndEvent) => {
        // Only flush when the turn produced visible text for the user.
        // Intermediate turns (tool call + thinking only) should keep
        // accumulating sources until the final response or agent_end.
        const visible = hasVisibleText(event.message);
        log.debug("fetch-tracker", `turn_end, hasVisibleText: ${visible}, accumulated sources: ${sources.length}`);
        if (!visible) return;
        flush();
        currentTurn++;
    });

    pi.on("agent_end", flush);
};
