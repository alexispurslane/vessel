/**
 * @file Server-side canvas state management.
 *
 * Holds in-memory OT state per canvas per conversation, persists
 * updates to append-only log files, and integrates with the
 * session-store for SSE broadcasting and agent notification.
 *
 * The server is the OT authority — it holds the canonical document
 * version and sequence of ChangeSets. All changes flow through it.
 *
 * Canvas state is keyed by conversationId, not sessionId, because
 * multiple sessions can share a conversation and must see the
 * same document state.
 */

import { Text, ChangeSet, type ChangeDesc } from "@codemirror/state";
import { rebaseUpdates, type Update } from "@codemirror/collab";
import { resolve, dirname } from "path";
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { ChatSSEEvent } from "$lib/types.js";
import type {
    SerializedUpdate,
    CanvasUpdateEvent,
    WordDiff,
    CanvasesManifest,
    CanvasEntry,
} from "$lib/types/canvas.js";
import { SESSIONS_DIR } from "$lib/server/data-dir.js";
import { getSessionWorkDir } from "$lib/server/agent/sandbox-factory.js";
import { sanitizeAndResolvePath } from "$lib/server/fs-security.js";
import { log } from "$lib/server/logger.js";

// --- In-memory canvas state ---

/** Per-canvas document state held in memory */
interface CanvasDoc {
    /** Monotonically increasing version counter */
    version: number;
    /** The canonical document text */
    doc: Text;
    /** All updates from version 0 to current, for rebasing and catch-up */
    updates: ChangeSet[];
}

/** Active canvases for a conversation, keyed by workspace-relative filePath */
interface ConversationCanvases {
    canvases: Map<string, CanvasDoc>;
}

/** Map of conversationId → conversation canvases */
const conversationCanvases = new Map<string, ConversationCanvases>();

// --- File path helpers ---

/**
 * Get the directory for canvas logs within a conversation's session dir.
 * @param conversationId - The conversation ID
 * @returns Path to the canvas-logs directory
 */
function canvasLogDir(conversationId: string): string {
    return resolve(SESSIONS_DIR, conversationId, "canvas-logs");
}

/**
 * Get the path to the append-only log for a specific canvas file.
 * Slashes in the filePath are replaced with `__` to avoid directory traversal.
 * @param conversationId - The conversation ID
 * @param filePath - Workspace-relative file path
 * @returns Path to the log file
 */
