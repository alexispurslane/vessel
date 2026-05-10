/**
 * @file Convert conversation messages to a clean, typographically excellent PDF.
 *
 * Uses PDFKit for maximum control over layout and typography.
 * Markdown content is parsed via `marked` and rendered with proper
 * structure: headings, bold/italic, lists, code blocks, blockquotes, etc.
 *
 * Design principles:
 * - Minimal chrome — let the content breathe
 * - Clear hierarchy via type scale, not decoration
 * - Monospace for code, serif for body, sans for metadata
 * - Generous margins and line spacing for readability
 */

import PDFDocument from "pdfkit";
import { marked } from "marked";
import type { Token, Tokens } from "marked";
import type { HistoryMessage } from "$lib/types.js";
import type { ExportOptions, ToolCallFootnote } from "$lib/types/export.js";
import { formatArgValue } from "$lib/format/format-arg-value.js";

/** Re-export the shared export types. */
export type { ExportOptions };

// --- Typography constants ---

const FONT_SANS = "Helvetica";
const FONT_SANS_BOLD = "Helvetica-Bold";
const FONT_SANS_ITALIC = "Helvetica-Oblique";
const FONT_SERIF = "Times-Roman";
const FONT_SERIF_BOLD = "Times-Bold";
const FONT_SERIF_ITALIC = "Times-Italic";
const FONT_MONO = "Courier";
const FONT_MONO_BOLD = "Courier-Bold";

const PAGE_WIDTH = 612; // US Letter
const PAGE_HEIGHT = 792;
const MARGIN_TOP = 72;
const MARGIN_BOTTOM = 72;
const MARGIN_LEFT = 72;
const MARGIN_RIGHT = 72;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

// Type scale (in points)
const TITLE_SIZE = 22;
const H1_SIZE = 18;
const H2_SIZE = 15;
const H3_SIZE = 13;
const H4_SIZE = 12;
const SECTION_SIZE = 14;
const META_SIZE = 9;
const BODY_SIZE = 11;
const SMALL_SIZE = 10;
const CODE_SIZE = 9;

// Spacing
const LINE_GAP_BODY = 3;
const LINE_GAP_CODE = 2;
const SECTION_GAP = 24;

// List indentation
const LIST_INDENT = 18;

/**
 * Generate a PDF buffer from a conversation's messages.
 *
 * @param title - The conversation title
 * @param messages - The conversation messages
 * @param options - Formatting options
 * @returns A Promise resolving to the PDF as a Uint8Array
 */


/**
 * Generate a PDF buffer from a conversation's messages.
 *
 * @param title - The conversation title
 * @param messages - The conversation messages
 * @param options - Formatting options
 * @returns A Promise resolving to the PDF as a Uint8Array
 */
export async function conversationToPdf(
    title: string,
    messages: HistoryMessage[],
    options: ExportOptions = {}
): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        const doc = new PDFDocument({
            size: [PAGE_WIDTH, PAGE_HEIGHT],
            margins: { top: MARGIN_TOP, bottom: MARGIN_BOTTOM, left: MARGIN_LEFT, right: MARGIN_RIGHT },
            bufferPages: true,
            info: {
                Title: title,
                Creator: "Vessel",
            },
        });

        doc.on("data", (chunk: Buffer) => chunks.push(chunk));
        doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
        doc.on("error", reject);

        renderTitleSection(doc, title);

        const footnotes: ToolCallFootnote[] = [];

        for (const msg of messages) {
            if (msg.role === "system") continue;
            // Skip textless assistant turns unless showing tool calls
            if (msg.role === "assistant" && !msg.content.trim() && !(options.includeToolCalls && msg.toolCalls && msg.toolCalls.length > 0)) continue;
            renderMessage(doc, msg, options, footnotes);
        }

        if (footnotes.length > 0) {
            renderToolOutputAppendix(doc, footnotes);
        }

        doc.end();
    });
}

/**
 * Render the document title and rule.
 *
 * @param doc - The PDFKit document
 * @param title - The conversation title
 */
function renderTitleSection(doc: PDFKit.PDFDocument, title: string): void {
    doc.font(FONT_SANS_BOLD).fontSize(TITLE_SIZE).fillColor("#1a1a1a").text(title, { align: "left" });
    doc.moveDown(0.5);
    const ruleY = doc.y;
    doc.moveTo(MARGIN_LEFT, ruleY).lineTo(PAGE_WIDTH - MARGIN_RIGHT, ruleY).lineWidth(0.5).stroke("#cccccc");
    doc.moveDown(1);
}

