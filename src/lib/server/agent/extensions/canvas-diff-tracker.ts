/**
 * @file Canvas diff tracker extension for pi-coding-agent.
 *
 * Tracks canvas document versions across agent turns and lazily computes
 * word-level diffs when the agent is next prompted. Instead of sending
 * intermediate change-set diffs on every keystroke (which exposes the
 * model to partial edit states), this extension:
 *
 *   1. On each "agent turn boundary" (turn_end with visible text, or
 *      agent_end), records a snapshot of canvas file → { version, content }
 *      via `pi.appendEntry("canvas_versions", ...)` for persistence.
 *
 *   2. On `session_start`, reconstructs the last-known snapshot from the
 *      most recent `canvas_versions` CustomEntry in the session file, so
 *      the extension works correctly across session reloads.
 *
 *   3. On `before_agent_start`, compares the last-known snapshot with the
 *      current canvas state. For each file that changed, computes a word-
 *      level diff between the stored content and the current content, then
 *      returns a CustomMessage with the formatted diff notification.
 *
 * Key design: snapshots store the actual document content (not just version
 * numbers), so diff computation never needs to reconstruct old document
 * states from ChangeSets (which is fragile after server restarts).
 */

import type {
    ExtensionFactory,
    ExtensionAPI,
    BeforeAgentStartEvent,
    BeforeAgentStartEventResult,
    TurnEndEvent,
    SessionStartEvent,
    ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
    getCanvasVersionSnapshot,
    getCanvasDocContent,
    computeWordDiff,
    formatCanvasEditNotification,
} from "$lib/server/canvas-store.js";
import { log } from "$lib/server/logger.js";

/** Per-file entry in a canvas snapshot */
interface CanvasFileSnapshot {
    /** Document version at the time of the snapshot */
    version: number;
    /** Full document content at the time of the snapshot */
    content: string;
}

/** Shape of a canvas_versions CustomEntry's data field */
type CanvasSnapshot = Record<string, CanvasFileSnapshot>;

/** Mutable state shared across extension event handlers */
interface TrackerState {
    /** Last-known snapshot from the most recent canvas_versions entry */
    lastSnapshot: CanvasSnapshot;
}

/**
 * Scan session entries to find the most recent canvas_versions snapshot.
 *
 * @param entries - The session entries from the session manager
 * @returns The last persisted canvas snapshot, or empty object
 */
function findLastSnapshot(entries: { type: string; customType?: string; data?: unknown }[]): CanvasSnapshot {
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry.type === "custom" && entry.customType === "canvas_versions") {
            const data = entry.data as CanvasSnapshot | undefined;
            if (data && typeof data === "object") return data;
        }
    }
    return {};
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
 * Take a snapshot of all open canvas files for a conversation,
 * capturing both version and content.
 *
 * @param conversationId - The conversation ID
 * @returns Map of filePath → { version, content }
 */
function takeSnapshot(conversationId: string): CanvasSnapshot {
    const snapshot: CanvasSnapshot = {};
    const versions = getCanvasVersionSnapshot(conversationId);

    for (const [filePath, version] of Object.entries(versions)) {
        const content = getCanvasDocContent(conversationId, filePath);
        if (content !== null) {
            snapshot[filePath] = { version, content };
        }
    }
    return snapshot;
}

/**
 * Compute the diff for a single canvas file.
 *
 * @param filePath - The canvas file path
 * @param oldContent - The content the agent last saw
 * @param currentContent - The current content
 * @returns The formatted diff notification, or null if no changes
 */
function computeFileDiff(
    filePath: string,
    oldContent: string,
    currentContent: string
): string | null {
    if (oldContent === currentContent) return null;

    const diff = computeWordDiff(oldContent, currentContent);
    if (diff.every((d) => d.type === "unchanged")) return null;

    return formatCanvasEditNotification(filePath, diff);
}

/**
 * Persist the current canvas snapshot and update tracking state.
 *
 * @param conversationId - The conversation ID
 * @param state - Mutable tracker state
 * @param pi - The extension API for appending entries
 */
