/**
 * @file Convert conversation messages to clean, readable Markdown.
 *
 * Produces minimal, well-structured Markdown with good typography cues.
 * The output is designed to be both human-readable and suitable for
 * further processing (e.g. HTML rendering for PDF export).
 */

import type { HistoryMessage } from "$lib/types.js";
import type { ExportOptions } from "./types.js";

/** Re-export the shared export options type. */
export type { ExportOptions };

/** A collected tool call output for the appendix. */
interface ToolCallFootnote {
    /** 1-based footnote number */
    num: number;
    /** Tool name that produced this output */
    toolName: string;
    /** The output text */
    output: string;
    /** Whether the output parses as JSON */
    isJson: boolean;
}

/**
 * Convert a conversation's messages to a clean Markdown document.
 *
 * @param title - The conversation title
 * @param messages - The conversation messages
 * @param options - Formatting options
 * @returns A complete Markdown string
 */
export function conversationToMarkdown(
    title: string,
    messages: HistoryMessage[],
    options: ExportOptions = {}
): string {
    const lines: string[] = [];
    const footnotes: ToolCallFootnote[] = [];

    lines.push(`# ${title}`);
    lines.push("");

    for (const msg of messages) {
        if (msg.role === "system") continue;
        // Skip textless assistant turns unless showing tool calls
        if (msg.role === "assistant" && !msg.content.trim() && !(options.includeToolCalls && msg.toolCalls && msg.toolCalls.length > 0)) continue;
        appendMessageLines(lines, msg, options, footnotes);
    }

    if (footnotes.length > 0) {
        appendToolOutputAppendix(lines, footnotes);
    }

    return lines.join("\n");
}

/**
 * Append the Markdown lines for a single message to the output array.
 *
 * @param lines - The output lines array to append to
 * @param msg - The message to render
 * @param options - Formatting options
 * @param footnotes - Collector for tool call output footnotes
 */
function appendMessageLines(
    lines: string[],
    msg: HistoryMessage,
    options: ExportOptions,
    footnotes: ToolCallFootnote[]
): void {
    const { includeThinking = false, includeToolCalls = false } = options;
    const roleLabel = msg.role === "user" ? "You" : "Assistant";
    const timestamp = formatTimestamp(msg.timestamp);

    lines.push(`## ${roleLabel}`);
    lines.push("");
    appendMetaLine(lines, msg.model, timestamp);

    if (msg.content.trim()) {
        lines.push(msg.content.trim());
        lines.push("");
    }

    if (includeThinking && msg.thinking?.trim()) {
        appendThinkingBlock(lines, msg.thinking.trim());
    }

    if (includeToolCalls && msg.toolCalls && msg.toolCalls.length > 0) {
        appendToolCalls(lines, msg.toolCalls, footnotes);
    }

    if (msg.isError && msg.errorMessage) {
        lines.push(`> **Error:** ${msg.errorMessage}`);
        lines.push("");
    }

    lines.push("---");
    lines.push("");
}

/**
 * Append the meta line (model + timestamp or just timestamp).
 *
 * @param lines - The output lines array
 * @param model - The model name, if any
 * @param timestamp - The formatted timestamp
 */
function appendMetaLine(lines: string[], model: string | undefined, timestamp: string): void {
    if (model) {
        lines.push(`*${model}*  ·  ${timestamp}`);
    } else {
        lines.push(`*${timestamp}*`);
    }
    lines.push("");
}

/**
 * Append a collapsible thinking block.
 *
 * @param lines - The output lines array
 * @param thinking - The thinking content
 */
function appendThinkingBlock(lines: string[], thinking: string): void {
    lines.push("<details>");
    lines.push("<summary>Thinking</summary>");
    lines.push("");
    lines.push(thinking);
    lines.push("");
    lines.push("</details>");
    lines.push("");
}

/**
 * Format a tool call argument value for inline display.
 *
 * @param value - The argument value
 * @param maxLen - Maximum character length before truncation
 * @returns A human-readable string representation
 */
function formatArgValue(value: unknown, maxLen = 60): string {
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

/**
 * Test whether a string parses as valid JSON.
 *
 * @param text - The string to test
 * @returns True if the text can be parsed as JSON
 */
function isJsonString(text: string): boolean {
    const trimmed = text.trim();
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
    try {
        JSON.parse(trimmed);
        return true;
    } catch {
        return false;
    }
}

/**
 * Append tool call lines with pretty name + args and footnote links.
 *
 * Shows the tool name and arguments in a user-friendly inline format.
 * If the tool has output, a footnote link is appended, and the output
 * is collected for the appendix at the end of the document.
 *
 * @param lines - The output lines array
 * @param toolCalls - The tool calls to render
 * @param footnotes - Collector for tool call output footnotes
 */
function appendToolCalls(
    lines: string[],
    toolCalls: Array<{ toolName: string; arguments?: Record<string, unknown>; output?: string }>,
    footnotes: ToolCallFootnote[]
): void {
    for (const tc of toolCalls) {
        const hasOutput = tc.output?.trim();
        const footnoteNum = hasOutput ? footnotes.length + 1 : 0;
        const footnoteLink = hasOutput ? ` [[${footnoteNum}]](#appendix-tool-outputs)` : "";

        // Tool name with optional footnote link
        lines.push(`**Tool:** \`${tc.toolName}\`${footnoteLink}`);

        // Pretty-print arguments inline
        if (tc.arguments && Object.keys(tc.arguments).length > 0) {
            const argParts = Object.entries(tc.arguments).map(
                ([key, val]) => `\`${key}\`: ${formatArgValue(val)}`
            );
            lines.push(argParts.join("  ·  "));
        }

        lines.push("");

        // Collect output for appendix
        if (hasOutput) {
            footnotes.push({
                num: footnoteNum,
                toolName: tc.toolName,
                output: tc.output!.trim(),
                isJson: isJsonString(tc.output!.trim()),
            });
        }
    }
}

/**
 * Append the appendix section containing all tool call outputs.
 *
 * Outputs that parse as JSON are rendered as fenced code blocks;
 * non-JSON outputs are rendered as plain text.
 *
 * @param lines - The output lines array
 * @param footnotes - The collected tool call output footnotes
 */
function appendToolOutputAppendix(lines: string[], footnotes: ToolCallFootnote[]): void {
    lines.push("# Appendix: Tool Outputs");
    lines.push("");

    for (const fn of footnotes) {
        lines.push(`## [${fn.num}] ${fn.toolName}`);
        lines.push("");

        if (fn.isJson) {
            const pretty = JSON.stringify(JSON.parse(fn.output), null, 2);
            lines.push("```json");
            lines.push(pretty);
            lines.push("```");
        } else {
            for (const line of fn.output.split("\n")) {
                lines.push(`> ${line}`);
            }
        }

        lines.push("");
    }
}

/**
 * Format a Unix timestamp (ms) as a human-readable date string.
 *
 * @param ts - Unix timestamp in milliseconds
 * @returns Formatted date string
 */
function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}
