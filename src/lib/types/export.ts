/**
 * @file Shared export types for conversation export (PDF, Markdown, JSON).
 *
 * Used by both the backend export modules and the frontend API layer.
 */

/** Supported export formats */
export type ExportFormat = "pdf" | "markdown" | "json";

/** Options controlling what content is included in an export */
export interface ExportOptions {
	/** Whether to include thinking/reasoning content from assistant messages */
	includeThinking?: boolean;
	/** Whether to include tool call details */
	includeToolCalls?: boolean;
}

/** A single code block extracted from a message */
export interface CodeBlock {
	/** The language identifier (e.g. "typescript", "python"), or empty string if none */
	lang: string;
	/** The raw code content (no trailing newline) */
	text: string;
}

/** A collected tool call output for the appendix in exports */
export interface ToolCallFootnote {
	/** 1-based footnote number */
	num: number;
	/** Tool name that produced this output */
	toolName: string;
	/** The output text */
	output: string;
	/** Whether the output parses as JSON */
	isJson: boolean;
}
