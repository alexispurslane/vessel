/**
 * @file Shared types for conversation export.
 */

/** Options controlling what content is included in an export. */
export interface ExportOptions {
    /** Whether to include thinking/reasoning content from assistant messages */
    includeThinking?: boolean;
    /** Whether to include tool call details */
    includeToolCalls?: boolean;
}
