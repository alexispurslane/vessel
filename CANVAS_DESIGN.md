# Canvas Design

A canvas is a file in the agent's sandbox that both the user and the agent can edit simultaneously, with real-time sync and no locks.

## Architecture

Two layers connected by a synchronization bridge:

1. **CRDT layer (Yjs, server-side only)** — the source of truth for canvas-registered files. Handles concurrent editing at the character level. Only the server maintains a Yjs Doc; the frontend uses CodeMirror's built-in collaborative editing protocol (`@codemirror/collab`) instead of a client-side Yjs Doc.
2. **Sandbox file (on disk)** — a materialization of the CRDT state. The agent's `bash` tool and any external commands operate on this directly.

The bridge between them is transparent to the agent: its existing `read`/`write`/`edit` tools work as before, but when acting on a canvas-registered file, they operate through the CRDT rather than directly on disk.

```
Frontend:
  CodeMirror 6 + @codemirror/collab (push/pull changes, no Yjs Doc)
       ↕ WebSocket (CodeMirror change sets)
Backend:
  Collab authority ↔ Yjs Doc (source of truth) ↔ Bridge
                         ↕ flush            ↕ sync
                   .canvas/ (persist)   Sandbox file (disk)
```

## Why No Client-Side Yjs Doc

Yjs's standard architecture puts a `Y.Doc` on every client, synced via `y-websocket`. This works, but duplicates the CRDT document on the frontend unnecessarily for our use case.

We don't need CRDTs on the client because the client never needs to *merge* concurrent edits locally — it only has one editor (the user). The only concurrent edits come from the agent, and the server's Yjs Doc handles merging those. The client just needs to:
1. Send its edits to the server
2. Receive the merged result back
3. Apply the diff to CodeMirror

CodeMirror 6 ships a built-in collaborative editing package, `@codemirror/collab`, that does exactly this using operational transformation (OT) with a central authority:
- The client pushes `ChangeSet`s (position-based insertions/deletions) along with its last-known version number
- The client pulls remote changes from the authority and applies them locally, rebasing any unconfirmed local changes on top
- The authority (our server) accepts or rebases client updates depending on version match

This eliminates the client-side Yjs Doc entirely. The server translates between the two protocols: CodeMirror `ChangeSet`s from the client become CRDT ops on the server's Yjs Doc, and Yjs Doc changes (from agent edits) become `ChangeSet`s sent back to the client.

## Sync Flow

