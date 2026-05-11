/**
 * @file Stub for `@mariozechner/pi-tui` (Terminal UI library).
 *
 * pi-tui provides terminal rendering, keyboard handling, and image support
 * for the pi-coding-agent CLI. The web app never uses any of this, but
 * pi-coding-agent's dist bundle and pi-mcp-adapter reference pi-tui
 * utilities from shared code paths.
 *
 * This stub replaces the entire ~2.4MB pi-tui package (and its koffi FFI
 * dependency) with no-op implementations during the Vite SSR build.
 * Components are replaced with empty class stubs, utility functions
 * return sensible defaults, and the wildcard import (`* as X`) returns
 * an empty object.
 *
 * @see vite.config.ts — the resolve.alias that maps pi-tui to this stub
 */

// --- Utility functions (used by pi-coding-agent and pi-mcp-adapter) ---

/**
 * No-op grapheme segmenter.
 *
 * @returns A basic Intl.Segmenter instance
 */
export function getSegmenter(): Intl.Segmenter {
    return new Intl.Segmenter(undefined, { granularity: "grapheme" });
}

/**
 * Stub: reports width as the string length (ASCII approximation).
 *
 * @param str - Input string
 * @returns Approximate width
 */
export function visibleWidth(str: string): number {
    return str.length;
}

/**
 * Stub: truncates by character count instead of terminal columns.
 *
 * @param text - Text to truncate
 * @param maxWidth - Maximum character width
 * @returns Truncated text and its width
 */
export function truncateFragmentToWidth(
    text: string,
    maxWidth: number,
): { text: string; width: number } {
    const truncated = text.slice(0, maxWidth);
    return { text: truncated, width: truncated.length };
}

/**
 * Stub: truncates by character count instead of terminal columns.
 *
 * @param text - Text to truncate
 * @param maxWidth - Maximum character width
 * @returns Truncated text
 */
export function truncateToWidth(text: string, maxWidth: number): string {
    return text.slice(0, maxWidth);
}

// --- Keyboard utilities ---

/** Stub key event. */
export const Key = {};
/** Stub key ID type. */
export type KeyId = string;

/**
 * Stub: never matches keys.
 *
 * @returns false
 */
export function matchesKey(): boolean {
    return false;
}

/**
 * Stub: no-op key parser.
 *
 * @returns null
 */
export function parseKey(): null {
    return null;
}

/**
 * Stub: always false.
 *
 * @returns false
 */
export function isKeyRelease(): boolean {
    return false;
}

/**
 * Stub: always false.
 *
 * @returns false
 */
export function isKeyRepeat(): boolean {
    return false;
}

/**
 * Stub: always false.
 *
 * @returns false
 */
export function isKittyProtocolActive(): boolean {
    return false;
}

/**
 * Stub: no-op.
 *
 * @returns void
 */
export function setKittyProtocolActive(): void {}

/**
 * Stub: no-op passthrough.
 *
 * @param s - Input string
 * @returns The input string unchanged
 */
export function decodeKittyPrintable(s: string): string {
    return s;
}

// --- Keybindings ---

/** Stub keybindings config. */
export const TUI_KEYBINDINGS = {};

/** Stub keybindings manager. */
export class KeybindingsManager {
    static create(): KeybindingsManager {
        return new KeybindingsManager();
    }
}

/**
 * Stub: returns empty config.
 *
 * @returns Empty keybindings record
 */
export function getKeybindings(): Record<string, unknown> {
    return {};
}

/**
 * Stub: no-op.
 *
 * @returns void
 */
export function setKeybindings(): void {}

// --- Fuzzy matching ---

/**
 * Stub: no fuzzy matching.
 *
 * @returns empty array
 */
export function fuzzyFilter(): unknown[] {
    return [];
}

/**
 * Stub: no fuzzy matching.
 *
 * @returns false
 */
export function fuzzyMatch(): boolean {
    return false;
}

// --- Terminal image support ---

/**
 * Stub capabilities.
 *
 * @returns Empty capabilities record
 */
export function getCapabilities(): Record<string, unknown> {
    return {};
}

/**
 * Stub: no-op.
 *
 * @returns void
 */