function canvasLogPath(conversationId: string, filePath: string): string {
    const safeName = filePath.replace(/\//g, "__").replace(/\\/g, "__");
    return resolve(canvasLogDir(conversationId), `${safeName}.jsonl`);
}

/**
 * Get the path to canvases.json for a conversation.
 * @param conversationId - The conversation ID
 * @returns Path to canvases.json
 */
function canvasesJsonPath(conversationId: string): string {
    return resolve(SESSIONS_DIR, conversationId, "canvases.json");
}

/**
 * Get the absolute path to a canvas file on disk.
 * @param conversationId - The conversation ID
 * @param filePath - Workspace-relative file path
 * @returns Absolute path to the file in the workspace
 */
function canvasFilePath(conversationId: string, filePath: string): string {
    const workDir = getSessionWorkDir(conversationId);
    return sanitizeAndResolvePath(workDir, filePath);
}

// --- Serialization ---

/**
 * Serialize a ChangeSet to a JSON-transportable format with a clientID.
 * @param cs - The ChangeSet to serialize
 * @param clientID - The collaborative client ID to carry alongside the changes
 * @returns SerializedUpdate object for network transport
 */
export function serializeChangeSet(cs: ChangeSet, clientID: string = "server"): SerializedUpdate {
    return { changes: cs.toJSON() as (number | (number | string)[])[], clientID };
}

/**
 * Deserialize a serialized update back into a ChangeSet.
 * @param json - The serialized update (uses only the `changes` field)
 * @returns The reconstructed ChangeSet
 */
export function deserializeChangeSet(json: SerializedUpdate): ChangeSet {
    return ChangeSet.fromJSON(json.changes);
}

/**
 * Serialize an array of ChangeSets for transport.
 * @param changes - The ChangeSets to serialize
 * @param clientID - The collaborative client ID (defaults to "server")
 * @returns Array of serialized updates
 */
export function serializeUpdates(changes: ChangeSet[], clientID: string = "server"): SerializedUpdate[] {
    return changes.map((cs) => serializeChangeSet(cs, clientID));
}

/**
 * Deserialize an array of serialized updates into ChangeSets.
 * @param jsonUpdates - The serialized updates
 * @returns Array of reconstructed ChangeSets
 */
export function deserializeUpdates(jsonUpdates: SerializedUpdate[]): ChangeSet[] {
    return jsonUpdates.map((json) => deserializeChangeSet(json));
}

// --- Canvas tracking (canvases.json) ---

/**
 * Read the canvases manifest for a conversation.
 * Returns an empty manifest if the file doesn't exist.
 * @param conversationId - The conversation ID
 * @returns The canvases manifest
 */
export async function readCanvasesManifest(conversationId: string): Promise<CanvasesManifest> {
    const path = canvasesJsonPath(conversationId);
    try {
        const raw = await readFile(path, "utf-8");
        return JSON.parse(raw) as CanvasesManifest;
    } catch {
        return { canvases: [] };
    }
}

/**
 * Write the canvases manifest for a conversation.
 * @param conversationId - The conversation ID
 * @param manifest - The manifest to write
 */
async function writeCanvasesManifest(conversationId: string, manifest: CanvasesManifest): Promise<void> {
    const path = canvasesJsonPath(conversationId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(manifest, null, 2), "utf-8");
}

/**
 * Check if a file is tracked as a canvas.
 * @param conversationId - The conversation ID
 * @param filePath - Workspace-relative file path
 * @returns Whether the file is a canvas
 */
/**
 * Get the current content of an in-memory canvas document.
 * Returns null if no in-memory doc exists for this conversation+path.
 *
 * Used by the sandboxed read tool to serve the authoritative in-memory
 * document instead of hitting disk, avoiding race conditions between
 * user edits and agent reads.
 *
 * @param conversationId - The conversation ID
 * @param filePath - Workspace-relative file path
 * @returns The document text, or null if no in-memory canvas exists
 */
export function getCanvasDocContentIfExists(conversationId: string, filePath: string): string | null {
    const canvases = conversationCanvases.get(conversationId);
    if (!canvases) return null;
    const canvasDoc = canvases.canvases.get(filePath);
    if (!canvasDoc) return null;
    return canvasDoc.doc.toString();
}

export async function isCanvasFile(conversationId: string, filePath: string): Promise<boolean> {
    const manifest = await readCanvasesManifest(conversationId);
    return manifest.canvases.some((c) => c.filePath === filePath);
}

/**
 * List all canvas files for a conversation.
 * @param conversationId - The conversation ID
 * @returns Array of canvas entries
 */
export async function listCanvasFiles(conversationId: string): Promise<CanvasEntry[]> {
    const manifest = await readCanvasesManifest(conversationId);
    return manifest.canvases;
}

/**
 * Toggle a file as a canvas. If not already tracked, adds it.
 * If already tracked, removes it. Returns the new state.
 *
 * @param conversationId - The conversation ID
 * @param filePath - Workspace-relative file path
 * @returns Whether the file is now a canvas
 */
export async function toggleCanvas(conversationId: string, filePath: string): Promise<boolean> {
    const manifest = await readCanvasesManifest(conversationId);
    const existingIndex = manifest.canvases.findIndex((c) => c.filePath === filePath);

    if (existingIndex >= 0) {
        // Remove from tracking
        manifest.canvases.splice(existingIndex, 1);
        await writeCanvasesManifest(conversationId, manifest);

        // Clean up in-memory state
        const canvases = conversationCanvases.get(conversationId);
        if (canvases) {
            canvases.canvases.delete(filePath);
        }

        log.info("canvas-store", `Removed canvas ${filePath} from ${conversationId}`);
        return false;
    }

    // Add to tracking
    manifest.canvases.push({ filePath });
    await writeCanvasesManifest(conversationId, manifest);

    // Initialize in-memory state
    await getOrCreateCanvasDoc(conversationId, filePath);

    log.info("canvas-store", `Added canvas ${filePath} to ${conversationId}`);
    return true;
}

// --- In-memory document state ---

/**
 * Get or create the in-memory document state for a canvas.
 * Reconstructs from disk if not in memory.
 *
 * @param conversationId - The conversation ID
 * @param filePath - Workspace-relative file path
 * @returns The canvas document state
 */
export async function getOrCreateCanvasDoc(conversationId: string, filePath: string): Promise<CanvasDoc> {
    let canvases = conversationCanvases.get(conversationId);
    if (!canvases) {
        canvases = { canvases: new Map() };
        conversationCanvases.set(conversationId, canvases);
    }

    const existing = canvases.canvases.get(filePath);
    if (existing) return existing;

    // Reconstruct from disk
    const doc = await reconstructDoc(conversationId, filePath);
    const updates = await reconstructUpdates(conversationId, filePath);
    const version = updates.length;

    const canvasDoc: CanvasDoc = { version, doc, updates };
    canvases.canvases.set(filePath, canvasDoc);
    log.info("canvas-store", `Reconstructed canvas ${filePath} for ${conversationId}: version=${version}`);
    return canvasDoc;
}

/**
 * Reconstruct the document text from disk.
 * Reads the actual workspace file; if it doesn't exist, starts empty.
 *
 * @param conversationId - The conversation ID
 * @param filePath - Workspace-relative file path
 * @returns The document text
 */
async function reconstructDoc(conversationId: string, filePath: string): Promise<Text> {
    const absPath = canvasFilePath(conversationId, filePath);
    try {
        const content = await readFile(absPath, "utf-8");
        return Text.of(content.split("\n"));
    } catch {
        return Text.of([""]);
    }
}

/**
 * Reconstruct the ChangeSet history from the append-only log.
 *
 * @param conversationId - The conversation ID
 * @param filePath - Workspace-relative file path
 * @returns Array of ChangeSets from version 0 to current
 */
async function reconstructUpdates(conversationId: string, filePath: string): Promise<ChangeSet[]> {
    const logPath = canvasLogPath(conversationId, filePath);

    if (!existsSync(logPath)) {
        return [];
    }

    try {
        const content = await readFile(logPath, "utf-8");
        const lines = content.trim().split("\n").filter((l) => l.length > 0);
        if (lines.length === 0) return [];

        // Each log line is a JSON-serialized ChangeSet (SerializedUpdate).
        const updates: ChangeSet[] = [];

        for (const line of lines) {
            try {
                // Log entries are raw ChangeSet JSON arrays, not SerializedUpdate objects
                const json = JSON.parse(line) as (number | (number | string)[])[];
                const cs = ChangeSet.fromJSON(json);
                updates.push(cs);
            } catch {
                // Corrupt log entry — skip
                log.warn("canvas-store", `Skipping corrupt log entry for ${filePath}`);
            }
        }

        return updates;
    } catch {
        return [];
    }
}

// --- Apply changes ---

/**
 * Apply client-pushed changes to a canvas document.
 * Handles version matching and rebasing per the OT protocol.
 *
 * Returns both the server changes the pushing client missed (for its
 * receiveUpdates catch-up) AND the new changes to broadcast via SSE
 * (with their original clientIDs preserved so the originating client
 * can recognize and confirm its own edits).
 *
 * @param conversationId - The conversation ID
 * @param filePath - Workspace-relative file path
 * @param clientVersion - The client's last synced version
 * @param clientUpdates - The client's serialized changes (with clientIDs)
 * @returns Push response with version, server catch-up updates, and broadcast updates
 */
export async function pushCanvasChanges(
    conversationId: string,
    filePath: string,
    clientVersion: number,
    clientUpdates: SerializedUpdate[]
): Promise<{ version: number; serverUpdates: SerializedUpdate[]; broadcastUpdates: SerializedUpdate[] }> {
    const canvasDoc = await getOrCreateCanvasDoc(conversationId, filePath);

    // Deserialize client changes into ChangeSets
    const clientChanges = deserializeUpdates(clientUpdates);

    // Convert to Update shape for rebaseUpdates compatibility,
    // preserving the original clientID from the serialized payload
    const clientUpdateObjs: Update[] = clientUpdates.map((u, i) => ({
        changes: clientChanges[i],
        clientID: u.clientID,
    }));

    if (clientVersion === canvasDoc.version) {
        // Client is up to date — apply changes directly
        for (const cs of clientChanges) {
            applyChange(canvasDoc, cs);
        }

        // Write to disk
        await syncCanvasToDisk(conversationId, filePath, canvasDoc);
        await persistUpdateLog(conversationId, filePath, clientChanges);

        return {
            version: canvasDoc.version,
            serverUpdates: [],
            broadcastUpdates: clientUpdates,
        };
    }

    // Client is behind — rebase their changes over the server's intermediate changes
    const serverChangesSince = canvasDoc.updates.slice(clientVersion);

    // Convert server changes to ChangeDesc shape for rebaseUpdates
    const serverUpdateDescs: { changes: ChangeDesc; clientID: string }[] = serverChangesSince.map(
        (cs, i) => ({
            changes: cs as unknown as ChangeDesc,
            clientID: `server-${i}`,
        })
    );

    const rebasedUpdates = rebaseUpdates(clientUpdateObjs, serverUpdateDescs);

    // Apply the rebased changes
    for (const update of rebasedUpdates) {
        applyChange(canvasDoc, update.changes);
    }

    // Write to disk
    await syncCanvasToDisk(conversationId, filePath, canvasDoc);
    await persistUpdateLog(
        conversationId,
        filePath,
        rebasedUpdates.map((u) => u.changes)
    );

    // Serialize the rebased updates for broadcast, preserving original clientIDs
    const broadcastUpdates: SerializedUpdate[] = rebasedUpdates.map((u) => ({
        changes: u.changes.toJSON() as (number | (number | string)[])[],
        clientID: u.clientID,
    }));

    return {
        version: canvasDoc.version,
        serverUpdates: serializeUpdates(serverChangesSince),
        broadcastUpdates,
    };
}

/**
 * Apply a full-content agent edit to a canvas.
 * Computes a word-level diff and creates fine-grained ChangeSets
 * that replace only the changed portions, then applies and broadcasts.
 *
 * @param conversationId - The conversation ID
 * @param filePath - Workspace-relative file path
 * @param newContent - The new file content
 * @returns The canvas update event for broadcasting
 */
export async function applyAgentEdit(
    conversationId: string,
    filePath: string,
    newContent: string
): Promise<CanvasUpdateEvent> {
    const canvasDoc = await getOrCreateCanvasDoc(conversationId, filePath);
    const oldDoc = canvasDoc.doc;
    const oldContent = oldDoc.toString();

    // Fast path: identical content — no-op
    if (oldContent === newContent) {
        return {
            filePath,
            version: canvasDoc.version,
            updates: [],
        };
    }

    // Diff the old and new content, then convert to ChangeSets
    const diff = computeWordDiff(oldContent, newContent);
    const changes = diffToChanges(diff);

    // No actual changes after diff (shouldn't happen due to fast-path above)
    if (changes.length === 0) {
        return { filePath, version: canvasDoc.version, updates: [] };
    }

    // Build a single ChangeSet from all the fine-grained changes
    const composed = ChangeSet.of(changes, oldDoc.length);

    applyChange(canvasDoc, composed);

    // The file is already on disk (agent wrote it), so no sync needed
    await persistUpdateLog(conversationId, filePath, [composed]);

    return {
        filePath,
        version: canvasDoc.version,
        updates: [serializeChangeSet(composed, "agent")],
    };
}

/**
 * Convert a word-level diff into an array of ChangeSpec objects
 * against the original document. Adjacent removed/added runs are
 * coalesced into a single replacement; pure additions and pure
 * deletions become their own changes.
 *
 * @param diff - Word-level diff entries
 * @returns Array of change specs suitable for ChangeSet.of()
 */
function diffToChanges(diff: WordDiff[]): { from: number; to: number; insert: string }[] {
    const changes: { from: number; to: number; insert: string }[] = [];
    let oldPos = 0;
    let pendingRemoved = "";
    let pendingAdded = "";
    let removalStart = 0;

    /** Flush any accumulated removal/insertion as a single change */
    function flush() {
        if (pendingRemoved || pendingAdded) {
            changes.push({
                from: removalStart,
                to: removalStart + pendingRemoved.length,
                insert: pendingAdded,
            });
            pendingRemoved = "";
            pendingAdded = "";
        }
    }

    for (const entry of diff) {
        if (entry.type === "unchanged") {
            flush();
            oldPos += entry.value.length;
        } else if (entry.type === "removed") {
            if (!pendingRemoved) removalStart = oldPos;
            pendingRemoved += entry.value;
            oldPos += entry.value.length;
        } else if (entry.type === "added") {
            if (!pendingRemoved && !pendingAdded) removalStart = oldPos;
            pendingAdded += entry.value;
        }
    }
    flush();

    return changes;
}

/**
 * Apply a ChangeSet to the in-memory canvas document state.
 * @param canvasDoc - The canvas document state to update
 * @param cs - The ChangeSet to apply
 */
function applyChange(canvasDoc: CanvasDoc, cs: ChangeSet): void {
    canvasDoc.doc = cs.apply(canvasDoc.doc);
    canvasDoc.updates.push(cs);
    canvasDoc.version++;
}

/**
 * Get updates since a specific version for catch-up requests.
 *
 * @param conversationId - The conversation ID
 * @param filePath - Workspace-relative file path
 * @param sinceVersion - The version to get updates since
 * @returns The updates and current version
 */
export async function getCanvasUpdatesSince(
    conversationId: string,
    filePath: string,
    sinceVersion: number
): Promise<{ version: number; updates: SerializedUpdate[] }> {
    const canvasDoc = await getOrCreateCanvasDoc(conversationId, filePath);

    if (sinceVersion >= canvasDoc.version) {
        return { version: canvasDoc.version, updates: [] };
    }

    const serverUpdates = canvasDoc.updates.slice(sinceVersion);
    return {
        version: canvasDoc.version,
        updates: serializeUpdates(serverUpdates),
    };
}

// --- Version snapshot and content access ---

/**
 * Get a snapshot of current canvas file versions for a conversation.
 * Returns a map of filePath → current version for all open canvases.
 *
 * @param conversationId - The conversation ID
 * @returns Map of workspace-relative file paths to their current version numbers
 */
export function getCanvasVersionSnapshot(conversationId: string): Record<string, number> {
    const canvases = conversationCanvases.get(conversationId);
    if (!canvases) return {};

    const snapshot: Record<string, number> = {};
    for (const [filePath, canvasDoc] of canvases.canvases) {
        snapshot[filePath] = canvasDoc.version;
    }
    return snapshot;
}

/**
 * Get the current content of a canvas file, or null if not loaded.
 *
 * @param conversationId - The conversation ID
 * @param filePath - Workspace-relative file path
 * @returns The current document text, or null
 */
export function getCanvasDocContent(conversationId: string, filePath: string): string | null {
    const canvases = conversationCanvases.get(conversationId);
    if (!canvases) return null;
    const canvasDoc = canvases.canvases.get(filePath);
    if (!canvasDoc) return null;
    return canvasDoc.doc.toString();
}

// --- Disk persistence ---

/**
 * Write the current document to the workspace file on disk.
 * @param conversationId - The conversation ID
 * @param filePath - Workspace-relative file path
 * @param canvasDoc - The canvas document state
 */
async function syncCanvasToDisk(conversationId: string, filePath: string, canvasDoc: CanvasDoc): Promise<void> {
    const absPath = canvasFilePath(conversationId, filePath);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, canvasDoc.doc.toString(), "utf-8");
}