/**
 * Render a single message to the PDF document.
 *
 * @param doc - The PDFKit document
 * @param msg - The message to render
 * @param options - Formatting options
 */
/**
 * Render a single message into the PDF document.
 *
 * @param doc - The PDFKit document
 * @param msg - The message to render
 * @param options - Export options
 * @param footnotes - Collector for tool call output footnotes
 */
function renderMessage(doc: PDFKit.PDFDocument, msg: HistoryMessage, options: ExportOptions, footnotes: ToolCallFootnote[]): void {
    const { includeThinking = false, includeToolCalls = false } = options;
    const roleLabel = msg.role === "user" ? "You" : "Assistant";
    const timestamp = formatTimestamp(msg.timestamp);

    checkPageSpace(doc, SECTION_GAP + BODY_SIZE + META_SIZE);

    doc.font(FONT_SANS_BOLD).fontSize(SECTION_SIZE).fillColor("#1a1a1a").text(roleLabel, { continued: false });
    doc.moveDown(0.15);

    const metaParts: string[] = [];
    if (msg.model) metaParts.push(msg.model);
    metaParts.push(timestamp);
    doc.font(FONT_SANS).fontSize(META_SIZE).fillColor("#888888").text(metaParts.join("  ·  "), { continued: false });
    doc.moveDown(0.5);

    if (msg.content.trim()) {
        renderMarkdown(doc, msg.content.trim());
    }

    if (includeThinking && msg.thinking?.trim()) {
        renderThinkingSection(doc, msg.thinking.trim());
    }

    if (includeToolCalls && msg.toolCalls && msg.toolCalls.length > 0) {
        renderToolCallsSection(doc, msg.toolCalls, footnotes);
    }

    if (msg.isError && msg.errorMessage) {
        doc.moveDown(0.3);
        doc.font(FONT_SANS).fontSize(BODY_SIZE).fillColor("#cc0000").text(`Error: ${msg.errorMessage}`, { continued: false });
    }

    renderSeparator(doc);
}

// --- Markdown rendering ---

/**
 * Parse and render markdown content into the PDF document.
 *
 * @param doc - The PDFKit document
 * @param content - Markdown string to render
 */
function renderMarkdown(doc: PDFKit.PDFDocument, content: string): void {
    const tokens = marked.lexer(content);
    for (const token of tokens) {
        renderToken(doc, token, 0);
    }
}

/**
 * Render a single parsed markdown token.
 *
 * @param doc - The PDFKit document
 * @param token - A marked Token object
 * @param indent - Current indent level (for nested lists)
 */
function renderToken(doc: PDFKit.PDFDocument, token: Tokens.Generic, indent: number): void {
    switch (token.type) {
        case "heading":
            renderHeading(doc, token as Tokens.Heading);
            break;
        case "paragraph":
            renderParagraph(doc, token as Tokens.Paragraph, indent);
            break;
        case "code":
            renderFencedCodeBlock(doc, token as Tokens.Code);
            break;
        case "list":
            renderList(doc, token as Tokens.List, indent);
            break;
        case "blockquote":
            renderBlockquote(doc, token as Tokens.Blockquote);
            break;
        case "hr":
            renderSeparator(doc);
            break;
        case "table":
            renderTable(doc, token as Tokens.Table);
            break;
        case "html":
            renderHtmlBlock(doc, token as Tokens.HTML);
            break;
        default:
            break;
    }
}

/**
 * Render a markdown heading (h1–h6).
 *
 * @param doc - The PDFKit document
 * @param token - The heading token
 */
function renderHeading(doc: PDFKit.PDFDocument, token: Tokens.Heading): void {
    const sizeMap: Record<number, number> = { 1: H1_SIZE, 2: H2_SIZE, 3: H3_SIZE, 4: H4_SIZE };
    const fontSize = sizeMap[token.depth] ?? H4_SIZE;
    checkPageSpace(doc, fontSize * 2.5);
    doc.moveDown(0.4);
    doc.font(FONT_SANS_BOLD).fontSize(fontSize).fillColor("#1a1a1a");
    renderInlineTokens(doc, token.tokens, { baseFont: FONT_SANS_BOLD, baseSize: fontSize, baseColor: "#1a1a1a" });
    doc.moveDown(0.3);
}

