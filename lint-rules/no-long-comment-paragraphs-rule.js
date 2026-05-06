/**
 * Custom ESLint rule: no-long-comment-paragraphs
 *
 * Enforces that within function bodies:
 * 1. Consecutive line comment paragraphs are at most 2 lines long
 * 2. Each comment line's text content is at most 72 characters
 *
 * A "comment paragraph" is a group of consecutive // comment lines
 * with no blank lines or code between them.
 */

/**
 * Recursively collects all descendant function-like nodes within a given node.
 * Skips the root node itself (only collects children/descendants).
 */
function collectDescendantFunctions(node, results) {
    if (!node || typeof node !== "object") return;

    const traverse = (n) => {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) {
            for (const child of n) traverse(child);
            return;
        }
        if (
            n.type === "FunctionDeclaration" ||
            n.type === "FunctionExpression" ||
            n.type === "ArrowFunctionExpression"
        ) {
            results.push(n);
        }
        for (const key of Object.keys(n)) {
            if (key === "parent" || key === "tokens" || key === "comments") continue;
            traverse(n[key]);
        }
    };

    // Start traversal from the node's children, not the node itself
    for (const key of Object.keys(node)) {
        if (key === "parent" || key === "tokens" || key === "comments") continue;
        traverse(node[key]);
    }
}

/**
 * Groups consecutive line comments into paragraphs.
 * Two comments are consecutive if they appear on adjacent source lines.
 */
function groupIntoParagraphs(lineComments) {
    if (lineComments.length === 0) return [];

    // Sort by line number
    const sorted = [...lineComments].sort(
        (a, b) => a.loc.start.line - b.loc.start.line,
    );

    const paragraphs = [];
    let current = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        if (curr.loc.start.line === prev.loc.start.line + 1) {
            current.push(curr);
        } else {
            paragraphs.push(current);
            current = [curr];
        }
    }
    paragraphs.push(current);

    return paragraphs;
}

const MAX_PARAGRAPH_LINES = 2;
const MAX_LINE_CHARS = 80;

const rule = {
    meta: {
        type: "suggestion",
        docs: {
            description:
                "Enforce comment paragraphs in function bodies are at most 2 lines and 72 characters per line",
            category: "Stylistic Issues",
            recommended: true,
        },
        messages: {
            paragraphTooLong:
                "Comment paragraphs in function bodies must be at most {{max}} lines long (found {{count}} lines). Keep comments concise — explain the 'why', not the 'what'.",
            lineTooLong:
                "Comment lines in function bodies must be at most {{max}} characters of content (found {{length}} characters). Keep comments concise.",
        },
        schema: [
            {
                type: "object",
                properties: {
                    maxParagraphLines: { type: "integer", minimum: 1 },
                    maxLineChars: { type: "integer", minimum: 1 },
                },
                additionalProperties: false,
            },
        ],
    },

    create(context) {
        const options = context.options[0] || {};
        const maxParagraphLines = options.maxParagraphLines ?? MAX_PARAGRAPH_LINES;
        const maxLineChars = options.maxLineChars ?? MAX_LINE_CHARS;
        const sourceCode = context.sourceCode;

        function checkFunctionBody(node) {
            const body = node.body;
            if (!body || body.type !== "BlockStatement") return;

            const bodyRange = body.range;
            const allComments = sourceCode.getAllComments();

            // Find line comments within this function body's range
            const commentsInBody = allComments.filter(
                (c) =>
                    c.type === "Line" &&
                    c.range[0] >= bodyRange[0] &&
                    c.range[1] <= bodyRange[1],
            );

            if (commentsInBody.length === 0) return;

            // Find all descendant function nodes so we can exclude comments
            // that belong to nested functions (they'll be checked separately)
            const descendantFunctions = [];
            collectDescendantFunctions(body, descendantFunctions);

            // Filter out comments inside nested functions
            const ownComments = commentsInBody.filter((c) =>
                descendantFunctions.every(
                    (f) =>
                        !(c.range[0] >= f.range[0] && c.range[1] <= f.range[1]),
                ),
            );

            if (ownComments.length === 0) return;

            // Group into paragraphs and check
            const paragraphs = groupIntoParagraphs(ownComments);

            for (const paragraph of paragraphs) {
                // Check paragraph length
                if (paragraph.length > maxParagraphLines) {
                    context.report({
                        node: paragraph[0],
                        messageId: "paragraphTooLong",
                        data: {
                            max: maxParagraphLines,
                            count: paragraph.length,
                        },
                    });
                }

                // Check each line's character count
                for (const comment of paragraph) {
                    const contentLength = comment.value.trim().length;
                    if (contentLength > maxLineChars) {
                        context.report({
                            node: comment,
                            messageId: "lineTooLong",
                            data: {
                                max: maxLineChars,
                                length: contentLength,
                            },
                        });
                    }
                }
            }
        }

        return {
            FunctionDeclaration: checkFunctionBody,
            FunctionExpression: checkFunctionBody,
            ArrowFunctionExpression: checkFunctionBody,
        };
    },
};

export default rule;