/**
 * Append changes to the update log on disk.
 *
 * @param conversationId - The conversation ID
 * @param filePath - Workspace-relative file path
 * @param changes - The ChangeSets to persist
 */
async function persistUpdateLog(
    conversationId: string,
    filePath: string,
    changes: ChangeSet[],
): Promise<void> {
    if (changes.length === 0) return;

    const logPath = canvasLogPath(conversationId, filePath);
    await mkdir(dirname(logPath), { recursive: true });

    // Log stores raw ChangeSet JSON (no clientID needed for reconstruction)
    const lines = changes.map((cs) => JSON.stringify(cs.toJSON()));
    await appendFile(logPath, lines.join("\n") + "\n", "utf-8");
}

// --- Diff computation ---

/**
 * Compute a word-level diff between old and new document content.
 * Used for canvas_diff agent notifications.
 *
 * @param oldContent - The previous content
 * @param newContent - The new content
 * @returns Array of word-level diff entries
 */
export function computeWordDiff(oldContent: string, newContent: string): WordDiff[] {
    const oldWords = tokenizeWords(oldContent);
    const newWords = tokenizeWords(newContent);

    return diffArrays(oldWords, newWords);
}

/**
 * Tokenize text into words (splitting on whitespace boundaries,
 * but preserving whitespace as separate tokens so the diff is meaningful).
 *
 * @param text - The text to tokenize
 * @returns Array of word/whitespace tokens
 */