function persistSnapshot(
    conversationId: string,
    state: TrackerState,
    pi: ExtensionAPI
): void {
    const snapshot = takeSnapshot(conversationId);
    state.lastSnapshot = snapshot;
    pi.appendEntry("canvas_versions", snapshot);
    const fileCount = Object.keys(snapshot).length;
    log.debug("canvas-diff-tracker", `Persisted snapshot: ${String(fileCount)} files`);
}

/**
 * Reconstruct lastSnapshot from persisted session entries.
 *
 * @param state - Mutable tracker state
 * @param ctx - The extension context with session manager access
 */
function restoreFromEntries(state: TrackerState, ctx: ExtensionContext): void {
    const entries = ctx.sessionManager.getEntries();
    state.lastSnapshot = findLastSnapshot(entries);
    const fileCount = Object.keys(state.lastSnapshot).length;
    log.debug("canvas-diff-tracker", `Restored snapshot from entries: ${String(fileCount)} files`);
}

/**
 * Compute diffs between the last canvas snapshot and current state.
 *
 * @param conversationId - The conversation ID
 * @param state - Mutable tracker state
 * @returns A custom message with the diff notification, or undefined
 */
function computeDiffNotification(
    conversationId: string,
    state: TrackerState
): BeforeAgentStartEventResult | undefined {
    const currentSnapshot = takeSnapshot(conversationId);
    const allFiles = new Set([
        ...Object.keys(currentSnapshot),
        ...Object.keys(state.lastSnapshot),
    ]);

    console.log("[canvas-diff-tracker] computeDiffNotification:", {
        currentFiles: Object.keys(currentSnapshot),
        lastFiles: Object.keys(state.lastSnapshot),
    });

    if (allFiles.size === 0) return undefined;

    const diffs: string[] = [];

    for (const filePath of allFiles) {
        const last = state.lastSnapshot[filePath];
        const current = currentSnapshot[filePath];

        // Same version → definitely no change
        if (last && current && last.version === current.version) continue;

        const oldContent = last?.content ?? "";
        const currentContent = current?.content ?? "";

        console.log(`[canvas-diff-tracker] file=${filePath} lastVersion=${last?.version} currentVersion=${current?.version} oldLen=${oldContent.length} newLen=${currentContent.length}`);

        const fileDiff = computeFileDiff(filePath, oldContent, currentContent);
        if (fileDiff) diffs.push(fileDiff);
    }

    if (diffs.length === 0) {
        console.log("[canvas-diff-tracker] no diffs computed");
        return undefined;
    }

    const notification = diffs.join("\n\n");
    console.log("[canvas-diff-tracker] notification:", notification);
    log.debug("canvas-diff-tracker", `Computed ${String(diffs.length)} file diffs`);

    return {
        message: {
            customType: "canvas_diff",
            content: notification,
            display: false,
        },
    };
}

/**
 * Create a canvas diff tracker extension for a specific conversation.
 *
 * @param conversationId - The conversation ID to track canvas versions for
 * @returns The extension factory
 */
export function createCanvasDiffTracker(conversationId: string): ExtensionFactory {
    return (pi) => {
        const state: TrackerState = { lastSnapshot: {} };

        pi.on("session_start", (_event: SessionStartEvent, ctx: ExtensionContext) => {
            restoreFromEntries(state, ctx);
        });

        pi.on("before_agent_start", async (_event: BeforeAgentStartEvent) => {
            console.log("[canvas-diff-tracker] before_agent_start fired");
            const result = computeDiffNotification(conversationId, state);
            console.log("[canvas-diff-tracker] before_agent_start result:", result ? { customType: result.message?.customType, contentLen: typeof result.message?.content === "string" ? result.message.content.length : "n/a" } : undefined);
            state.lastSnapshot = takeSnapshot(conversationId);
            return result;
        });

        pi.on("turn_end", (event: TurnEndEvent) => {
            if (!hasVisibleText(event.message)) return;
            persistSnapshot(conversationId, state, pi);
        });

        pi.on("agent_end", () => {
            persistSnapshot(conversationId, state, pi);
        });
    };
}
