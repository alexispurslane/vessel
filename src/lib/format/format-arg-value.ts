/**
 * @file Shared utility for formatting tool-call argument values as compact strings.
 * Used by both markdown and PDF export, and re-exported from the general utils module.
 */

/**
 * Format a tool-call argument value as a compact, human-readable string.
 *
 * Strings are cleaned (newlines/tabs collapsed), all types are truncated
 * to `maxLen` characters with an ellipsis when they exceed that limit.
 *
 * @param value - The argument value to format
 * @param maxLen - Maximum display length before truncation (default 60)
 * @returns A compact string representation of the value
 */
export function formatArgValue(value: unknown, maxLen = 60): string {
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