function tokenizeWords(text: string): string[] {
    return text.match(/\S+|\s+/g) ?? [];
}

/**
 * Build the LCS dynamic programming table for two arrays.
 * @param oldArr - The old array
 * @param newArr - The new array
 * @returns The LCS table
 */
function buildLcsTable(oldArr: string[], newArr: string[]): number[][] {
    const m = oldArr.length;
    const n = newArr.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldArr[i - 1] === newArr[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    return dp;
}

/**
 * Backtrack through the LCS table to produce word-level diff entries.
 * @param dp - The LCS table
 * @param oldArr - The old array
 * @param newArr - The new array
 * @returns Array of diff entries (in reverse order, needs reversing)
 */
function backtrackLcs(dp: number[][], oldArr: string[], newArr: string[]): WordDiff[] {
    const entries: WordDiff[] = [];
    let i = oldArr.length;
    let j = newArr.length;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldArr[i - 1] === newArr[j - 1]) {
            entries.push({ type: "unchanged", value: oldArr[i - 1] });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            entries.push({ type: "added", value: newArr[j - 1] });
            j--;
        } else {
            entries.push({ type: "removed", value: oldArr[i - 1] });
            i--;
        }
    }
    return entries;
}

/**
 * Simple LCS-based diff of two string arrays.
 * Produces added/removed/unchanged entries.
 *
 * @param oldArr - The old array
 * @param newArr - The new array
 * @returns Array of diff entries
 */
