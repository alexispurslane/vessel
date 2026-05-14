What's Missing — Organized by Priority

### 🔴 High Priority (Core Chat Interactions — completely untested)

| # | Missing Feature | Notes |
|---|----------------|-------|
| **M1** | **Copy message** | Copy button on user & assistant messages — clipboard assertion |
| **M2** | **Delete message** | Delete button + confirmation dialog; verify message removed + subsequent messages gone |
| **M3** | **Edit user message** | Edit button → text becomes editable → re-send → navigates back + new response |
| **M4** | **Edit assistant message (in-place)** | Edit button → text becomes editable → save → message text updated without re-prompt |
| **M5** | **Regenerate with feedback** | Thumbs-down → feedback popup → type feedback → optionally pick new model → regenerate |
| **M6** | **Copy code block** | Per-code-block copy button |
| **M7** | **Download code block** | Download individual code blocks as files |
| **M8** | **Download all code blocks as zip** | Zip + download all code blocks from a message |
| **M9** | **Error display below input** | Trigger a server error — verify error message appears, then clears on next send |

### 🟠 Medium Priority (Sidebar CRUD & Navigation — heavily used, untested)

| # | Missing Feature | Notes |
|---|----------------|-------|
| **M10** | **Conversation context menu** | Right-click → menu appears with Rename, Tag, Pin, Archive, Delete, etc. |
| **M11** | **Rename conversation** | Context menu → rename → dialog → new title reflected in sidebar + page title |
| **M12** | **Tag conversation** | Context menu → tag → dialog → tag pill appears on conversation |
| **M13** | **Pin/Unpin conversation** | Context menu → pin → moves to pinned section; unpin → moves back |
| **M14** | **Archive/Restore conversation** | Context menu → archive → moves to archived section; restore → moves back |
| **M15** | **Delete conversation** | Context menu → delete → removed from sidebar + workspace optionally deleted |
| **M16** | **Auto-generate title** | Context menu → "Generate Title" → AI titles the conversation |
| **M17** | **Sidebar search** | Search input → results with snippets and tags |
| **M18** | **Draft indicator badge** | Verify badge appears on conversations with unsent drafts |
| **M19** | **Bulk select mode** | Enter select mode → select multiple → bulk archive/tag/delete |
| **M20** | **Sidebar keyboard navigation** | Arrow keys to move focus through conversation items |

### 🟡 Medium Priority (File Attachments & Input — important UX flows)

| # | Missing Feature | Notes |
|---|----------------|-------|
| **M21** | **File attachment via picker** | Click (+) button → file picker → file appears as pending chip |
| **M22** | **Drag-and-drop files** | Drop file onto chat area → pending chip appears |
| **M23** | **Paste images** | Paste image data → pending chip with image preview |
| **M24** | **Pending file chip remove** | Click remove on pending chip → file removed |
| **M25** | **Sandbox file download** | Download button on sandbox file chip (creation is tested, download is not) |
| **M26** | **Input context menu** | Right-click → Cut, Copy, Paste, Clear |
| **M27** | **Fullscreen input mode** | Maximize/minimize the input editor |
| **M28** | **New chat button in input area** | Plus button starts new conversation |

### 🟡 Medium Priority (Side Panel Depth — open/close is tested, content is not)

| # | Missing Feature | Notes |
|---|----------------|-------|
| **M29** | **Security panel: sandbox toggle** | Tri-state (Inherit/On/Off) — verify state persists |
| **M30** | **Security panel: network access toggle** | Tri-state + custom domains allowlist |
| **M31** | **Security panel: custom read/write paths** | Path autocomplete + pill list |
| **M32** | **Agent info panel: system prompt editor** | Edit custom instructions → save → verify persisted |
| **M33** | **Agent info panel: tools tab** | View/configure agent tools |
| **M34** | **History/DAG panel: node navigation** | Click DAG node → navigate to that branch |
| **M35** | **Resizable panes** | Drag handle to resize side panel |

### 🟡 Medium Priority (Fork Completion — hover is tested, action is not)

| # | Missing Feature | Notes |
|---|----------------|-------|
| **M36** | **Fork conversation action** | Click fork indicator → new branched conversation created → appears in sidebar |

### 🟡 Medium Priority (Export Execution — dropdown is tested, download is not)

| # | Missing Feature | Notes |
|---|----------------|-------|
| **M37** | **Export as PDF** | Click PDF menuitem → download triggered |
| **M38** | **Export as Markdown** | Click MD menuitem → download triggered |
| **M39** | **Export as JSON** | Click JSON menuitem → download triggered |
| **M40** | **Export toggle states affect output** | Uncheck "include thinking" → export → verify thinking excluded |

### 🟢 Lower Priority (Home Page, Tags, Settings sub-features, Notifications, etc.)

| # | Missing Feature | Notes |
|---|----------------|-------|
| **M41** | **Home page toggles** | Sandbox on/off, Network on/off, MCP on/off, Agent mode on/off |
| **M42** | **Home page setup incomplete state** | Guidance cards when no providers/models configured |
| **M43** | **Model selector: set conversation default** | Button to save current model as conversation default |
| **M44** | **Model selector: revert to global default** | Button to switch back to global default |
| **M45** | **Tags page** (`/tags/[tag]`) | Entire route untested |
| **M46** | **Keyboard shortcuts dialog** | `⌘K` / `Ctrl+K` opens shortcuts dialog |
| **M47** | **Browser notification toggles** | Notifications on/off, sound, tab title |
| **M48** | **Fetched sources panel** | Sources with OG metadata, click to open page panel |
| **M49** | **Navigate up/down in messages** | Arrow buttons in top bar to scroll between messages |
| **M50** | **Hash-based scroll to message** | URL `#msg-{id}` → scroll + highlight (IDs exist but URL navigation is untested) |
| **M51** | **Mobile sidebar swipe** | Edge-swipe from left opens sidebar |

---

**TL;DR**: The file has solid coverage of the **happy-path chat flow** (sending, streaming, thinking groups, tool calls, draft persistence, side panel toggling, and accessibility). The biggest gaps are:

1. **Message interactions** — copy, delete, edit, regenerate (M1–M8) — these are the most-used chat features after send
2. **Sidebar CRUD** — rename, tag, pin, archive, delete, search (M10–M20) — the sidebar is tested for switching but not for management
3. **File attachments** — picker, drag-and-drop, paste images, pending chips (M21–M27)
4. **Side panel content** — panels open/close but their actual settings/forms are untested (M29–M35)
5. **Fork action + Export execution** — the UI is tested up to the point of clicking, but not the resulting action (M36–M40)