**User edits flow client → server:**
1. User types in CodeMirror → `@codemirror/collab` captures the edit as a `ChangeSet`
2. Client pushes the `ChangeSet` + its current version to the server, debounced at ~100ms for keystrokes (pushes immediately for discrete actions like paste or autocomplete accept)
3. If the client's version is stale (the agent edited the document since the client's last sync), the server rebases the `ChangeSet` positions through the intervening server-side changes (e.g., if the agent inserted 5 characters before the user's edit, `from: 47` becomes `from: 52`)
4. Server applies the now-positionally-correct `ChangeSet` as CRDT ops on its Yjs Doc (`insert`/`delete` on `Y.Text`)
5. Yjs merges the content with any concurrent agent edits in overlapping regions
6. Server generates a human-readable summary from the `ChangeSet` (e.g., "added a paragraph at line 14, changed 'implementation' to 'architecture' on line 7") and sends it to the agent via `sendCustomMessage` (see challenge 1)
7. Server increments the client's version and acknowledges the push

**Why both rebase and CRDT?** The rebase adjusts *positions* — it fixes the linear character offsets in the `ChangeSet` so they refer to the correct location in the current document. The CRDT handles *content merging* — if the user and agent both edited the same region, Yjs merges their insertions/deletions at the character level. These solve different problems: rebase fixes "where," CRDT fixes "what happens when they overlap." Skipping the rebase would feed the CRDT wrong positions, causing edits to land in the wrong place — the CRDT can't recover from that because a linear position carries no information about which character the client intended.

**Agent edits flow server → client:**
1. Agent's tool emits CRDT ops on the server-side Yjs Doc
2. Server queues the resulting ChangeSets (versioned) for the client
3. Client already receives `tool_execution_end` SSE events for every agent tool call. After each one, the client pulls any queued ChangeSets from its last synced version via a request to the server
4. The server computes the diff between the Yjs Doc state at the client's last synced version and the current state, and converts it to a CodeMirror `ChangeSet` against the client's document version
5. Client rebases any unconfirmed local changes on top of the remote ChangeSets and applies them
6. CodeMirror re-renders with the new content — cursor position is preserved because CodeMirror adjusts cursor positions when applying ChangeSets to the local document (no Yjs awareness protocol needed)

No new SSE event type needed — the client simply knows that a tool call is the only thing that could change the canvas, and it already knows when tool calls finish.

**WebSocket reconnection:** If the WebSocket connection drops, `@codemirror/collab` queues unpushed local changes and retries the push on reconnection. On reconnect, the server accepts the client's last-known version number and rebases all queued changes against the intervening operations — the same flow as normal, just with a potentially larger version gap. The server maintains a version history of up to 1000 versions; if a reconnecting client's version is older than that, the server rejects it with a "full resync" signal, and the client reloads the full document state from the server.

## The Three Design Challenges

### 1. Agent awareness of user edits (no "reread the file" stutter)

The canvas extension uses `sendCustomMessage` to inject diff summaries into the agent's context:

- **Agent is streaming (actively working):** `deliverAs: "steer"` — the diff arrives after the current tool call batch, before the next LLM call. The agent sees user changes before its next tool call on the file.
- **Agent is idle:** `deliverAs: "nextTurn"` — diffs are debounced and coalesced, then queued alongside the next user prompt.
- **Messages are `display: false`** — the agent sees them in context; the user doesn't get chat bubbles about their own edits.

The diff content is derived directly from the ChangeSets the client pushes — no separate diff computation needed. The ChangeSet already describes exactly what changed, so the server translates the full information into a human-readable summary including positions, deletion ranges, and inserted text. For example: "The user edited /workspace/report.md: at line 14, char 47–52, deleted 'impl', inserted 'architecture'; at line 27, char 1–1, inserted 340 chars (new paragraph)." The summary preserves all ChangeSet data so the agent can reason about the scale and location of changes without re-reading the file.

### 2. Concurrent editing (no locks, no clobbering)

Both the user and the agent are first-class CRDT citizens. Yjs merges their edits at the character level.

**Agent's `edit` tool** — maps directly to CRDT ops: find `old_text` in the Yjs document, delete those characters, insert `new_text` at that position.

**Agent's `write` tool** — diff-computed into CRDT ops: compare the agent's desired content against the current CRDT state, compute a word-level diff, apply each hunk as a CRDT delete+insert. Only the changed regions become CRDT operations; the user's concurrent edits in unchanged regions are preserved perfectly. Word-level granularity (rather than line-level) preserves more Yjs item IDs, giving better merge behavior when user and agent edits are nearby but non-overlapping.

**Agent's `read` tool** — returns content from the Yjs document (always the latest merged state), not from disk. The agent never reads stale content.

### 3. Sandbox integration (it's just a file)

The canvas is a real file in the sandbox. The agent's existing tools work transparently through the CRDT bridge. No special `canvas_read`/`canvas_edit` tools needed — only `canvas_create` to opt a file into canvas mode.

**Bash edits** are blocked on canvas files by default. Running `sed -i`, `python script.py` (that writes to a canvas file), or any other bash command that modifies a canvas-registered file will fail with a message explaining that the file is a canvas and cannot be modified via bash. This sidesteps the fundamental problem that bash edits are opaque byte-level changes to disk — the bridge cannot produce fine-grained CRDT ops from them, and a full replace would orphan the user's concurrent edits by destroying the Yjs item IDs they're anchored to.

If the agent needs to run a command that modifies a canvas file (e.g., a formatter), it must explicitly opt out with a flag like `--canvas-override`. This signals awareness that the edit bypasses the CRDT and may conflict with concurrent user edits. When this flag is used, the bridge diffs the disk file against the CRDT state and applies the diff as CRDT ops (same strategy as the `write` tool), but the agent and user should be aware that concurrent edits in changed regions may not merge cleanly.

## Canvas Registry

The set of canvas-registered files lives:
- **In memory** on the `ActiveSession` object (`canvasPaths: Set<string>`) — consulted on every tool call for fast routing.
- **In the SQLite DB** (conversation metadata) — for persistence across server restarts.
- **Yjs document state** persisted to a `.canvas/` directory **outside the sandbox** (not visible to the agent's tools) and loaded on session restore. Persistence happens when a session closes a conversation. The `.canvas/` directory is excluded from all sandbox tool operations so the agent cannot accidentally read, modify, or delete CRDT state.

## Tool Implementation

The existing `createSandboxedWriteOps` / `createSandboxedEditOps` / `createSandboxedReadOps` functions are extended to check the canvas registry. When the target path is a canvas file, operations go through the CRDT layer; otherwise, they use the existing sandbox code unchanged.

## New Tool: `canvas_create`

```typescript
{
  name: "canvas_create",
  description: "Create a canvas file that the user can view and edit live alongside you. " +
    "Use this when you want to collaborate on a document with the user in real-time. " +
    "The file will appear as a canvas in the user's UI, and both you and the user " +
    "can edit it simultaneously. You can still use read/write/edit on the file " +
    "as normal — the canvas just adds real-time sync with the user. " +
    "Bash commands cannot modify canvas files by default; use --canvas-override if needed.",
  parameters: {
    path: { type: "string", description: "Path for the new canvas file (relative to workspace)" },
    content: { type: "string", description: "Initial content for the canvas" },
  }
}
```

The agent doesn't need to know a file is a canvas to work with it — its existing tools work transparently. `canvas_create` is just the opt-in mechanism.

## Frontend

**CodeMirror 6** with `@codemirror/collab` for push/pull sync with the server authority. No Yjs dependency on the client. Supports any file type with syntax highlighting. Not locked to a rich-text document model, which preserves the "any file type" requirement.

The `@codemirror/collab` extension handles local optimistic updates and rebasing — the user's keystrokes are applied immediately to the CodeMirror document, then pushed to the server. Remote changes from the agent are pulled and rebased on top of any unconfirmed local changes.

**Multiple canvas files** are handled as independent CRDT documents. Each canvas file has its own Yjs Doc, version counter, and WebSocket message channel (multiplexed over a single connection). The canvas registry maps file paths to their respective docs.

## Implementation Order

1. Yjs document + bridge (server-side, no UI yet) — core merging logic and CRDT ops for agent tools
2. Canvas-aware sandboxed operations — agent tools go through CRDT for canvas files; bash blocks writes to canvas files by default
3. `canvas_create` tool + canvas extension — agent can create canvases and get notified of user edits
4. Collab authority + WebSocket — server-side `@codemirror/collab` authority that translates between CodeMirror ChangeSets and Yjs CRDT ops
5. CodeMirror 6 canvas editor (frontend) — `@codemirror/collab` + push/pull over WebSocket