/**
 * Render a paragraph of inline content.
 *
 * @param doc - The PDFKit document
 * @param token - The paragraph token
 * @param indent - Current indentation level
 */
function renderParagraph(doc: PDFKit.PDFDocument, token: Tokens.Paragraph, indent: number): void {
    checkPageSpace(doc, BODY_SIZE * 2);
    const x = MARGIN_LEFT + indent;
    doc.font(FONT_SERIF).fontSize(BODY_SIZE).fillColor("#1a1a1a");
    renderInlineTokens(doc, token.tokens, { baseFont: FONT_SERIF, baseSize: BODY_SIZE, baseColor: "#1a1a1a" }, { x, width: CONTENT_WIDTH - indent });
    doc.moveDown(0.4);
}

/**
 * Render a fenced code block with subtle background and left accent border.
 *
 * @param doc - The PDFKit document
 * @param token - The code token
 */
function renderFencedCodeBlock(doc: PDFKit.PDFDocument, token: Tokens.Code): void {
    const code = token.text;
    const x = MARGIN_LEFT;
    const width = CONTENT_WIDTH;

    doc.font(FONT_MONO).fontSize(CODE_SIZE).fillColor("#555555");
    const height = doc.heightOfString(code, { width: width - 16, lineGap: LINE_GAP_CODE });
    checkPageSpace(doc, height + 12);

    const startY = doc.y;
    doc.save();
    doc.rect(x, startY, width, height + 12).fill("#f7f7f7");
    doc.rect(x, startY, 2, height + 12).fill("#d0d0d0");
    doc.restore();

    doc.y = startY + 6;
    doc.font(FONT_MONO).fontSize(CODE_SIZE).fillColor("#555555");
    doc.text(code, x + 12, doc.y, { width: width - 16, lineGap: LINE_GAP_CODE });
    doc.y += 6;
    doc.moveDown(0.3);
}

/**
 * Render a list (ordered or unordered), including nested lists.
 *
 * @param doc - The PDFKit document
 * @param token - The list token
 * @param indent - Current indentation level
 */
function renderList(doc: PDFKit.PDFDocument, token: Tokens.List, indent: number): void {
    const startNum = typeof token.start === "number" ? token.start : 1;
    const counter = { isOrdered: token.ordered, num: startNum };

    for (const item of token.items) {
        renderListItem(doc, item, counter, indent);
        if (counter.isOrdered) counter.num++;
    }
    doc.moveDown(0.2);
}

/** Layout context for a list item's content area. */
interface ListItemLayout {
    itemX: number;
    itemWidth: number;
    indent: number;
}

/** Tracked list numbering state. */
interface ListCounter {
    isOrdered: boolean;
    num: number;
}

/**
 * Render a single list item.
 *
 * @param doc - The PDFKit document
 * @param item - The list item token
 * @param counter - Ordered/numbering state
 * @param indent - Current indentation level
 */
function renderListItem(
    doc: PDFKit.PDFDocument,
    item: Tokens.ListItem,
    counter: ListCounter,
    indent: number
): void {
    checkPageSpace(doc, BODY_SIZE * 2);
    const x = MARGIN_LEFT + indent;
    const bullet = counter.isOrdered ? `${counter.num}. ` : "•  ";

    doc.font(FONT_SANS).fontSize(BODY_SIZE).fillColor("#1a1a1a");
    doc.text(bullet, x, doc.y, { continued: false, width: LIST_INDENT });

    const layout: ListItemLayout = {
        itemX: x + LIST_INDENT,
        itemWidth: CONTENT_WIDTH - indent - LIST_INDENT,
        indent,
    };
    renderListItemContent(doc, item, layout);
    doc.moveDown(0.15);
}

/**
 * Render the sub-tokens within a list item.
 *
 * @param doc - The PDFKit document
 * @param item - The list item token
 * @param layout - Position and width for the item content
 */
