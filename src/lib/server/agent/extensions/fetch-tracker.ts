/**
 * Fetch tracker extension for pi-coding-agent.
 *
 * Tracks which pages the fetch tool has visited since the model's last full
 * message to the user. Uses the extension lifecycle events:
 *
 *   - tool_result (toolName === "fetch") → record the page
 *   - turn_end (only when the turn produced visible text) → persist & notify, then clear
 *   - agent_end → final flush (catches the case where the loop ends mid-turn)
 *
 * Persistence: `pi.appendEntry()` writes a `CustomEntry` to the .jsonl session
 * file. These entries are NOT sent to the LLM context window, so they don't
 * waste tokens. On session reload, scan entries for `customType: "fetched_pages"`
 * to reconstruct state.
 *
 * Real-time delivery: `pi.events.emit("fetched_pages", ...)` signals the host
 * app (session-store) via the shared EventBus, which broadcasts an SSE event
 * to the frontend.
 */

import type { ExtensionFactory, TurnEndEvent } from "@mariozechner/pi-coding-agent";
import type { FetchToolDetails } from "../sandboxed-fetch-tool.js";

export interface FetchedPage {
    url: string;
    title: string;
    contentLength: number;
    truncated: boolean;
}

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
    let fetchedPages: FetchedPage[] = [];

    pi.on("tool_result", (event) => {
        if (event.toolName !== "fetch" || event.isError) return;

        const details = event.details as FetchToolDetails | undefined;

        if (details?.url) {
            console.log("[fetch-tracker] recorded fetch:", details.url);
            fetchedPages.push({
                url: details.url,
                title: details.title ?? "",
                contentLength: details.contentLength ?? 0,
                truncated: details.truncated ?? false,
            });
        }
    });

    const flush = () => {
        if (fetchedPages.length === 0) return;

        console.log("[fetch-tracker] flushing", fetchedPages.length, "pages");

        // Persist in session file as a CustomEntry — NOT sent to LLM context.
        pi.appendEntry("fetched_pages", fetchedPages);

        // Signal the SSE layer outside the extension system via the shared EventBus.
        pi.events.emit("fetched_pages", fetchedPages);

        fetchedPages = [];
    };

    pi.on("turn_end", (event: TurnEndEvent) => {
        // Only flush when the turn produced visible text for the user.
        // Intermediate turns (tool call + thinking only) should keep
        // accumulating pages until the final response or agent_end.
        const visible = hasVisibleText(event.message);
        console.log("[fetch-tracker] turn_end, hasVisibleText:", visible, "accumulated pages:", fetchedPages.length);
        if (!visible) return;
        flush();
    });

    pi.on("agent_end", flush);
};
