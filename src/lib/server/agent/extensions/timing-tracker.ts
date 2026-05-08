/**
 * @file Timing tracker extension for pi-coding-agent.
 *
 * Measures TTFT (Time To First Token) and TPS (Tokens Per Second) for each
 * agent turn. Uses the extension lifecycle events:
 *
 *   - turn_start     → record the turn start timestamp
 *   - message_update → detect the first text/thinking token for TTFT
 *   - message_end    → accumulate output token count for TPS
 *   - turn_end       → capture turn end time, persist & notify, then clear
 *   - agent_end      → final flush (catches early exit mid-turn)
 *
 * TTFT is measured from turn_start.timestamp to the first message_update
 * event of the turn (the 'start' event), which fires before any content-
 * specific events like thinking, text, or tool calls.
 *
 * TPS is computed as outputTokens / totalTurnSeconds, where totalTurnSeconds
 * is measured from turn_start to turn_end. If no output tokens were reported,
 * tps is omitted.
 *
 * Persistence: `pi.appendEntry()` writes a `CustomEntry` to the .jsonl session
 * file. These entries are NOT sent to the LLM context window, so they don't
 * waste tokens. On session reload, scan entries for `customType: "turn_timing"`
 * to reconstruct state.
 *
 * Real-time delivery: `pi.events.emit("turn_timing", ...)` signals the host
 * app (session-store) via the shared EventBus, which broadcasts an SSE event
 * to the frontend.
 */

import type {
    ExtensionFactory,
    TurnEndEvent,
} from "@mariozechner/pi-coding-agent";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";
import type { TurnTiming } from "$lib/types.js";
import { log } from "$lib/server/logger.js";

/** Mutable state accumulated across events within a single agent turn. */
interface TurnTimingState {
    turnStartTime: number | null;
    firstTokenTime: number | null;
    turnEndTime: number | null;
    outputTokens: number;
}

/**
 * Check if a turn's assistant message contains visible text content for the
 * user, as opposed to being an intermediate step (just tool calls + thinking).
 *
 * @param message - The turn end event message
 * @returns Whether the message has visible text content
 */
function hasVisibleText(message: TurnEndEvent["message"]): boolean {
    if (message.role !== "assistant") return false;

    const content = message.content;
    if (!Array.isArray(content)) return false;

    for (const block of content) {
        if (block.type === "text") {
            const text = block.text.trim();
            if (text.length > 0) return true;
        }
    }
    return false;
}

/**
 * Build a TurnTiming snapshot from the current per-turn state.
 *
 * @param state - The accumulated turn timing state
 * @param turn - The zero-based turn index
 * @returns The computed TurnTiming, or null if no turn was active
 */
function buildTurnTiming(state: TurnTimingState, turn: number): TurnTiming | null {
    if (state.turnStartTime === null) return null;

    const ttftMs = state.firstTokenTime !== null
        ? state.firstTokenTime - state.turnStartTime
        : null;

    const totalTurnMs = state.turnEndTime !== null
        ? state.turnEndTime - state.turnStartTime
        : null;

    const tps = totalTurnMs !== null && totalTurnMs > 0 && state.outputTokens > 0
        ? state.outputTokens / (totalTurnMs / 1000)
        : null;

    return { turn, ttftMs, tps, outputTokens: state.outputTokens, totalTurnMs };
}

/**
 * Extension factory that tracks TTFT and TPS for agent turns.
 *
 * @param pi - The pi extension API
 * @returns The extension lifecycle handlers
 */
export const timingTracker: ExtensionFactory = (pi) => {
    const state: TurnTimingState = {
        turnStartTime: null,
        firstTokenTime: null,
        turnEndTime: null,
        outputTokens: 0,
    };
    let currentTurn = 0;

    /**
     * Reset per-turn state back to idle.
     * @returns {void}
     */
    const resetState = () => {
        state.turnStartTime = null;
        state.firstTokenTime = null;
        state.turnEndTime = null;
        state.outputTokens = 0;
    };

    pi.on("turn_start", (event) => {
        resetState();
        state.turnStartTime = event.timestamp;
        log.debug("timing-tracker", `turn_start: turnIndex=${String(event.turnIndex)}, timestamp=${String(event.timestamp)}`);
    });

    pi.on("message_update", (event: { message: unknown; assistantMessageEvent: AssistantMessageEvent }) => {
        // Capture TTFT on the first message_update regardless of event type.
        // The 'start' event fires before any content (thinking, text, tool calls).
        if (state.firstTokenTime !== null) return;
        if (state.turnStartTime === null) return;

        state.firstTokenTime = Date.now();
        const ttft = state.firstTokenTime - state.turnStartTime;
        log.debug("timing-tracker", `First response event (${event.assistantMessageEvent.type}): TTFT=${String(ttft)}ms`);
    });

    pi.on("message_end", (event) => {
        if (event.message.role !== "assistant") return;
        if (event.message.usage) {
            // Accumulate across multiple LLM calls within a single turn
            state.outputTokens += event.message.usage.output;
        }
    });

    /**
     * Flush timing data for the current turn and broadcast via SSE.
     * @returns {void}
     */
    const flush = () => {
        const timing = buildTurnTiming(state, currentTurn);
        if (!timing) return;

        log.debug("timing-tracker", `Flushing turn_timing: turn=${String(currentTurn)}, ttftMs=${String(timing.ttftMs)}, tps=${timing.tps?.toFixed(1) ?? "n/a"}, outputTokens=${String(timing.outputTokens)}, totalTurnMs=${String(timing.totalTurnMs)}`);
        pi.appendEntry("turn_timing", timing);
        pi.events.emit("turn_timing", timing);
        resetState();
    };

    pi.on("turn_end", (event: TurnEndEvent) => {
        state.turnEndTime = Date.now();
        const visible = hasVisibleText(event.message);
        log.debug("timing-tracker", `turn_end: hasVisibleText=${String(visible)}, turnIndex=${String(event.turnIndex)}`);
        if (!visible) return;
        flush();
        currentTurn++;
    });

    pi.on("agent_end", flush);
};
