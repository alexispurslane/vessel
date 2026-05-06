/**
 * Convert bracket-style math delimiters to dollar-sign delimiters.
 *
 * LLMs often output LaTeX using `\[...\]` for display math and
 * `\(...\)` for inline math. Streamdown only understands dollar-sign
 * delimiters (`$$` and `$`). This phase converts brackets to dollars.
 *
 * @param text - The markdown content with bracket math delimiters
 * @returns Content with bracket delimiters replaced by dollar signs
 */
export function convertBracketToDollar(text: string): string {
    // Display math: \[...\] → $$\n...\n$$
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_match, inner: string) => {
        // eslint-disable-next-line sonarjs/slow-regex
        // server-side LLM output, not user input
        const trimmed = inner.replace(/^\n+/, "").replace(/\n+$/, "");
        return `$$\n${trimmed}\n$$`;
    });

    // Inline math: \(...\) → $...$
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_match, inner: string) => {
        return `$${inner.trim()}$`;
    });

    return text;
}

/**
 * Check whether a blank line should be inserted before an opening `$$`.
 *
 * @param result - The lines accumulated so far
 * @returns True if a blank line should be inserted
 */
function needsBlankBefore(result: string[]): boolean {
    return result.length > 0 && result[result.length - 1].trim() !== "";
}

/**
 * Check whether a blank line should be inserted after a closing `$$`.
 *
 * @param nextLine - The line that follows the closing `$$`, or undefined
 * @returns True if a blank line should be inserted
 */
function needsBlankAfter(nextLine: string | undefined): boolean {
    return nextLine !== undefined && nextLine.trim() !== "";
}

/**
 * Handle writing an opening `$$` delimiter, inserting a blank line before if needed.
 *
 * @param line - The `$$` line
 * @param result - The accumulated output lines
 */
function pushOpeningDelimiter(line: string, result: string[]): void {
    if (needsBlankBefore(result)) result.push("");
    result.push(line);
}

/**
 * Handle writing a closing `$$` delimiter, inserting a blank line after if needed.
 *
 * @param line - The `$$` line
 * @param nextLine - The next line in the source (or undefined if last line)
 * @param result - The accumulated output lines
 */
function pushClosingDelimiter(line: string, nextLine: string | undefined, result: string[]): void {
    result.push(line);
    if (needsBlankAfter(nextLine)) result.push("");
}

/**
 * Insert blank lines around `$$` block delimiters.
 *
 * Streamdown's block-level math tokenizer requires blank lines
 * separating `$$` blocks from surrounding paragraph text. LLMs
 * often omit these, which causes the math block to be swallowed
 * into the paragraph and not render.
 *
 * @param text - The markdown content with dollar-sign math delimiters
 * @returns Content with blank lines ensuring math blocks are isolated
 */
export function insertBlankLines(text: string): string {
    const lines = text.split("\n");
    const result: string[] = [];
    let inMathBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.trim() === "$$") {
            if (inMathBlock) {
                pushClosingDelimiter(line, lines[i + 1], result);
                inMathBlock = false;
            } else {
                pushOpeningDelimiter(line, result);
                inMathBlock = true;
            }
        } else {
            result.push(line);
        }
    }

    return result.join("\n");
}

/**
 * Preprocess markdown content to fix common LLM math formatting issues
 * before it reaches Streamdown's parser.
 *
 * Two problems this solves:
 *
 * 1. **Bracket delimiters.** LLMs often output LaTeX using `\[...\]` for
 *    display math and `\(...\)` for inline math. Streamdown only understands
 *    dollar-sign delimiters (`$$` and `$`). We convert brackets to dollars.
 *
 * 2. **Blank lines around `$$` blocks.** Streamdown's block-level math
 *    tokenizer requires blank lines separating `$$` blocks from surrounding
 *    paragraph text. LLMs often omit these, which causes the math block to
 *    be swallowed into the paragraph and not render.
 *
 * @param content - The markdown content with potentially malformed math
 * @returns The content with math delimiters normalized
 */
export function preprocessMathMarkdown(content: string): string {
    return insertBlankLines(convertBracketToDollar(content));
}