export function setCapabilities(): void {}

/**
 * Stub: reset cache.
 *
 * @returns void
 */
export function resetCapabilitiesCache(): void {}

/**
 * Stub: no-op.
 *
 * @returns Empty capabilities record
 */
export function detectCapabilities(): Record<string, unknown> {
    return {};
}

/**
 * Stub: no image dimensions.
 *
 * @returns null
 */
export function getImageDimensions(): null {
    return null;
}

/**
 * Stub: no dimensions.
 *
 * @returns null
 */
export function getPngDimensions(): null {
    return null;
}

/**
 * Stub: no dimensions.
 *
 * @returns null
 */
export function getJpegDimensions(): null {
    return null;
}

/**
 * Stub: no dimensions.
 *
 * @returns null
 */
export function getWebpDimensions(): null {
    return null;
}

/**
 * Stub: no dimensions.
 *
 * @returns null
 */
export function getGifDimensions(): null {
    return null;
}

/**
 * Stub: no cell dimensions.
 *
 * @returns null
 */
export function getCellDimensions(): null {
    return null;
}

/**
 * Stub: no-op.
 *
 * @returns void
 */
export function setCellDimensions(): void {}

/**
 * Stub: no-op.
 *
 * @returns 0
 */
export function calculateImageRows(): number {
    return 0;
}

/**
 * Stub: no image ID.
 *
 * @returns Empty string
 */
export function allocateImageId(): string {
    return "";
}

/**
 * Stub: no-op.
 *
 * @returns void
 */
export function deleteKittyImage(): void {}

/**
 * Stub: no-op.
 *
 * @returns void
 */
export function deleteAllKittyImages(): void {}

/**
 * Stub: empty string.
 *
 * @returns Empty string
 */
export function encodeKitty(): string {
    return "";
}

/**
 * Stub: empty string.
 *
 * @returns Empty string
 */
export function encodeITerm2(): string {
    return "";
}

/**
 * Stub: empty string.
 *
 * @returns Empty string
 */
export function hyperlink(): string {
    return "";
}

/**
 * Stub: no fallback.
 *
 * @returns Empty string
 */
export function imageFallback(): string {
    return "";
}

/**
 * Stub: no-op.
 *
 * @returns Empty string
 */
export function renderImage(): string {
    return "";
}

// --- Stdin buffer ---

/** Stub stdin buffer. */
export class StdinBuffer {}

// --- TUI Components ---
// These are only used by the interactive CLI mode (never in the web app).
// Provide empty class stubs so imports resolve without errors.

/** Stub component base. */
export class Container {
    addChild(): void {}
    removeChild(): void {}
    setFocus(): void {}
}

/**
 * Stub focusable check.
 *
 * @returns false
 */
export function isFocusable(): boolean {
    return false;
}

/** Stub cursor marker. */
export const CURSOR_MARKER = "";

/** Stub TUI class. */
export class TUI {
    start(): void {}
    stop(): void {}
    addChild(): void {}
    setFocus(): void {}
    setClearOnShrink(): void {}
}

/** Stub process terminal. */
export class ProcessTerminal {}

// --- Component stubs ---

export class Box {}
export class CancellableLoader {}
export class Editor {}
export class Image {}
export class Input {}
export class Loader {}
export class Markdown {}
export class SelectList {}
export class SettingsList {}
export class Spacer {}
export class Text {}
export class TruncatedText {}

// --- Type stubs ---

export type AutocompleteItem = Record<string, unknown>;
export type Component = unknown;
export type EditorTheme = Record<string, unknown>;
export type EditorOptions = Record<string, unknown>;
export type Focusable = unknown;
export type Keybinding = Record<string, unknown>;
export type KeybindingsConfig = Record<string, unknown>;
export type MarkdownTheme = Record<string, unknown>;
export type OverlayOptions = Record<string, unknown>;
export type OverlayHandle = unknown;
export type SelectListTheme = Record<string, unknown>;

/** Combined autocomplete provider stub. */
export class CombinedAutocompleteProvider {}

// --- Autocomplete ---

export { CombinedAutocompleteProvider as AutocompleteProvider };