function renderListItemContent(
    doc: PDFKit.PDFDocument,
    item: Tokens.ListItem,
    layout: ListItemLayout
): void {
    if (item.tokens.length === 0) return;

    for (const subToken of item.tokens) {
        if (subToken.type === "text") {
            doc.font(FONT_SERIF).fontSize(BODY_SIZE).fillColor("#1a1a1a");
            renderInlineTokens(doc, (subToken as Tokens.Text).tokens ?? [], { baseFont: FONT_SERIF, baseSize: BODY_SIZE, baseColor: "#1a1a1a" }, { x: layout.itemX, width: layout.itemWidth });
        } else if (subToken.type === "list") {
            renderList(doc, subToken as Tokens.List, layout.indent + LIST_INDENT * 2);
        } else if (subToken.type === "code") {
            renderFencedCodeBlock(doc, subToken as Tokens.Code);
        } else {
            renderToken(doc, subToken as Tokens.Generic, layout.indent + LIST_INDENT);
        }
    }
}

/**
 * Render a blockquote with a left accent border and muted text.
 *
 * @param doc - The PDFKit document
 * @param token - The blockquote token
 */
function renderBlockquote(doc: PDFKit.PDFDocument, token: Tokens.Blockquote): void {
    const x = MARGIN_LEFT + 12;
    const width = CONTENT_WIDTH - 12;

    // Render paragraphs and track y for the left border overlay
    const startY = doc.y;

    doc.font(FONT_SERIF_ITALIC).fontSize(BODY_SIZE).fillColor("#555555");
    for (const sub of token.tokens) {
        if (sub.type === "paragraph") {
            const para = sub as Tokens.Paragraph;
            renderInlineTokens(doc, para.tokens, { baseFont: FONT_SERIF_ITALIC, baseSize: BODY_SIZE, baseColor: "#555555" }, { x, width });
            doc.moveDown(0.2);
        }
    }
    const endY = doc.y;

    // Draw left border behind the content
    doc.save();
    doc.rect(MARGIN_LEFT + 4, startY - 2, 2, endY - startY + 4).fill("#cccccc");
    doc.restore();

    doc.moveDown(0.2);
}

/**
 * Render a table as a simple grid.
 *
 * @param doc - The PDFKit document
 * @param token - The table token
 */
function renderTable(doc: PDFKit.PDFDocument, token: Tokens.Table): void {
    const colCount = token.header.length;
    if (colCount === 0) return;

    const colWidth = CONTENT_WIDTH / colCount;
    const cellPadding = 6;
    const rowHeight = BODY_SIZE + cellPadding * 2;

    checkPageSpace(doc, rowHeight * 3);

    // Header row
    const headerY = doc.y;
    doc.save();
    doc.rect(MARGIN_LEFT, headerY, CONTENT_WIDTH, rowHeight).fill("#f0f0f0");
    doc.restore();

    let colX = MARGIN_LEFT;
    for (const cell of token.header) {
        doc.font(FONT_SANS_BOLD).fontSize(SMALL_SIZE).fillColor("#1a1a1a");
        doc.text(cell.text, colX + cellPadding, headerY + cellPadding, { width: colWidth - cellPadding * 2, height: rowHeight });
        colX += colWidth;
    }

    doc.y = headerY + rowHeight;

    // Data rows
    for (const row of token.rows) {
        checkPageSpace(doc, rowHeight);
        const rowY = doc.y;
        colX = MARGIN_LEFT;
        for (const cell of row) {
            doc.font(FONT_SERIF).fontSize(SMALL_SIZE).fillColor("#333333");
            doc.text(cell.text, colX + cellPadding, rowY + cellPadding, { width: colWidth - cellPadding * 2, height: rowHeight });
            colX += colWidth;
        }
        doc.y = rowY + rowHeight;

        // Thin line under each row
        doc.moveTo(MARGIN_LEFT, doc.y).lineTo(PAGE_WIDTH - MARGIN_RIGHT, doc.y).lineWidth(0.3).stroke("#e0e0e0");
    }
    doc.moveDown(0.5);
}

/**
 * Render an HTML block as plain text.
 *
 * @param doc - The PDFKit document
 * @param token - The HTML token
 */
function renderHtmlBlock(doc: PDFKit.PDFDocument, token: Tokens.HTML): void {
    checkPageSpace(doc, BODY_SIZE * 2);
    doc.font(FONT_SERIF).fontSize(BODY_SIZE).fillColor("#1a1a1a");
    doc.text(token.text, { width: CONTENT_WIDTH, lineGap: LINE_GAP_BODY });
    doc.moveDown(0.4);
}

// --- Inline token rendering ---

/** Shared style context for inline token rendering. */
interface InlineStyle {
    baseFont: string;
    baseSize: number;
    baseColor: string;
}