function diffArrays(oldArr: string[], newArr: string[]): WordDiff[] {
    const result: WordDiff[] = [];
    const dp = buildLcsTable(oldArr, newArr);
    const entries = backtrackLcs(dp, oldArr, newArr);

    entries.reverse();

    // Merge consecutive entries of the same type
    for (const entry of entries) {
        if (result.length > 0 && result[result.length - 1].type === entry.type) {
            result[result.length - 1].value += entry.value;
        } else {
            result.push({ ...entry });
        }
    }

    return result;
}

// --- Cleanup ---

/**
 * Clean up in-memory canvas state for a conversation.
 * Called when a conversation is destroyed.
 *
 * @param conversationId - The conversation ID to clean up
 */
export function cleanupCanvasConversation(conversationId: string): void {
    conversationCanvases.delete(conversationId);
}

/**
 * Broadcast a canvas_update event to all SSE subscribers.
 * This function is designed to be called from the API route handlers,
 * which have access to the session-store's broadcast function.
 *
 * @param event - The canvas update event
 * @returns The formatted ChatSSEEvent
 */
export function formatCanvasSSEEvent(event: CanvasUpdateEvent): ChatSSEEvent {
    return {
        event: "canvas_update",
        data: event,
    };
}

/**
 * Maximum context characters to show on each side of a change.
 * Enough to locate the edit, not enough to waste tokens.
 */
