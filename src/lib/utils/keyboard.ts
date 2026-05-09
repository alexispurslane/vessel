/**
 * @file Keyboard shortcuts utilities — mod key detection, shortcut registration, and event helpers.
 */

/**
 * Returns the platform-appropriate modifier key symbol for display.
 * Uses the Apple command symbol (⌘) on macOS and Ctrl elsewhere.
 * @returns The modifier key symbol string
 */
export function modSymbol(): string {
    return typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
        ? "⌘"
        : "Ctrl";
}

/**
 * Returns the platform-appropriate Alt key symbol for display.
 * Uses the Option symbol (⌥) on macOS and Alt elsewhere.
 * @returns The Alt key symbol string
 */
export function altSymbol(): string {
    return typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
        ? "⌥"
        : "Alt";
}

/**
 * Whether the primary modifier key (Cmd on macOS, Ctrl elsewhere) is held.
 * @param e - A keyboard event to check
 * @returns Whether the platform's primary modifier is active
 */
export function isMod(e: KeyboardEvent): boolean {
    return /Mac|iPod|iPhone|iPad/.test(navigator.userAgent) ? e.metaKey : e.ctrlKey;
}

/** Key combo definition for a keyboard shortcut. */
export interface KeyCombo {
    /** The keyboard key (e.g. "k", "/", "n") */
    key: string;
    /** Whether the platform's primary modifier (Cmd/Ctrl) is required */
    mod?: boolean;
    /** Whether Shift is required */
    shift?: boolean;
    /** Whether Alt/Option is required */
    alt?: boolean;
}

/**
 * Check whether a keyboard event matches a key combo definition.
 * @param e - The keyboard event
 * @param combo - The key combo to match against
 * @returns Whether the event matches the combo
 */
export function matchesCombo(e: KeyboardEvent, combo: KeyCombo): boolean {
    const keyMatch = e.key.toLowerCase() === combo.key.toLowerCase();
    const modMatch = combo.mod ? isMod(e) : !isMod(e);
    const shiftMatch = combo.shift ? e.shiftKey : !e.shiftKey;
    const altMatch = combo.alt ? e.altKey : !e.altKey;
    return keyMatch && modMatch && shiftMatch && altMatch;
}

/** Custom event detail for keyboard shortcut activations. */
export interface ShortcutEventDetail {
    /** The action identifier (e.g. "quick-search", "new-chat") */
    action: string;
}

/** Event type name for keyboard shortcut activations dispatched on `window`. */
export const SHORTCUT_EVENT_TYPE = "vessel-shortcut";

/**
 * Dispatch a keyboard shortcut event on `window`.
 * @param action - The action identifier that was activated
 */
export function dispatchShortcut(action: string): void {
    window.dispatchEvent(new CustomEvent<ShortcutEventDetail>(SHORTCUT_EVENT_TYPE, { detail: { action } }));
}

/** All keyboard shortcuts in the application. */
export const SHORTCUTS: ReadonlyArray<{
    /** Unique action identifier */
    action: string;
    /** Key combo that triggers the action */
    combo: KeyCombo;
    /** Human-readable label */
    label: string;
    /** Human-readable description of what the shortcut does */
    description: string;
}> = [
        { action: "search-conversations", combo: { key: "p", mod: true }, label: `${modSymbol()}P`, description: "Search conversations" },
        { action: "new-chat", combo: { key: "n", alt: true }, label: `${altSymbol()}N`, description: "Start a new chat" },
        { action: "shortcuts-help", combo: { key: "/", mod: true }, label: `${modSymbol()}/`, description: "Show keyboard shortcuts" },
        { action: "copy-conversation", combo: { key: "c", mod: true, shift: true }, label: `${modSymbol()}⇧C`, description: "Copy entire conversation as Markdown" },
        { action: "abort", combo: { key: "Escape" }, label: "Esc", description: "Abort / stop generating" },
    ];

/**
 * Check whether a keyboard event originated inside a CodeMirror editor.
 *
 * CodeMirror uses `div[contenteditable]` rather than `<input>` or
 * `<textarea>`, so the standard `tagName` checks don't catch it. This
 * walks up from the event target looking for the `.cm-editor` root.
 *
 * @param e - A keyboard event
 * @returns Whether the target is inside a CodeMirror editor
 */
export function isInCodeMirror(e: KeyboardEvent): boolean {
    const el = e.target as HTMLElement | null;
    return !!el?.closest(".cm-editor");
}

/**
 * Global keydown handler that checks all registered shortcuts and
 * dispatches a `vessel-shortcut` custom event when one matches.
 * @param e - The keyboard event
 */
export function handleGlobalKeydown(e: KeyboardEvent): void {
    // Skip if user is typing in an input/textarea (except for Escape)
    const tag = (e.target as HTMLElement | null)?.tagName;
    const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    for (const shortcut of SHORTCUTS) {
        if (inInput && shortcut.action !== "abort") continue;
        if (matchesCombo(e, shortcut.combo)) {
            e.preventDefault();
            dispatchShortcut(shortcut.action);
            return;
        }
    }
}
