# Canvas — Collaborative File Editing

## Concept

Files in the agent's sandbox can be designated as "canvases" — shared collaborative documents edited by both the user and agent, reconciled via CodeMirror 6's built-in operational transforms (`@codemirror/collab`).

## Architecture

The server is the OT authority. It holds the canonical document version and sequence of ChangeSets. All changes flow through it.

```
User edits → POST changes → Server rebases if needed, accepts → SSE broadcast to all
Agent edits → Server creates ChangeSet from tool output → SSE broadcast to all
```

## Protocol

### Client pushes changes

`POST /api/sessions/[id]/canvas/[filePath]`

```json
{ "version": 5, "updates": [/* serialized ChangeSet[] */] }
```

Server response:

- **Version matches**: `{ version: M+1 }` — accepted as-is.
- **Version behind**: Server calls `rebaseUpdates(clientChanges, storedChanges[N+1..M])`, applies result, responds with `{ version: M+1, updates: [/* server changes from N+1 to M */] }`.

Client calls `receiveUpdates(state, updates)` to apply intermediate changes and OT-transform its pending local changes over them. Document converges.

### Server broadcasts changes

SSE event after any accepted change:

```
event: canvas_update
data: { "filePath": "notes.md", "version": 8, "updates": [/* serialized Update[] */] }
```

Clients call `receiveUpdates()` with the updates. The OT transform of pending local changes happens internally.

### Agent edits a canvas file

When the agent's write/edit tools target a canvas file, the server wraps the full-content change as a ChangeSet at the current version, increments the version, and broadcasts via SSE. Agent reads canvas files normally (from disk — server keeps file in sync).

### Reconnection

Client tracks its last synced version. On SSE reconnect, `GET /api/sessions/[id]/canvas/[filePath]?since=N` to catch up on missed updates.

## Canvas Tracking

A file becomes a canvas when the user clicks "edit" on its sandbox file pill. Track which files are canvases per conversation — a simple JSON file in the conversation dir (`canvases.json`) listing file paths. The agent can also designate a canvas via a tool — if the file already exists it's designated as a canvas; if not, the agent creates it and designates it as a canvas in one step.

## Agent Notification

When the user edits a canvas, the server sends a `sendCustomMessage` to the agent session with `customType: "canvas_edit"`, a compact diff-formatted string as content, and `deliverAs: "nextTurn"`. If the agent is currently running, use `triggerTurn: true` so it can react immediately.

### Compact diff format

The notification uses a human-readable diff format instead of JSON to minimize token usage:

```
[CANVAS EDIT NOTIFICATION]

File: notes.md

Edit 1:
...Everything in Land's thought [-begins-]{+originates+} with a problem Kant left behind...

Edit 2:
...His early [-work,-]{+essays,+} collected in *Fanged Noumena*...

---
```

- `[-text-]` = removed, `{+text+}` = added
- ≤40 chars of context on each side — enough to locate, not enough to waste tokens
- One `Edit N:` block per change location
- Bracketed `[CANVAS EDIT NOTIFICATION]` header prevents confusion with user speech
- `---` footer marks the end of the notification

## Frontend

- **Canvas panel**: A collapsible, resizable pane sharing the screen with the conversation (using the existing `ResizablePaneGroup`). Contains a full CodeMirror 6 editor with `@codemirror/collab`.
- **Syntax highlighting**: Language-aware highlighting toggled by the canvas file's extension (trivial via `@codemirror/language-data`'s language descriptions matched to filename).
- **File pills**: Add an edit/pencil icon to sandbox file chips. Clicking it toggles the file as a canvas and opens the canvas editor showing that file. Clicking it again just re-opens it.
- **Push timing**: 200ms debounce after user stops typing, then `sendableUpdates()` → POST.
- **Keymaps**: Emacs (built into CM6) and vim (`@codemirror/vim`) modes. Toggle in the canvas panel header.
- **SSE handling**: On `canvas_update` event, call `receiveUpdates()`.

## Server State

Per active session, in memory:

- Map of canvas filePath → `{ version: number, doc: Text, updates: Update[] }`
- On change: apply to in-memory `doc`, write to sandbox file on disk, broadcast via SSE, notify agent.

Persist updates to disk (append-only log per canvas file) so the server can reconstruct state after restart without requiring client re-push.

## Dependencies

- `@codemirror/collab`

## V2 (not now)

- Vim mode
