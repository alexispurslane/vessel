/**
 * @file Deep-partial theme type for svelte-streamdown customization.
 */

import type { Theme } from "svelte-streamdown";

/**
 * Recursively makes all properties in T optional while preserving leaf types.
 * Mirrors the DeepPartialTheme type from svelte-streamdown's internal theme module,
 * which is not exported from the package's public API.
 */
type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type DeepPartialTheme = DeepPartial<Theme>;