const CONTEXT_RADIUS = 40;

/**
 * Gather unchanged context backwards from a position in the diff array.
 * Returns up to CONTEXT_RADIUS chars of preceding unchanged text.
 *
 * @param diff - The word-level diff array
 * @param position - Index to start looking backwards from
 * @returns Up to CONTEXT_RADIUS chars of preceding context
 */
function gatherBeforeContext(diff: WordDiff[], position: number): string {
    let buf = "";
    let idx = position - 1;
    while (idx >= 0 && diff[idx].type === "unchanged") {
        buf = diff[idx].value + buf;
        if (buf.length >= CONTEXT_RADIUS) break;
        idx--;
    }
    return buf.length > CONTEXT_RADIUS ? buf.slice(-CONTEXT_RADIUS) : buf;
}

/**
 * Gather unchanged context forwards from a position in the diff array.
 * Returns up to CONTEXT_RADIUS chars of following unchanged text.
 *
 * @param diff - The word-level diff array
 * @param position - Index to start looking forwards from
 * @returns Up to CONTEXT_RADIUS chars of following context
 */
function gatherAfterContext(diff: WordDiff[], position: number): string {
    let buf = "";
    let idx = position;
    while (idx < diff.length
        && diff[idx].type === "unchanged"
        && buf.length < CONTEXT_RADIUS) {
        buf += diff[idx].value;
        idx++;
    }
    return buf.length > CONTEXT_RADIUS ? buf.slice(0, CONTEXT_RADIUS) : buf;
}