/**
 * Render a sequence of inline tokens using PDFKit's `continued` text flow.
 *
 * @param doc - The PDFKit document
 * @param tokens - Array of inline tokens from marked
 * @param style - The base style for this inline run
 * @param layout - Optional position/width override for indented contexts
 * @param layout.x - X position override
 * @param layout.width - Width override
 */
function renderInlineTokens(
    doc: PDFKit.PDFDocument,
    tokens: Token[] | undefined,
    style: InlineStyle,
    layout?: { x: number; width: number }
): void {
    if (!tokens || tokens.length === 0) return;

    const textOpts: PDFKit.Mixins.TextOptions = {
        width: layout?.width ?? CONTENT_WIDTH,
        lineGap: LINE_GAP_BODY,
        align: "left",
    };

    const positionOpts: { x?: number; y?: number } = layout ? { x: layout.x, y: doc.y } : {};

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const isLast = i === tokens.length - 1;

        applyInlineStyle(doc, token, style);
        const text = extractInlineText(token);

        doc.text(text, positionOpts.x, positionOpts.y, {
            ...textOpts,
            continued: !isLast,
        });

        if (i === 0) {
            positionOpts.x = undefined;
            positionOpts.y = undefined;
        }
    }
}

/**
 * Apply font/color styling for an inline token.
 *
 * @param doc - The PDFKit document
 * @param token - The inline token
 * @param style - Base style context
 */
function applyInlineStyle(
    doc: PDFKit.PDFDocument,
    token: Token,
    style: InlineStyle
): void {
    const { baseFont, baseSize, baseColor } = style;
    switch (token.type) {
        case "strong": {
            doc.font(getBoldVariant(baseFont)).fontSize(baseSize).fillColor(baseColor);
            break;
        }
        case "em": {
            doc.font(getItalicVariant(baseFont)).fontSize(baseSize).fillColor(baseColor);
            break;
        }
        case "codespan":
            doc.font(FONT_MONO).fontSize(baseSize - 1).fillColor("#c7254e");
            break;
        case "link":
            doc.font(baseFont).fontSize(baseSize).fillColor("#0066cc");
            break;
        case "del":
            doc.font(baseFont).fontSize(baseSize).fillColor("#999999");
            break;
        default:
            doc.font(baseFont).fontSize(baseSize).fillColor(baseColor);
            break;
    }
}

/**
 * Extract the plain text from an inline token, recursing into nested tokens.
 *
 * @param token - The inline token
 * @returns The extracted text string
 */
function extractInlineText(token: Token): string {
    switch (token.type) {
        case "text":
            return (token as Tokens.Text).raw;
        case "strong":
        case "em": {
            const inner = (token as Tokens.Strong | Tokens.Em).tokens;
            return inner ? inner.map(extractInlineText).join("") : token.raw;
        }
        case "codespan":
            return (token as Tokens.Codespan).text;
        case "link": {
            const link = token as Tokens.Link;
            return link.tokens ? link.tokens.map(extractInlineText).join("") : link.text;
        }
        case "del": {
            const del = token as Tokens.Del;
            return del.tokens ? del.tokens.map(extractInlineText).join("") : "";
        }
        case "br":
            return "\n";
        case "escape":
            return (token as Tokens.Escape).text;
        default:
            return (token as { raw?: string }).raw ?? "";
    }
}

/**
 * Get the bold variant of a font name.
 *
 * @param baseFont - The base font name
 * @returns The bold variant font name
 */
function getBoldVariant(baseFont: string): string {
    if (baseFont.startsWith("Times")) return FONT_SERIF_BOLD;
    if (baseFont.startsWith("Courier")) return FONT_MONO_BOLD;
    return FONT_SANS_BOLD;
}

/**
 * Get the italic variant of a font name.
 *
 * @param baseFont - The base font name
 * @returns The italic variant font name
 */
function getItalicVariant(baseFont: string): string {
    if (baseFont.startsWith("Times")) return FONT_SERIF_ITALIC;
    if (baseFont.startsWith("Courier")) return FONT_MONO; // no italic mono in base14
    return FONT_SANS_ITALIC;
}

// --- Message section helpers ---

/**
 * Render the thinking section of an assistant message.
 *
 * @param doc - The PDFKit document
 * @param thinking - The thinking content
 */
