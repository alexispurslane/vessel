/**
 * @file Mock OpenAI-compatible LLM server for E2E tests.
 *
 * Starts a lightweight HTTP server on a configurable port that responds
 * to `/v1/chat/completions` with streaming SSE chunks. The server
 * reads the last user message as a JSON "turn plan" specifying what
 * to emit across multiple agentic turns.
 *
 * Each turn in the plan can include thinking, text, and/or tool calls.
 * When a turn has tool calls, `stop_reason` is `"tool_calls"` so the
 * agent loop pauses for tool execution. When tool results come back,
 * the server advances to the next turn. A text-only turn ends the
 * loop with `stop_reason: "stop"`.
 *
 * Also serves `GET /v1/models` so provider model-fetching works.
 *
 * This lets the full Vessel stack exercise its OpenAI completions
 * pipeline end-to-end without calling a real LLM provider.
 */

// E2E test files run in Node.js via Playwright — `node:http`, `Buffer`,
// `process`, and `Server` are all available at runtime.
// oxlint-disable-next-line typescript/no-explicit-any
/// <reference types="node" />

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";

// ─── Prompt types ───────────────────────────────────────────────

/**
 * A tool call specification that the mock server will emit.
 *
 * `name` must match a pi-coding-agent builtin tool (bash, read,
 * write, edit, find, ls). `arguments` is the
 * JSON object the agent passes to the tool — it must match the
 * tool's expected parameter schema.
 */
export interface MockToolCall {
    /** The tool name (e.g. "bash", "write_file", "read_file") */
    name: string;
    /** Arguments object matching the tool's parameter schema */
    arguments: Record<string, unknown>;
}

/**
 * A single turn in a mock LLM turn plan.
 *
 * - Tool-only turn: `{ tools: [...] }` — emit thinking, text, then
 *   parallel tool calls. `stop_reason` is `"tool_calls"`.
 * - Text-only turn: `{ text: true }` — emit thinking and text
 *   paragraphs. `stop_reason` is `"stop"`.
 * - Tool turn with pre-text: `{ tools: [...], text: true }` — emit
 *   thinking, text before tools, then tool calls.
 */
export interface MockTurn {
    /** Tool calls to emit in this turn. Empty/absent = text-only turn. */
    tools?: MockToolCall[];
    /** Whether to emit a text paragraph before tool calls (or as the main content). */
    text?: boolean;
    /**
     * Number of text paragraphs to emit for this turn.
     * Defaults to 1-2 random paragraphs when not set.
     * Set to a high number (e.g. 30) to create a long-running
     * text stream for testing stream recovery on reload.
     */
    textParagraphs?: number;
    /**
     * Number of thinking paragraphs to emit before any output.
     * Defaults to 1 when not set.
     * Set to a high number (e.g. 20) to create a long-running
     * thinking stream for testing stream recovery on reload.
     */
    thinkingParagraphs?: number;
}

/**
 * A full multi-turn plan for the mock LLM.
 *
 * Each turn is executed sequentially: the server emits one turn per
 * request, advancing to the next turn when it receives tool results.
 * The final turn (text-only) ends the agentic loop.
 */
export interface MockTurnPlan {
    turns: MockTurn[];
    /**
     * Override the inter-chunk delay in milliseconds.
     * Defaults to 5-15ms random. Set higher (e.g. 50) to slow
     * down streaming so tests can reload mid-stream.
     */
    chunkDelayMs?: number;
}

/** Lorem ipsum paragraphs for generating text deltas. */
const LOREM = [
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
    "Excepteur sint occaecat cupiditat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
    "Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Nullam varius, turpis et commodo pharetra.",
    "Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas.",
    "Fusce aliquet pede non pede. Suspendisse dapibus lorem pellentesque magna. Integer nulla.",
    "Donec blandit feugiat ligula. Donec hendrerit, felis et imperdiet euismod, purus ipsum pretium metus.",
];

/**
 * Build a mock LLM prompt string from a full turn plan.
 *
 * Each turn is executed per request: tool-call turns pause for
 * tool results, text-only turns end the loop.
 *
 * @param plan - The multi-turn plan
 * @returns A JSON string to use as the chat message content
 *
 * @example
 * ```ts
 * const prompt = mockTurnPlan({
 *   turns: [
 *     { tools: [{ name: "write_file", arguments: { path: "a.txt", content: "hi" } }] },
 *     { tools: [{ name: "bash", arguments: { command: "cat a.txt" } }] },
 *     { text: true },
 *   ],
 * });
 * ```
 */
