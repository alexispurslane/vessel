<script lang="ts">
    /**
     * A CodeMirror 6 collaborative editor for canvas files.
     *
     * Uses @codemirror/collab for operational transform-based
     * real-time collaboration between user and agent.
     *
     * The push/pull cycle works as follows:
     * 1. User edits → CM6 collab extension tracks local changes
     * 2. After 200ms debounce, sendableUpdates() → POST to server
     * 3. Server accepts (or rebases if behind) → SSE broadcasts to all
     * 4. On canvas_update SSE event, receiveUpdates() applies remote changes
     *
     * @param conversationId - The conversation this canvas belongs to
     * @param filePath - The workspace-relative file path
     * @param initialContent - The initial file content
     * @param initialVersion - The initial document version from server
     * @param onregisterReceiver - Callback to register for SSE canvas_update events
     */
    import { onMount, onDestroy } from "svelte";
    import {
        EditorView,
        keymap,
        Decoration,
        type DecorationSet,
        ViewPlugin,
        type ViewUpdate,
        WidgetType,
    } from "@codemirror/view";
    import {
        EditorState,
        StateField,
        StateEffect,
        Compartment,
        type Extension,
        ChangeSet,
    } from "@codemirror/state";
    import { collab, receiveUpdates, sendableUpdates } from "@codemirror/collab";
    import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
    import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
    import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
    import { languages } from "@codemirror/language-data";
    import { indentOnInput, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
    import { tags } from "@lezer/highlight";
    import { pushCanvasChanges } from "$lib/api.js";
    import type { CanvasUpdateEvent, SerializedUpdate } from "$lib/types/canvas.js";

    interface Props {
        /** The conversation this canvas belongs to */
        conversationId: string;
        /** The workspace-relative file path being edited */
        filePath: string;
        /** Initial file content from server */
        initialContent: string;
        /** Initial document version from server */
        initialVersion: number;
        /** Callback to register for receiving SSE canvas_update events */
        onregisterReceiver?: (receiver: (event: CanvasUpdateEvent) => void) => void;
        /** Callback when the document version changes (push or remote update) */
        onversionchange?: (version: number) => void;
    }

    let {
        conversationId,
        filePath,
        initialContent,
        initialVersion,
        onregisterReceiver,
        onversionchange,
    }: Props = $props();

    /** The wrapper div — CodeMirror mounts inside this */
    let wrapperEl: HTMLDivElement | null = $state(null);

    /** The EditorView instance */
    let view: EditorView | null = $state(null);

    /** Current document version (synced with server) */
    let version = $state(initialVersion);

    /** Push debounce timer */
    let pushTimer: ReturnType<typeof setTimeout> | null = null;

    /** Whether we're currently pushing changes to avoid re-entrant pushes */
    let pushing = false;

    /** Whether we're currently applying a remote update (so the dismiss plugin knows not to fire) */
    let processingRemoteUpdate = false;

    /** Language compartment for reconfigurable syntax highlighting */
    const languageCompartment = new Compartment();

    // --- Remote-change pulse-highlight system ---

    /** Duration (ms) of the pulse-highlight animation */
    const PULSE_DURATION_MS = 1800;

    /** Positions of inserted text ranges to highlight */
    interface HighlightRange {
        from: number;
        to: number;
    }

    /** Effect: highlight the given inserted ranges with a pulse animation */
    const highlightChanges = StateEffect.define<HighlightRange[]>({
        map: (ranges, mapping) =>
            ranges
                .map((r) => {
                    const from = mapping.mapPos(r.from, 1);
                    const to = mapping.mapPos(r.to, -1);
                    return from <= to ? { from, to } : null;
                })
                .filter((r): r is HighlightRange => r !== null),
    });

    /** Effect: clear all pulse-highlight decorations */
    const clearHighlights = StateEffect.define<void>();

    // --- Agent cursor system ---

    /**
     * Effect: set the agent cursor position (the exact document position
     * after the last character the AI edited). A yellow cursor widget
     * appears here so the user can see where the agent left off.
     */
    const setAgentCursor = StateEffect.define<number>();

    /** Effect: dismiss the agent cursor */
    const dismissAgentCursor = StateEffect.define<void>();

    /**
     * Inline widget that renders a yellow cursor bar at the exact
     * character position after the agent's last edit.
     */
    class AgentCursorWidget extends WidgetType {
        toDOM(): HTMLElement {
            const span = document.createElement("span");
            span.className = "cm-agent-cursor";
            span.textContent = "\u200B";
            return span;
        }

        ignoreEvent(): boolean {
            return true;
        }
    }

    /**
     * StateField for the agent cursor decoration.
     * On `setAgentCursor`, places a fresh widget at the exact character
     * position; on `dismissAgentCursor` or user edit, removes it.
     */
    const agentCursorField = StateField.define<DecorationSet>({
        create: () => Decoration.none,
        update: (decorations, tr) => {
            let updated = decorations.map(tr.changes);

            for (const effect of tr.effects) {
                if (effect.is(setAgentCursor)) {
                    const pos = effect.value;
                    const widget = Decoration.widget({
                        widget: new AgentCursorWidget(),
                        side: 1,
                    });
                    return Decoration.set([widget.range(pos)]);
                } else if (effect.is(dismissAgentCursor)) {
                    return Decoration.none;
                }
            }

            return updated;
        },
        provide: (f) => EditorView.decorations.from(f),
    });

    /**
     * ViewPlugin that auto-dismisses the agent cursor when the user
     * edits text or moves their cursor to the agent cursor position.
     * Skips dismissal during remote update processing to avoid clearing
     * the cursor that was just set.
     */
    const agentCursorDismissPlugin = ViewPlugin.fromClass(
        class {
            update(update: ViewUpdate) {
                // Skip during remote update processing
                if (processingRemoteUpdate) return;

                const field = update.state.field(agentCursorField, false);
                if (!field || field.size === 0) return;

                // Dismiss if the user made local edits
                if (update.docChanged) {
                    update.view.dispatch({ effects: dismissAgentCursor.of(undefined) });
                    return;
                }

                // Dismiss if the user's cursor reaches the agent cursor position
                if (update.selectionSet) {
                    const mainHead = update.state.selection.main.head;
                    const cursorIter = field.iter();
                    while (cursorIter.value) {
                        if (mainHead === cursorIter.from) {
                            update.view.dispatch({
                                effects: dismissAgentCursor.of(undefined),
                            });
                            return;
                        }
                        cursorIter.next();
                    }
                }
            }
        }
    );

    /** Mark decoration applied to each inserted range */
    const pulseMark = Decoration.mark({
        attributes: {
            style: "background-color: rgba(255, 165, 0, 0.35); border-radius: 2px; transition: background-color 1.8s ease-out",
        },
    });

    /**
     * Extract inserted-text ranges from a ChangeSet.
     *
     * Returns positions in the ChangeSet's output document space,
     * suitable for use as Decoration ranges.
     *
     * @param cs - The ChangeSet to inspect
     * @returns Array of {from, to} for each insertion
     */
    function extractInsertedRanges(cs: ChangeSet): { from: number; to: number }[] {
        const ranges: { from: number; to: number }[] = [];
        try {
            // individual=true avoids coalesced sections spanning unchanged text
            // oxlint-disable-next-line eslint/max-params
            cs.iterChanges((_fromA, _toA, fromB, toB, inserted) => {
                if (inserted.length > 0 && toB > fromB) {
                    ranges.push({ from: fromB, to: toB });
                }
            }, true);
        } catch {
            // Malformed ChangeSet (e.g. collab desync) — skip highlighting
        }
        return ranges;
    }

    /**
     * StateField storing the current set of pulse-highlight decorations.
     *
     * When `highlightChanges` is received, adds mark decorations for each
     * range. When `clearHighlights` is received, removes all decorations.
     * Decorations are automatically re-mapped when the document changes.
     */
    const highlightField = StateField.define<DecorationSet>({
        create: () => Decoration.none,
        update: (decorations, tr) => {
            let updated = decorations.map(tr.changes);

            for (const effect of tr.effects) {
                if (effect.is(highlightChanges)) {
                    const marks = effect.value.map((r) => pulseMark.range(r.from, r.to));
                    updated = updated.update({
                        add: marks,
                        sort: true,
                    });
                } else if (effect.is(clearHighlights)) {
                    return Decoration.none;
                }
            }

            return updated;
        },
        provide: (f) => EditorView.decorations.from(f),
    });

    /**
     * After the pulse animation finishes, clear the decorations so they
     * don't linger in the editor state forever.
     */
    const autoClearPlugin = ViewPlugin.fromClass(
        class {
            /** Timer for the next auto-clear */
            private timer: ReturnType<typeof setTimeout> | null = null;
            /** Latest view reference for the timeout callback */
            private view: EditorView | null = null;

            update(update: ViewUpdate) {
                this.view = update.view;

                const hasHighlights = update.transactions.some((tr) =>
                    tr.effects.some((e) => e.is(highlightChanges))
                );
                if (!hasHighlights) return;

                // Reset the timer on every new highlight batch
                if (this.timer) clearTimeout(this.timer);
                this.timer = setTimeout(() => {
                    if (this.view?.state.field(highlightField, false)?.size) {
                        this.view.dispatch({ effects: clearHighlights.of(undefined) });
                    }
                    this.timer = null;
                }, PULSE_DURATION_MS);
            }

            destroy() {
                this.view = null;
                if (this.timer) clearTimeout(this.timer);
            }
        }
    );

    /**
     * Get the file extension from a path.
     * @param path - The file path
     * @returns The file extension (without dot)
     */
    function getFileExt(path: string): string {
        const parts = path.split("/");
        const filename = parts[parts.length - 1] ?? path;
        const dotIndex = filename.lastIndexOf(".");
        if (dotIndex <= 0) return "";
        return filename.slice(dotIndex + 1);
    }

    /**
     * Resolve the CM6 language extension based on the file extension.
     * Uses @codemirror/language-data's language descriptions.
     *
     * @returns An array of language extensions
     */
    async function resolveLanguageExtensions(): Promise<Extension[]> {
        const ext = getFileExt(filePath);
        try {
            const desc = languages.find((l) => l.extensions.includes(ext));
            if (desc) {
                const langSupport = await desc.load();
                return [langSupport];
            }
        } catch {
            // Language not found — fall back to no highlighting
        }

        // Default to markdown for unknown extensions
        return [markdown({ base: markdownLanguage, codeLanguages: languages })];
    }

    /**
     * Markdown syntax highlighting style (reused from CodeMirrorInput).
     */
    const markdownHighlightStyle = HighlightStyle.define([
        { tag: tags.heading1, fontWeight: "700", fontSize: "1.25em" },
        { tag: tags.heading2, fontWeight: "700", fontSize: "1.1em" },
        { tag: tags.heading3, fontWeight: "600" },
        { tag: tags.heading4, fontWeight: "600" },
        { tag: tags.strong, fontWeight: "700" },
        { tag: tags.emphasis, fontStyle: "italic" },
        { tag: tags.strikethrough, textDecoration: "line-through" },
        { tag: tags.link, color: "var(--color-primary)", textDecoration: "underline" },
        { tag: tags.url, color: "var(--color-muted-foreground)" },
        {
            tag: tags.monospace,
            fontFamily: "var(--font-mono)",
            color: "var(--color-muted-foreground)",
        },
        { tag: tags.quote, color: "var(--color-muted-foreground)" },
        { tag: tags.meta, color: "var(--color-muted-foreground)" },
        { tag: tags.comment, color: "var(--color-muted-foreground)" },
    ]);

    /**
     * CodeMirror theme for the canvas editor.
     * Full-featured editor (unlike the chat input which is minimal).
     */
    const canvasTheme = EditorView.theme({
        "&": {
            height: "100%",
            background: "transparent",
            outline: "none",
        },
        ".cm-gutters": {
            backgroundColor: "var(--color-muted) !important",
            color: "var(--color-muted-foreground)",
            border: "none",
            borderRight: "1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent)",
        },
        ".cm-content": {
            fontFamily: "var(--font-mono)",
            caretColor: "var(--color-foreground)",
        },
        ".cm-cursor": {
            borderLeftWidth: "2px",
            borderLeftColor: "var(--color-foreground)",
        },
        ".cm-scroller": {
            overflow: "auto",
            fontFamily: "var(--font-mono)",
            lineHeight: "1.5",
        },
        ".cm-activeLineGutter": {
            backgroundColor: "color-mix(in srgb, var(--color-accent) 20%, transparent)",
        },
        ".cm-activeLine": {
            backgroundColor: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
        },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
            backgroundColor: "var(--color-accent) !important",
        },
        ".cm-remote-change": {
            animation: "cm-pulse-highlight 1.8s ease-out",
            borderRadius: "2px",
        },
        ".cm-agent-cursor": {
            display: "inline-block",
            width: "2px",
            height: "1.15em",
            backgroundColor: "#facc15",
            borderRadius: "1px",
            verticalAlign: "text-bottom",
        },
        "@keyframes cm-pulse-highlight": {
            "0%": {
                backgroundColor: "color-mix(in srgb, var(--color-primary) 35%, transparent)",
                boxShadow: "0 0 0 2px color-mix(in srgb, var(--color-primary) 25%, transparent)",
            },
            "30%": {
                backgroundColor: "color-mix(in srgb, var(--color-primary) 20%, transparent)",
                boxShadow: "none",
            },
            "100%": {
                backgroundColor: "transparent",
                boxShadow: "none",
            },
        },
    });

    /**
     * Push locally-made changes to the server for OT validation.
     *
     * After the server accepts the changes, immediately calls
     * receiveUpdates to confirm them (clearing sendableUpdates)
     * and apply any server-side rebases. This way the SSE echo-back
     * (which carries the same clientIDs) can be safely skipped.
     */
    async function pushPendingChanges(): Promise<void> {
        if (!view || pushing) return;

        pushing = true;
        try {
            const sendable = sendableUpdates(view.state);
            if (sendable.length === 0) {
                pushing = false;
                return;
            }

            const serializedUpdates: SerializedUpdate[] = sendable.map((u) => ({
                changes: u.changes.toJSON() as (number | (number | string)[])[],
                clientID: u.clientID,
            }));

            const result = await pushCanvasChanges(
                conversationId,
                filePath,
                version,
                serializedUpdates
            );

            // receiveUpdates: server intermediate changes (rebase), then our
            // own pushed changes (confirmed by clientID match).
            const updatesForConfirm: { changes: ChangeSet; clientID: string }[] = [];

            if (result.serverUpdates && result.serverUpdates.length > 0) {
                for (const u of result.serverUpdates) {
                    updatesForConfirm.push({
                        changes: ChangeSet.fromJSON(u.changes),
                        clientID: u.clientID,
                    });
                }
            }

            // Append our own updates so receiveUpdates can confirm them by clientID
            for (const u of sendable) {
                updatesForConfirm.push(u);
            }

            if (updatesForConfirm.length > 0 && view) {
                view.dispatch(receiveUpdates(view.state, updatesForConfirm));
            }

            version = result.version;
            onversionchange?.(version);
        } catch (err) {
            console.error("[canvas] Push failed:", err);
        } finally {
            pushing = false;
        }
    }

    /**
     * Handle a canvas_update SSE event from the server.
     * Called when another client or the agent made changes.
     *
     * Skips events for versions we've already confirmed via a push
     * response (the SSE echo-back) to avoid double-applying our own
     * changes.
     *
     * @param event - The canvas update event
     */
    function handleRemoteUpdate(event: CanvasUpdateEvent): void {
        if (event.filePath !== filePath) return;
        if (!view) return;

        // Skip echo-back: we already confirmed these changes via the
        // POST response's receiveUpdates call.
        if (event.version <= version) return;

        version = event.version;
        onversionchange?.(version);

        // Deserialize remote ChangeSets, preserving the original clientID
        // so receiveUpdates can recognize the originating client's own edits
        const remoteUpdates = event.updates.map((u) => ({
            changes: ChangeSet.fromJSON(u.changes),
            clientID: u.clientID,
        }));

        // Apply remote updates first, then dispatch the highlight effect
        // separately to avoid interfering with collab state tracking.
        // Guard with processingRemoteUpdate so the agent cursor dismiss
        // plugin doesn't fire on these remote-originated doc changes.
        processingRemoteUpdate = true;
        try {
            const tr = receiveUpdates(view.state, remoteUpdates);
            view.dispatch(tr);

            if (tr.changes.empty) return;
            const ranges = extractInsertedRanges(tr.changes);
            if (ranges.length > 0) {
                const lastRange = ranges[ranges.length - 1];
                const agentCursorPos = lastRange.to;
                view.dispatch({
                    effects: [highlightChanges.of(ranges), setAgentCursor.of(agentCursorPos)],
                });
            }
        } finally {
            processingRemoteUpdate = false;
        }
    }

    /**
     * Schedule a push after user stops typing (200ms debounce).
     */
    function schedulePush(): void {
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(() => {
            pushTimer = null;
            void pushPendingChanges();
        }, 200);
    }

    /**
     * Build the initial set of CodeMirror extensions.
     *
     * @param langExtensions - Language-specific extensions (resolved async)
     * @returns Array of CodeMirror extensions
     */
    function buildExtensions(langExtensions: Extension[]): Extension[] {
        return [
            history(),
            ...langExtensions,
            languageCompartment.of([]),
            indentOnInput(),
            highlightSelectionMatches(),
            keymap.of([...historyKeymap, ...defaultKeymap, ...searchKeymap]),
            collab({ startVersion: initialVersion }),
            highlightField,
            autoClearPlugin,
            agentCursorField,
            agentCursorDismissPlugin,
            EditorView.updateListener.of(() => {
                schedulePush();
            }),
            canvasTheme,
            syntaxHighlighting(markdownHighlightStyle),
            EditorView.lineWrapping,
        ];
    }

    // --- Lifecycle ---

    onMount(async () => {
        if (!wrapperEl) return;

        const langExtensions = await resolveLanguageExtensions();

        const state = EditorState.create({
            doc: initialContent,
            extensions: buildExtensions(langExtensions),
        });

        view = new EditorView({
            state,
            parent: wrapperEl,
        });

        // Register to receive SSE canvas_update events
        onregisterReceiver?.(handleRemoteUpdate);
    });

    onDestroy(() => {
        if (pushTimer) clearTimeout(pushTimer);
        view?.destroy();
        view = null;
    });
</script>

<div class="flex flex-col h-full">
    <!-- CodeMirror editor -->
    <div
        bind:this={wrapperEl}
        class="flex-1 min-h-0 overflow-hidden"
        role="textbox"
        aria-multiline="true"
        aria-label="Canvas editor for {filePath}"
    ></div>
</div>