function renderThinkingSection(doc: PDFKit.PDFDocument, thinking: string): void {
    checkPageSpace(doc, BODY_SIZE * 3);
    doc.moveDown(0.5);
    doc.font(FONT_SANS).fontSize(META_SIZE).fillColor("#999999").text("Thinking:", { continued: false });
    doc.moveDown(0.2);
    renderMarkdown(doc, thinking);
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
 * Render tool calls inline with pretty name + args and footnote markers.
 *
 * Shows the tool name and arguments in a user-friendly format.
 * If the tool has output, a superscript footnote number is appended,
 * and the output is collected for the appendix.
 *
 * @param doc - The PDFKit document
 * @param toolCalls - The tool calls to render
 * @param footnotes - Collector for tool call output footnotes
 */
function renderToolCallsSection(
    doc: PDFKit.PDFDocument,
    toolCalls: HistoryMessage["toolCalls"],
    footnotes: ToolCallFootnote[]
): void {
    if (!toolCalls) return;
    for (const tc of toolCalls) {
        checkPageSpace(doc, BODY_SIZE * 2);
        doc.moveDown(0.4);

        // Tool name with footnote marker if output exists
        const hasOutput = tc.output?.trim();
        const footnoteNum = hasOutput ? footnotes.length + 1 : 0;

        const label = hasOutput
            ? `Tool: ${tc.toolName}  [${footnoteNum}]`
            : `Tool: ${tc.toolName}`;
        doc.font(FONT_SANS_BOLD).fontSize(SMALL_SIZE).fillColor("#1a1a1a").text(label, { continued: false });

        // Pretty-print arguments inline
        if (tc.arguments && Object.keys(tc.arguments).length > 0) {
            const argParts = Object.entries(tc.arguments).map(
                ([key, val]) => `${key}: ${formatArgValue(val)}`
            );
            const argsLine = argParts.join("  ·  ");
            doc.font(FONT_SANS).fontSize(SMALL_SIZE).fillColor("#888888").text(argsLine, { continued: false });
        }

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
 * Render the appendix section containing all tool call outputs.
 *
 * Outputs that parse as JSON are rendered as code blocks;
 * non-JSON outputs are rendered as markdown.
 *
 * @param doc - The PDFKit document
 * @param footnotes - The collected tool call output footnotes
 */
function renderToolOutputAppendix(doc: PDFKit.PDFDocument, footnotes: ToolCallFootnote[]): void {
    doc.addPage();
    doc.font(FONT_SANS_BOLD).fontSize(H1_SIZE).fillColor("#1a1a1a").text("Appendix: Tool Outputs", { align: "left" });
    doc.moveDown(0.5);

    for (const fn of footnotes) {
        checkPageSpace(doc, BODY_SIZE * 4);
        doc.font(FONT_SANS_BOLD).fontSize(H3_SIZE).fillColor("#1a1a1a").text(`[${fn.num}] ${fn.toolName}`, { continued: false });
        doc.moveDown(0.3);

        if (fn.isJson) {
            const pretty = JSON.stringify(JSON.parse(fn.output), null, 2);
            renderFencedCodeBlock(doc, { type: "code", text: pretty, lang: "json" } as Tokens.Code);
        } else {
            const quoted = fn.output
                .split("\n")
                .map((line) => `> ${line}`)
                .join("\n");
            renderMarkdown(doc, quoted);
        }

        doc.moveDown(0.5);
    }
}

/**
 * Render a thin horizontal separator.
 *
 * @param doc - The PDFKit document
 */
function renderSeparator(doc: PDFKit.PDFDocument): void {
    doc.moveDown(0.8);
    const sepY = doc.y;
    doc.moveTo(MARGIN_LEFT, sepY).lineTo(PAGE_WIDTH - MARGIN_RIGHT, sepY).lineWidth(0.3).stroke("#e0e0e0");
    doc.moveDown(0.8);
}

// --- Utilities ---

/**
 * Ensure there's enough space on the current page, or add a new one.
 *
 * @param doc - The PDFKit document
 * @param needed - The vertical space needed (in points)
 */
function checkPageSpace(doc: PDFKit.PDFDocument, needed: number): void {
    if (doc.y + needed > PAGE_HEIGHT - MARGIN_BOTTOM) {
        doc.addPage();
    }
}

/**
 * Format a Unix timestamp (ms) as a compact human-readable date string.
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
