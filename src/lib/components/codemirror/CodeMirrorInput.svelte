<script lang="ts">
    /**
     * A CodeMirror 6 editor that auto-grows with content, like a textarea.
     *
     * The editor starts at a minimum height and expands as the user types,
     * up to a configurable maximum. Beyond the max, content scrolls inside
     * the editor. This is achieved by externally measuring CodeMirror's
     * `contentHeight` and setting the wrapper's height reactively —
     * CodeMirror always sees a definite-height container to fill.
     *
     * @param value - The text content (two-way bindable)
     * @param placeholder - Placeholder text shown when editor is empty
     * @param disabled - Whether the editor is read-only
     * @param minHeight - Minimum height in pixels (default 36, ~1 line)
     * @param maxHeight - Maximum height in pixels (default 200)
     * @param autofocus - Whether to focus the editor on mount
     * @param onchange - Called on every content change with the new text
     * @param onsubmit - Called when the user presses Enter without Shift
     * @param ref - Exposes the EditorView for parent access
     */
    import { onMount, onDestroy } from "svelte";
    import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
    import { EditorState, Compartment, type Extension } from "@codemirror/state";
    import {
        defaultKeymap,
        emacsStyleKeymap,
        history,
        historyKeymap,
        insertNewline,
    } from "@codemirror/commands";
    import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
    import { languages } from "@codemirror/language-data";
    import { indentOnInput, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
    import { tags } from "@lezer/highlight";
    import {
        acceptCompletion,
        autocompletion,
        closeCompletion,
        moveCompletionSelection,
        startCompletion,
        type CompletionContext,
    } from "@codemirror/autocomplete";

    interface Props {
        value?: string;
        placeholder?: string;
        disabled?: boolean;
        minHeight?: number;
        maxHeight?: number;
        /** Whether the editor is in fullscreen mode — fills available parent space instead of auto-growing */
        fullscreen?: boolean;
        autofocus?: boolean;
        /** Workspace file paths to suggest when the user types @ */
        sandboxFiles?: string[];
        onchange?: (value: string) => void;
        onsubmit?: () => void;
        /** Raw paste event — called before CM processes the paste. If preventDefault() is called, CM won't insert text. */
        onpaste?: (e: ClipboardEvent) => void;
        ref?: EditorView | null;
    }

    let {
        value = $bindable(""),
        placeholder = "",
        disabled = false,
        minHeight = 36,
        maxHeight = 200,
        fullscreen = false,
        autofocus = false,
        sandboxFiles = [],
        onchange,
        onsubmit,
        onpaste,
        ref = $bindable<EditorView | null>(null),
    }: Props = $props();

    /** The wrapper div — CodeMirror mounts inside this */
    let wrapperEl: HTMLDivElement | null = $state(null);

    /** The reactive height of the wrapper, derived from content */
    let wrapperHeight: number = $state(24);

    /** Compartments for reconfigurable extensions */
    const readOnlyCompartment = new Compartment();
    const placeholderCompartment = new Compartment();
    const autocompleteCompartment = new Compartment();

    /**
     * Track the editor's content height so the wrapper can size itself.
     * CSS min-height / max-height on the wrapper handle clamping.
     * @param view - The EditorView whose content height to measure
     */
    function syncHeight(view: EditorView) {
        const contentH = view.contentHeight;
        if (contentH !== wrapperHeight) {
            wrapperHeight = contentH;
        }
    }

    /**
     * CodeMirror theme that visually matches textarea.svelte.
     *
     * The outer ChatInput container provides border, background, and ring.
     * This theme makes CM transparent inside that container.
     */
    const inputTheme = EditorView.theme({
        "&": {
            height: "100%",
            background: "transparent",
            outline: "none",
        },
        ".cm-gutters": {
            display: "none",
        },
        ".cm-content": {
            fontFamily: "inherit",
            caretColor: "var(--color-foreground)",
        },
        ".cm-cursor": {
            borderLeftWidth: "2px",
            borderLeftColor: "var(--color-foreground)",
        },
        // Padding on scroller doesn't affect contentHeight
        ".cm-scroller": {
            overflow: "auto",
            fontFamily: "inherit",
            lineHeight: "inherit",
        },
        ".cm-placeholder": {
            color: "var(--color-muted-foreground)",
            fontStyle: "normal",
        },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
            backgroundColor: "var(--color-accent) !important",
        },
        "&.cm-readonly": {
            opacity: "0.5",
            cursor: "not-allowed",
        },
    });

    /**
     * Autocomplete tooltip styling using baseTheme so it overrides
     * CM6's built-in dark theme (which uses baseTheme with &dark).
     * Regular EditorView.theme() generates scoped selectors that lose
     * to baseTheme's &dark specificity.
     *
     * Styles match shadcn dropdown-menu / command conventions.
     */
    const autocompleteBaseTheme = EditorView.baseTheme({
        "&dark .cm-tooltip.cm-tooltip-autocomplete": {
            backgroundColor: "var(--color-popover)",
            color: "var(--color-popover-foreground)",
            borderRadius: "calc(var(--radius) - 2px)",
            boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
            border: "1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent)",
            padding: "4px",
        },
        "&light .cm-tooltip.cm-tooltip-autocomplete": {
            backgroundColor: "var(--color-popover)",
            color: "var(--color-popover-foreground)",
            borderRadius: "calc(var(--radius) - 2px)",
            boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
            border: "1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent)",
            padding: "4px",
        },
        ".cm-tooltip.cm-tooltip-autocomplete > ul": {
            padding: "0",
        },
        ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
            padding: "6px 8px",
            borderRadius: "calc(var(--radius) - 4px)",
            fontSize: "0.875rem",
            lineHeight: "1.25rem",
            cursor: "default",
            display: "flex",
            alignItems: "center",
            gap: "8px",
        },
        ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
            backgroundColor: "var(--color-accent)",
            color: "var(--color-accent-foreground)",
        },
        ".cm-completionLabel": {
            fontFamily: "var(--font-mono)",
            fontSize: "0.875em",
        },
        ".cm-completionIcon-file::before": {
            content: "'📄'",
            fontSize: "0.875em",
        },
        ".cm-completionIcon-file": {
            background: "none",
            width: "auto",
            height: "auto",
            color: "var(--color-muted-foreground)",
        },
    });

    /**
     * Markdown syntax highlighting using HighlightStyle.define.
     *
     * CM6 uses semantic tags, not CSS classes — the .tok-* selectors
     * only work with tagHighlighter, not HighlightStyle.define which
     * generates inline styles. This is the correct approach.
     */
    const markdownHighlightStyle = HighlightStyle.define([
        { tag: tags.heading1, fontWeight: "700", fontSize: "1.25em" },
        { tag: tags.heading2, fontWeight: "700", fontSize: "1.1em" },
        { tag: tags.heading3, fontWeight: "600" },
        { tag: tags.heading4, fontWeight: "600" },
        { tag: tags.heading5, fontWeight: "600" },
        { tag: tags.heading6, fontWeight: "600" },
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
        { tag: tags.processingInstruction, color: "var(--color-muted-foreground)" },
    ]);

    /**
     * Build a completion source that suggests workspace file names
     * when the user types @. Only triggers when @ is at word boundary
     * (not inside email addresses, etc.).
     *
     * @param context - The CM6 completion context
     * @returns Completion result or null if no @ trigger found
     */
    function fileCompletionSource(context: CompletionContext) {
        const match = context.matchBefore(/@[\w.\-/]*/);
        if (!match) return null;

        // Don't trigger in the middle of a word (e.g., email addresses)
        if (
            match.from > 0 &&
            /\w/.test(context.state.doc.sliceString(match.from - 1, match.from))
        ) {
            return null;
        }

        const query = match.text.slice(1).toLowerCase();
        const options = sandboxFiles
            .filter((f) => f.toLowerCase().startsWith(query))
            .map((f) => ({ label: f, type: "file" as const }));

        if (options.length === 0) return null;

        return {
            from: match.from + 1,
            options,
            validFor: /^[\w.\-/]*$/,
        };
    }

    /**
     * Build the autocomplete extension with @-triggered file completions.
     * @returns Autocompletion extension
     */
    function buildAutocomplete(): Extension {
        return autocompletion({
            override: [fileCompletionSource],
            icons: true,
        });
    }

    /**
     * Completion keymap that uses Tab to accept, not Enter.
     * Spreads the navigation keys from the default completionKeymap
     * and overrides Enter/Tab to match the chat-input contract.
     *
     * @returns Keymap extension for completion navigation + acceptance
     */
    function buildCompletionKeymap(): Extension {
        return keymap.of([
            { key: "Tab", run: acceptCompletion, preventDefault: true },
            { key: "Escape", run: closeCompletion },
            { key: "ArrowDown", run: moveCompletionSelection(true) },
            { key: "ArrowUp", run: moveCompletionSelection(false) },
            { key: "PageDown", run: moveCompletionSelection(true, "page") },
            { key: "PageUp", run: moveCompletionSelection(false, "page") },
            { key: "Ctrl-Space", run: startCompletion },
        ]);
    }

    /**
     * Build keybindings: history, default, plus Enter=submit.
     *
     * @returns Keymap extension array
     */
    function buildKeymap(): Extension {
        return keymap.of([
            // Must precede emacsStyleKeymap, which binds
            // Enter → insertNewlineAndIndent (first match wins)
            {
                key: "Enter",
                run: () => {
                    onsubmit?.();
                    return true;
                },
            },
            {
                key: "Shift-Enter",
                run: insertNewline,
            },
            ...emacsStyleKeymap,
            ...historyKeymap,
            ...defaultKeymap,
        ]);
    }

    /**
     * Build the initial set of CodeMirror extensions.
     *
     * CM fills the wrapper (height: 100%). The wrapper's height is set
     * externally by syncHeight based on contentHeight, clamped to
     * [minHeight, maxHeight]. Enter submits; Shift+Enter inserts newline.
     *
     * @returns Array of CodeMirror extensions
     */
    function buildExtensions(): Extension[] {
        return [
            history(),
            markdown({ base: markdownLanguage, codeLanguages: languages }),
            indentOnInput(),
            buildKeymap(),
            buildCompletionKeymap(),
            ...(onpaste
                ? [
                      EditorView.domEventHandlers({
                          paste(e, _view) {
                              onpaste(e);
                          },
                      }),
                  ]
                : []),
            readOnlyCompartment.of(EditorState.readOnly.of(disabled)),
            placeholderCompartment.of(cmPlaceholder(placeholder)),
            autocompleteCompartment.of(buildAutocomplete()),
            // Height sync + value sync
            EditorView.updateListener.of((update) => {
                if (update.docChanged || update.geometryChanged) {
                    syncHeight(update.view);
                }
                if (update.docChanged) {
                    const newText = update.state.doc.toString();
                    if (newText !== value) {
                        value = newText;
                        onchange?.(newText);
                    }
                }
            }),
            inputTheme,
            autocompleteBaseTheme,
            syntaxHighlighting(markdownHighlightStyle),
            EditorView.lineWrapping,
        ];
    }

    onMount(() => {
        if (!wrapperEl) return;

        const view = new EditorView({
            state: EditorState.create({
                doc: value,
                extensions: buildExtensions(),
            }),
            parent: wrapperEl,
        });

        ref = view;

        if (autofocus) {
            view.focus();
        }

        // Initial height sync after mount
        syncHeight(view);
    });

    onDestroy(() => {
        ref?.destroy();
        ref = null;
    });

    // Sync value changes from parent → CodeMirror
    $effect(() => {
        const view = ref;
        if (!view) return;

        const currentDoc = view.state.doc.toString();
        if (currentDoc !== value) {
            view.dispatch({
                changes: { from: 0, to: currentDoc.length, insert: value },
            });
        }
    });

    // Sync disabled state → CodeMirror read-only compartment
    $effect(() => {
        const view = ref;
        if (!view) return;

        view.dispatch({
            effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(disabled)),
        });
    });

    // Sync placeholder → CodeMirror placeholder compartment
    $effect(() => {
        const view = ref;
        if (!view) return;

        view.dispatch({
            effects: placeholderCompartment.reconfigure(cmPlaceholder(placeholder)),
        });
    });

    // Sync sandboxFiles → CodeMirror autocomplete compartment
    $effect(() => {
        const view = ref;
        if (!view) return;

        // Reference sandboxFiles so this effect re-runs when it changes
        void sandboxFiles;

        view.dispatch({
            effects: autocompleteCompartment.reconfigure(buildAutocomplete()),
        });
    });
</script>

<div
    bind:this={wrapperEl}
    class="cm-input-wrapper w-full overflow-hidden {fullscreen ? 'flex-1 min-h-0' : ''}"
    style="min-height: {minHeight}px; max-height: {fullscreen
        ? 'none'
        : `${maxHeight}px`}; {fullscreen ? '' : `height: ${wrapperHeight}px;`}"
    role="textbox"
    aria-multiline="true"
    aria-label={placeholder || "Chat message input"}
    aria-disabled={disabled}
></div>
