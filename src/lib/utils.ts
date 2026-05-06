/**
 * @file Shared utility functions: CSS class merging, JSON parsing, hashing, draft persistence, and display formatting.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { z, type ZodType } from "zod";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Parse and validate JSON using a Zod schema, returning null on any failure.
 *
 * Use this when the parsed value is best-effort / optional — e.g. reading
 * persisted settings that may have been manually edited or come from an
 * older schema version.
 *
 * @param json   The raw JSON string (may be null/undefined)
 * @param schema A Zod schema that describes the expected shape
 * @returns      The parsed & validated value, or null on failure
 */
export function safeJsonParse<T>(json: string | null | undefined, schema: ZodType<T>): T | null {
    if (json == null) return null;
    try {
        // oxlint-disable-next-line secure-coding/no-unsafe-deserialization -- Zod validate
        const raw: unknown = JSON.parse(json);
        return schema.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Parse and validate JSON using a Zod schema.
 *
 * Unlike raw `JSON.parse`, this:
 * - Returns a fully typed result (no `any`)
 * - Validates the structure at runtime (catches malformed/corrupt data early)
 * - Produces a Zod-flavored error message on failure
 *
 * @param json   The raw JSON string
 * @param schema A Zod schema that describes the expected shape
 * @returns      The parsed & validated value
 * @throws       SyntaxError if the JSON is invalid, or ZodError if validation fails
 */
export function tryJsonParse<T>(json: string | null | undefined, schema: ZodType<T>): T {
    if (json == null) throw new SyntaxError("Cannot parse null/undefined JSON string");
    // oxlint-disable-next-line secure-coding/no-unsafe-deserialization -- Zod validate
    const raw: unknown = JSON.parse(json);
    return schema.parse(raw);
}

/**
 * Validate an already-parsed value against a Zod schema, returning null on failure.
 *
 * Use this when you have an `unknown` value (e.g., from `JSON.parse()`)
 * that needs runtime validation and type-safe narrowing.
 * Unlike `safeJsonParse`, this does NOT parse a JSON string — it validates
 * an already-parsed object.
 *
 * @param value  The already-parsed value to validate
 * @param schema A Zod schema that describes the expected shape
 * @returns      The validated & typed value, or null on failure
 */
export function safeValidate<T>(value: unknown, schema: ZodType<T>): T | null {
    try {
        return schema.parse(value);
    } catch {
        return null;
    }
}

// --- Reusable Zod schemas for common types ---

/** Zod schema for `string[]` — used for tags, domains, env vars, etc. */
export const stringArraySchema = z.array(z.string());

/** Zod schema for `Record<string, unknown>` */
export const recordSchema = z.record(z.string(), z.unknown());

/**
 * Returns a deterministic hue (0–359) from a string hash.
 * @param str - The string to hash
 * @returns A hue value between 0 and 359
 */
export function hashHue(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash; // Convert to 32bit integer
    }
    return ((hash % 360) + 360) % 360;
}

/**
 * Returns a deterministic HSL color from a string hash.
 * Uses the string's hash to pick a hue, with fixed saturation and lightness
 * for pleasant, consistent pill text colors that work on both light and dark backgrounds.
 * @param str - The string to hash
 * @returns An HSL color string
 */
export function hashColor(str: string): string {
    const hue = hashHue(str);
    return `hsl(${String(hue)}, 60%, 42%)`;
}

/**
 * Returns a deterministic light HSL background color from a string hash,
 * suitable for pill backgrounds with the hashColor as text.
 * @param str - The string to hash
 * @returns An HSL color string for light backgrounds
 */
export function hashColorBg(str: string): string {
    const hue = hashHue(str);
    return `hsl(${String(hue)}, 55%, 88%)`;
}

/**
 * Returns a deterministic dark HSL background color from a string hash,
 * suitable for pill backgrounds in dark mode.
 * @param str - The string to hash
 * @returns An HSL color string for dark backgrounds
 */
export function hashColorBgDark(str: string): string {
    const hue = hashHue(str);
    return `hsl(${String(hue)}, 40%, 20%)`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };

// --- Draft persistence utilities ---

/** The sessionStorage key prefix used for per-conversation message drafts. */
export const DRAFT_KEY_PREFIX = "chat-draft:";

/**
 * Check whether a specific conversation has an unsent draft in sessionStorage.
 * @param conversationId - The conversation ID to check
 * @returns Whether a draft exists
 */
export function hasDraft(conversationId: string): boolean {
    try {
        return sessionStorage.getItem(`${DRAFT_KEY_PREFIX}${conversationId}`) !== null;
    } catch {
        return false;
    }
}

/**
 * Return the set of conversation IDs that currently have unsent drafts.
 * @returns A Set of conversation IDs with drafts
 */
export function getDraftConversationIds(): Set<string> {
    const ids = new Set<string>();
    try {
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key?.startsWith(DRAFT_KEY_PREFIX)) {
                ids.add(key.slice(DRAFT_KEY_PREFIX.length));
            }
        }
    } catch {
        // sessionStorage may be unavailable
    }
    return ids;
}

/**
 * Format a tool argument value into a compact display string.
 * Strips escape characters from strings, replaces newlines with spaces,
 * and truncates long values with an ellipsis.
 * @param value - The value to format
 * @param maxLen - Maximum display length before truncation
 * @returns A compact string representation of the value
 */
export function formatArgValue(value: unknown, maxLen = 40): string {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") {
        const cleaned = value
            .replace(/\\n/g, " ")
            .replace(/\n/g, " ")
            .replace(/\\t/g, " ")
            .replace(/\\"/g, '"')
            .trim();
        if (cleaned.length > maxLen) return cleaned.slice(0, maxLen) + "…";
        return cleaned || '""';
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
        const s = JSON.stringify(value);
        return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
    }
    if (typeof value === "object") {
        const s = JSON.stringify(value);
        return s.length > maxLen ? "{…}" : s;
    }
    return JSON.stringify(value);
}