export function mockTurnPlan(plan: MockTurnPlan): string {
    return JSON.stringify(plan);
}

// ─── OpenAI wire types ─────────────────────────────────────────

/** A single streaming chunk in the OpenAI format. */
interface ChatCompletionChunk {
    id: string;
    object: "chat.completion.chunk";
    created: number;
    model: string;
    choices: Array<{
        index: number;
        delta: Record<string, unknown>;
        finish_reason: string | null;
    }>;
    usage?: Record<string, unknown>;
}

/** OpenAI chat message format (minimal subset for request parsing). */
interface ChatMessage {
    role: "system" | "user" | "assistant" | "tool";
    content?: string | Array<{ type: string; text?: string }>;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Generate a random chat completion ID.
 *
 * @returns A unique string ID for a chat completion
 */
function randomId(): string {
    return `chatcmpl-mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Pick a random element from an array.
 *
 * @param arr - The array to pick from
 * @returns A random element from the array
 */
function randomFrom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Split text into random-sized chunks to simulate streaming token deltas.
 *
 * @param text - The text to split
 * @param minWords - Minimum words per chunk
 * @param maxWords - Maximum words per chunk
 * @returns Array of text chunks
 */
function splitIntoChunks(text: string, minWords = 2, maxWords = 5): string[] {
    const words = text.split(" ");
    const chunks: string[] = [];
    let i = 0;
    while (i < words.length) {
        const size = minWords + Math.floor(Math.random() * (maxWords - minWords + 1));
        const chunk = words.slice(i, i + size).join(" ");
        chunks.push(chunk);
        i += size;
    }
    return chunks;
}

// ─── Prompt parsing ─────────────────────────────────────────────

/**
 * Count how many assistant turns (with tool_calls) exist in the message history.
 *
 * Each assistant message with `tool_calls` represents one completed
 * tool-call turn. This count determines which plan turn to execute next.
 *
 * @param messages - The messages from the request body
 * @returns Number of completed tool-call turns
 */
function countCompletedToolTurns(messages: ChatMessage[]): number {
    let count = 0;
    for (const m of messages) {
        if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
            count++;
        }
    }
    return count;
}

/**
 * Parse a turn plan from the last user message.
 *
 * Supports two formats:
 * - Full plan: `{ turns: [...] }` (MockTurnPlan)
 * - Legacy: `[toolCall, ...]` (MockToolCall[]) — auto-wrapped into
 *   a two-turn plan: tools + final text
 *
 * Returns `null` if the content can't be parsed as a plan.
 *
 * @param messages - The messages from the request body
 * @returns The parsed turn plan, or null for plain-text messages
 */
function parsePlanFromMessages(messages: ChatMessage[]): MockTurnPlan | null {
    const userMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!userMsg?.content) return null;

    // OpenAI API can send content as a string or as an array of content parts
    const contentStr = typeof userMsg.content === 'string'
        ? userMsg.content
        : Array.isArray(userMsg.content)
            ? (userMsg.content as Array<{ type: string; text?: string }>).map(p => p.text ?? '').join('')
            : JSON.stringify(userMsg.content);

    try {
        // JSON from test harness, not untrusted user input
        // oxlint-disable-next-line secure-coding/no-xxe-injection
        const parsed: unknown = JSON.parse(contentStr);

        if (
            typeof parsed === "object" &&
            parsed !== null &&
            "turns" in parsed &&
            Array.isArray((parsed as MockTurnPlan).turns)
        ) {
            return parsed as MockTurnPlan;
        }
    } catch {
        // Not valid JSON — treat as a plain-text message
    }

    return null;
}

// ─── Chunk builders ─────────────────────────────────────────────

/**
 * Append streaming tool call chunks to the lines array.
 *
 * Emits an OpenAI-format tool call start chunk (with id, name)
 * followed by a single arguments chunk.
 *
 * @param lines - The SSE lines array to append to
 * @param makeChunk - The chunk factory function
 * @param toolCallIndex - The tool call index within this turn
 * @param toolCall - The tool call spec
 */
function appendToolCallChunks(
    lines: string[],
    makeChunk: (delta: Record<string, unknown>, finishReason: string | null) => string,
    toolCallIndex: number,
    toolCall: MockToolCall,
): void {
    const toolCallId = `call_mock_${toolCallIndex}`;

    lines.push(
        makeChunk(
            {
                tool_calls: [{
                    index: toolCallIndex,
                    id: toolCallId,
                    type: "function",
                    function: { name: toolCall.name, arguments: "" },
                }],
            },
            null,
        ),
    );

    // Send arguments in a single chunk. Splitting across
    // chunks confuses partial-json parsers.
    const argStr = JSON.stringify(toolCall.arguments);
    lines.push(
        makeChunk(
            { tool_calls: [{ index: toolCallIndex, function: { arguments: argStr } }] },
            null,
        ),
    );
}

/**
 * Append streaming thinking (reasoning) chunks to the lines array.
 *
 * Uses `reasoning_content` which pi-ai recognizes as thinking output.
 *
 * @param lines - The SSE lines array to append to
 * @param makeChunk - The chunk factory function
 */
function appendThinkingChunks(
    lines: string[],
    makeChunk: (delta: Record<string, unknown>, finishReason: string | null) => string,
    numParagraphs = 1,
): void {
    for (let p = 0; p < numParagraphs; p++) {
        const paragraph = randomFrom(LOREM);
        const chunks = splitIntoChunks(paragraph, 2, 5);
        for (const chunk of chunks) {
            lines.push(makeChunk({ reasoning_content: chunk + " " }, null));
        }
    }
    lines.push(makeChunk({ reasoning_content: "\n\n" }, null));
}

/**
 * Append streaming text paragraph chunks to the lines array.
 *
 * @param lines - The SSE lines array to append to
 * @param makeChunk - The chunk factory function
 * @param isLast - Whether this is the last paragraph (skip trailing newline)
 */
function appendTextParagraphChunks(
    lines: string[],
    makeChunk: (delta: Record<string, unknown>, finishReason: string | null) => string,
    isLast: boolean,
): void {
    const paragraph = randomFrom(LOREM);
    const textChunks = splitIntoChunks(paragraph, 2, 5);
    for (const chunk of textChunks) {
        lines.push(makeChunk({ content: chunk + " " }, null));
    }
    if (!isLast) {
        lines.push(makeChunk({ content: "\n\n" }, null));
    }
}

// ─── Turn response builder ─────────────────────────────────────

/**
 * Build SSE data lines for a single turn of a turn plan.
 *
 * A tool-call turn emits: thinking → text (if requested) → tool calls,
 * with `stop_reason: "tool_calls"`. A text-only turn emits:
 * thinking → text, with `stop_reason: "stop"`.
 *
 * @param modelId - The model ID to echo back in chunks
 * @param turn - The turn spec to emit
 * @returns Array of `data: ...` lines for the SSE response
 */
function buildTurnResponse(modelId: string, turn: MockTurn): string[] {
    const id = randomId();
    const created = Math.floor(Date.now() / 1000);
    const lines: string[] = [];
    const hasTools = (turn.tools?.length ?? 0) > 0;

    const makeChunk = (delta: Record<string, unknown>, finishReason: string | null): string => {
        const chunk: ChatCompletionChunk = {
            id,
            object: "chat.completion.chunk",
            created,
            model: modelId,
            choices: [{ index: 0, delta, finish_reason: finishReason }],
        };
        return `data: ${JSON.stringify(chunk)}`;
    };

    lines.push(makeChunk({ role: "assistant" }, null));

    // Thinking before any output
    appendThinkingChunks(lines, makeChunk, turn.thinkingParagraphs);

    if (hasTools) {
        // Text before tool calls (optional)
        if (turn.text) {
            appendTextParagraphChunks(lines, makeChunk, true);
        }

        // All tool calls as parallel calls
        const tools = turn.tools!;
        for (let i = 0; i < tools.length; i++) {
            appendToolCallChunks(lines, makeChunk, i, tools[i]);
        }

        lines.push(makeChunk({}, "tool_calls"));
    } else {
        // Text-only turn — end the loop
        const numParagraphs = turn.textParagraphs ?? (1 + Math.floor(Math.random() * 2));
        for (let p = 0; p < numParagraphs; p++) {
            appendTextParagraphChunks(lines, makeChunk, p === numParagraphs - 1);
        }

        lines.push(makeChunk({}, "stop"));
    }

    const usageChunk: ChatCompletionChunk = {
        id,
        object: "chat.completion.chunk",
        created,
        model: modelId,
        choices: [{ index: 0, delta: {}, finish_reason: null }],
        usage: { prompt_tokens: 50, completion_tokens: 80, total_tokens: 130 },
    };
    lines.push(`data: ${JSON.stringify(usageChunk)}`);
    lines.push("data: [DONE]");

    return lines;
}

// ─── SSE streaming ──────────────────────────────────────────────

/**
 * Stream SSE lines to the response with small delays between chunks.
 *
 * @param lines - The SSE data lines to send
 * @param res - The HTTP response to write to
 * @param chunkDelayMs - Override inter-chunk delay (default: 5-15ms random)
 */
function streamLines(lines: string[], res: ServerResponse, chunkDelayMs?: number): void {
    let i = 0;

    const sendNext = (): void => {
        if (i >= lines.length) {
            res.end();
            return;
        }
        res.write(lines[i] + "\n\n");
        i++;
        const delay = chunkDelayMs ?? (5 + Math.floor(Math.random() * 15));
        setTimeout(sendNext, delay);
    };

    sendNext();
}

// ─── HTTP handlers ──────────────────────────────────────────────

/**
 * Handle POST /v1/chat/completions.
 *
 * Parses the last user message as a turn plan. Advances through
 * turns based on how many tool-call turns have already completed
 * (counted from assistant messages with `tool_calls` in the history).
 *
 * - Turn 0: initial response (may include tool calls)
 * - Turn N (after N tool-result rounds): next turn in the plan
 * - Beyond plan length: text-only fallback
 *
 * @param req - The incoming HTTP request
 * @param res - The HTTP response to write the SSE stream to
 */
function handleCompletions(req: IncomingMessage, res: ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
    });
    req.on("end", () => {
        let modelId = "mock-model";
        let plan: MockTurnPlan | null = null;
        let completedToolTurns = 0;
        let toolNames: string[] = [];
        try {
            // JSON from test harness, not untrusted user input
            // oxlint-disable-next-line secure-coding/no-xxe-injection
            const parsed = JSON.parse(body) as { model?: string; messages?: ChatMessage[]; tools?: Array<{ function: { name: string } }> };
            if (parsed.model) modelId = parsed.model;
            if (parsed.messages) {
                plan = parsePlanFromMessages(parsed.messages);
                completedToolTurns = countCompletedToolTurns(parsed.messages);
            }
            if (parsed.tools) {
                toolNames = parsed.tools.map(t => t.function.name);
            }
        } catch {
            // Use defaults
        }

        console.log(`[mock-llm] Plan: ${plan ? JSON.stringify(plan.turns.map(t => ({ tools: t.tools?.length, text: t.text }))) : null}, completedToolTurns=${completedToolTurns}, tools=${JSON.stringify(toolNames)}`);

        // Determine which turn to execute
        let turn: MockTurn;
        if (plan && completedToolTurns < plan.turns.length) {
            turn = plan.turns[completedToolTurns];
        } else if (plan) {
            // Ran out of turns — emit final text
            turn = { text: true };
        } else {
            // No plan parsed (plain text or unparseable) — just respond with text
            turn = { text: true };
        }

        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        });

        const lines = buildTurnResponse(modelId, turn);
        streamLines(lines, res, plan?.chunkDelayMs);
    });
}

/**
 * Handle GET /v1/models.
 *
 * Returns a minimal models list in the OpenAI format.
 *
 * @param _req - The incoming HTTP request (unused)
 * @param res - The HTTP response to write the JSON to
 */
function handleModels(_req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
        JSON.stringify({
            object: "list",
            data: [
                {
                    id: "mock-model",
                    object: "model",
                    created: Math.floor(Date.now() / 1000),
                    owned_by: "mock",
                },
            ],
        }),
    );
}

// ─── Server lifecycle ───────────────────────────────────────────

/**
 * Start the mock LLM server.
 *
 * @param port - The port to listen on (default 16429)
 * @returns The running server instance
 */
export function startMockLlmServer(port = 16429): Server {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        if (req.method === "POST" && req.url === "/v1/chat/completions") {
            handleCompletions(req, res);
        } else if (req.method === "GET" && req.url === "/v1/models") {
            handleModels(req, res);
        } else {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
        }
    });

    server.listen(port, () => {
        console.log(`[mock-llm] Mock LLM server listening on http://localhost:${port}`);
    });

    return server;
}

/** The port the mock LLM server listens on. Matches DB seed data. */
export const MOCK_LLM_PORT = 16429;

/** The base URL for the mock LLM server. */
export const MOCK_LLM_BASE_URL = `http://localhost:${MOCK_LLM_PORT}/v1`;

/** The provider ID used in the test DB. */
export const MOCK_PROVIDER_ID = "mock-llm";

/** The model ID used in the test DB. */
export const MOCK_MODEL_ID = "mock-model";

// Auto-start when run directly (not imported as a module)
if (import.meta.main) {
    startMockLlmServer();
}