/**
 * Consume a run of consecutive added/removed entries from the diff,
 * starting at `startIdx`. Returns the removed and added text,
 * and the index after the change run.
 *
 * @param diff - The word-level diff array
 * @param startIdx - Index where the change run begins
 * @returns Tuple of [removedText, addedText, nextIdx]
 */
function consumeChangeRun(
    diff: WordDiff[],
    startIdx: number
): [string, string, number] {
    const removedParts: string[] = [];
    const addedParts: string[] = [];
    let i = startIdx;
    while (i < diff.length && diff[i].type !== "unchanged") {
        if (diff[i].type === "removed") {
            removedParts.push(diff[i].value);
        } else {
            addedParts.push(diff[i].value);
        }
        i++;
    }
    return [removedParts.join(""), addedParts.join(""), i];
}

/**
 * Format a single edit line with context and change markers.
 *
 * @param before - Context text before the change
 * @param removed - Text that was removed (empty if pure addition)
 * @param added - Text that was added (empty if pure deletion)
 * @param after - Context text after the change
 * @returns Formatted edit line like `...context[-removed-]{+added+}context...`
 */
function formatEditLine(
    before: string,
    removed: string,
    added: string,
    after: string
): string {
    let line = "..." + before;
    // Diff markers, not XPath
    // oxlint-disable-next-line secure-coding/no-xpath-injection
    if (removed) line += "[-" + removed + "-]";
    // Diff markers, not XPath
    // oxlint-disable-next-line secure-coding/no-xpath-injection
    if (added) line += "{+" + added + "}";
    line += after + "...";
    return line;
}

/**
 * Format a canvas_diff notification for the agent using the compact
 * diff format. Each edit shows ≤40 chars of context before and after
 * the change, with `[-removed-]` and `{+added+}` markers.
 *
 * @param filePath - The file that was edited
 * @param diff - The word-level diff
 * @returns The notification content string
 */
export function formatCanvasEditNotification(filePath: string, diff: WordDiff[]): string {
    const edits: string[] = [];
    let i = 0;

    while (i < diff.length) {
        // Skip unchanged runs — they provide context but aren't edits
        if (diff[i].type === "unchanged") {
            i++;
            continue;
        }

        // Gather context and change run
        const before = gatherBeforeContext(diff, i);
        const [removed, added, nextIdx] = consumeChangeRun(diff, i);
        const after = gatherAfterContext(diff, nextIdx);

        edits.push(formatEditLine(before, removed, added, after));
        i = nextIdx;
    }

    // Assemble the notification in the compact format
    const lines: string[] = ["[CANVAS EDIT NOTIFICATION]", "", `File: ${filePath}`, ""];
    edits.forEach((edit, idx) => {
        lines.push(`Edit ${idx + 1}:`);
        lines.push(edit);
    });
    lines.push("");
    lines.push("---");

    return lines.join("\n");
}
