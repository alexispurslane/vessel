/**
 * @file Shared types for the Canvas collaborative editing system.
 *
 * These types define the contract between client and server for
 * operational-transform-based real-time file editing.
 */

// --- Canvas tracking ---

/** Entry in a conversation's canvases.json tracking file */
export interface CanvasEntry {
    /** Relative path within the workspace */
    filePath: string;
}

/** Shape of canvases.json on disk */
export interface CanvasesManifest {
    canvases: CanvasEntry[];
}

// --- OT protocol types ---

/** Serialized ChangeSet produced by @codemirror/collab's sendableUpdates / receiveUpdates.
 *  Wraps the ChangeSet JSON with a clientID so that `receiveUpdates` on the
 *  originating client can match its own changes back and confirm them
 *  rather than re-applying them as remote edits.
 *
 *  `changes` matches ChangeSet.toJSON(): an array where each element is
 *  either a number (gap length) or an array [number, ...strings] (change
 *  with the first element being the from position and subsequent elements
 *  being inserted text lines). */
export interface SerializedUpdate {
    /** JSON-serialized ChangeSet (ChangeSet.toJSON() format) */
    changes: (number | (number | string)[])[];
    /** Collaborative client ID from @codemirror/collab */
    clientID: string;
}

/** Base shape shared by all canvas version/update messages */
interface CanvasVersionedMessage {
    /** Document version */
    version: number;
    /** Serialized ChangeSets */
    updates: SerializedUpdate[];
}

/** Client push request: POST /api/sessions/[id]/canvas/[filePath] */
export interface CanvasPushRequest extends CanvasVersionedMessage {}

/** Server response when client pushes changes */
export interface CanvasPushResponse {
    /** New document version after applying changes */
    version: number;
    /** Server changes the client missed (empty when version matched).
     *  The pushing client passes these to receiveUpdates BEFORE its own
     *  updates so the collab layer rebses its unconfirmed entries over them. */
    serverUpdates: SerializedUpdate[];
}

/** Server response when client catches up via GET */
export interface CanvasCatchupResponse extends CanvasVersionedMessage {}

/** SSE payload for canvas_update events */
export interface CanvasUpdateEvent {
    /** The workspace-relative file path */
    filePath: string;
    /** Document version after this update */
    version: number;
    /** The serialized updates */
    updates: SerializedUpdate[];
}

// --- Canvas toggle ---

/** PUT /api/sessions/[id]/canvas request body */
export interface CanvasToggleRequest {
    /** The workspace-relative file path */
    filePath: string;
}

/** PUT /api/sessions/[id]/canvas response */
export interface CanvasToggleResponse {
    /** Whether the file is now a canvas */
    isCanvas: boolean;
    /** Current document version (only meaningful if isCanvas is true) */
    version?: number;
}

/** Agent canvas_edit notification content */
export interface CanvasEditNotification {
    /** The workspace-relative file path that was edited */
    filePath: string;
    /** Word-level diff of what changed */
    diff: WordDiff[];
}

/** A single word-level diff entry */
export interface WordDiff {
    /** The change type */
    type: "added" | "removed" | "unchanged";
    /** The text content */
    value: string;
}
