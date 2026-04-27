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
 */
export function preprocessMathMarkdown(content: string): string {
    // --- Phase 1: Convert bracket delimiters to dollar-sign delimiters ---

    // Display math: \[...\] → $$\n...\n$$
    content = content.replace(/\\\[([\s\S]*?)\\\]/g, (_match, inner: string) => {
        const trimmed = inner.replace(/^\n+/, "").replace(/\n+$/, "");
        return `$$\n${trimmed}\n$$`;
    });

    // Inline math: \(...\) → $...$
    content = content.replace(/\\\(([\s\S]*?)\\\)/g, (_match, inner: string) => {
        return `$${inner.trim()}$`;
    });

    // --- Phase 2: Ensure blank lines around $$ block delimiters ---
    //
    // We track whether we're inside a $$ block so we always know whether
    // a $$ line is opening or closing — no ambiguity.
    //   - Opening $$: ensure blank line BEFORE it (don't touch after)
    //   - Closing $$: ensure blank line AFTER it (don't touch before)
    // This keeps the math content adjacent to its delimiters while
    // separating the whole block from surrounding text.

    const lines = content.split("\n");
    const result: string[] = [];
    let inMathBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed === "$$") {
            if (!inMathBlock) {
                // Opening $$ — ensure blank line before it
                if (result.length > 0 && result[result.length - 1].trim() !== "") {
                    result.push("");
                }
                result.push(line);
                inMathBlock = true;
            } else {
                // Closing $$ — ensure blank line after it
                result.push(line);
                if (i + 1 < lines.length && lines[i + 1].trim() !== "") {
                    result.push("");
                }
                inMathBlock = false;
            }
        } else {
            result.push(line);
        }
    }

    return result.join("\n");
}
