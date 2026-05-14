/**
 * @file Demo script: queries the mock LLM server via pi-ai and displays
 * the streaming response with reasoning in gray, text in white, and
 * tool calls in cyan/yellow.
 *
 * Implements the full agentic loop: when the model emits tool calls,
 * the script generates fake tool results, sends them back, and
 * continues until the model produces a final text response.
 *
 * Usage: bun run e2e/demo-mock-llm.ts
 *
 * Prerequisites:
 * - The mock LLM server must be running (bun run e2e/mock-llm-server.ts)
 * - The Vessel dev server does NOT need to be running — this script
 *   calls pi-ai directly against the mock server.
 */

import {
    stream,
    type Model,
    type Context,
    type AssistantMessageEvent,
    type AssistantMessage,
    type ToolCall,
    type ToolResultMessage,
} from "@mariozechner/pi-ai";
import { mockTurnPlan } from "./mock-llm-server.js";

// --- ANSI colors ---
const GRAY = "\x1b[90m";
const WHITE = "\x1b[37m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const MAGENTA = "\x1b[35m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/** The mock server's base URL. */
const MOCK_BASE_URL = "http://localhost:16429/v1";

/**
 * A model descriptor pointing at the mock LLM server.
 * pi-ai will use this to route requests to our mock.
 */
const mockModel: Model<"openai-completions"> = {
    id: "mock-model",
    name: "Mock Model",
    api: "openai-completions",
    provider: "mock-llm",
    baseUrl: MOCK_BASE_URL,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
};

// ─── Display helpers ────────────────────────────────────────────

/**
 * Print a streaming event to the terminal with color coding.
 *
 * Tool call details are printed on `toolcall_end` (not `toolcall_start`)
 * because pi-ai only emits `toolcall_end` after the stream finishes,
 * so printing on `toolcall_start` would place the header far from the
 * details.
 *
 * @param event - The pi-ai streaming event
 */
function printEvent(event: AssistantMessageEvent): void {
    switch (event.type) {
        case "thinking_start":
            process.stdout.write(`${GRAY}${DIM}`);
            break;
        case "thinking_delta":
            process.stdout.write(event.delta);
            break;
        case "thinking_end":
            process.stdout.write(`${RESET}\n`);
            break;

        case "text_start":
            process.stdout.write(WHITE);
            break;
        case "text_delta":
            process.stdout.write(event.delta);
            break;
        case "text_end":
            process.stdout.write(`${RESET}\n`);
            break;

        case "toolcall_start":
            // Not printed — toolcall_end fires after the stream
            // finishes, so the header must go there too.
            break;
        case "toolcall_delta":
            // Skip raw delta fragments — we print the parsed result in toolcall_end
            break;
        case "toolcall_end": {
            const tc = event.toolCall;
            process.stdout.write(`\n${CYAN}🔧 calling tool...${RESET}\n`);
            process.stdout.write(`${CYAN}   name:  ${tc.name}${RESET}\n`);
            process.stdout.write(`${CYAN}   args:  ${YELLOW}${JSON.stringify(tc.arguments)}${RESET}\n`);
            break;
        }

        case "done":
            process.stdout.write(`\n${GREEN}✓ done (reason: ${event.reason})${RESET}\n`);
            break;

        case "error":
            process.stdout.write(`\n${YELLOW}✗ error: ${event.error.errorMessage || "unknown"}${RESET}\n`);
            break;

        case "start":
            // No output needed
            break;
    }
}

/**
 * Print a turn header to visually separate agentic turns.
 *
 * @param turnNumber - The 1-based turn number
 */
function printTurnHeader(turnNumber: number): void {
    process.stdout.write(`\n${MAGENTA}${BOLD}── Turn ${turnNumber} ──${RESET}\n`);
}

/**
 * Print a tool result block (simulated).
 *
 * @param toolCall - The tool call that was "executed"
 */
function printToolResult(toolCall: ToolCall): void {
    const result = fakeToolResult(toolCall);
    const firstContent = result.content[0];
    const displayText = firstContent.type === "text" ? firstContent.text : "(image)";
    process.stdout.write(`${GREEN}   → ${toolCall.name}: ${displayText}${RESET}\n`);
}

// ─── Fake tool results ──────────────────────────────────────────

/**
 * Generate a fake tool result for a tool call.
 *
 * Produces a plausible `ToolResultMessage` without executing
 * anything — this is a demo, not a real agent.
 *
 * @param toolCall - The tool call to generate a result for
 * @returns A ToolResultMessage with fake output
 */
function fakeToolResult(toolCall: ToolCall): ToolResultMessage {
    let resultText: string;
    switch (toolCall.name) {
        case "write_file":
            resultText = `File written: ${(toolCall.arguments as { path: string }).path}`;
            break;
        case "bash":
            resultText = `(output) ${(toolCall.arguments as { command: string }).command}`;
            break;
        case "read_file":
            resultText = "// file contents here";
            break;
        default:
            resultText = "ok";
    }

    return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: resultText }],
        isError: false,
        timestamp: Date.now(),
    };
}

// ─── Agentic loop ───────────────────────────────────────────────

/**
 * Run the agentic loop against the mock LLM server.
 *
 * Streams a response, and if the model emits tool calls, generates
 * fake results and sends them back for the next turn. Repeats
 * until the model produces a text-only response (stop_reason: "stop").
 *
 * @param label - A label for the demo
 * @param userMessage - The user message content (JSON for mock, or plain text)
 * @param maxTurns - Safety limit on agentic turns (default 10)
 */
async function runAgenticLoop(label: string, userMessage: string, maxTurns = 10): Promise<void> {
    process.stdout.write(`\n${GREEN}═══ ${label} ═══${RESET}\n`);

    const messages: Context["messages"] = [
        { role: "user", content: userMessage, timestamp: Date.now() },
    ];

    for (let turn = 1; turn <= maxTurns; turn++) {
        printTurnHeader(turn);

        const context: Context = {
            systemPrompt: "You are a helpful assistant.",
            messages,
        };

        const eventStream = stream(mockModel, context, {
            // Test-only mock key, not a real credential
            // oxlint-disable-next-line secure-coding/no-hardcoded-credentials
            apiKey: "sk-mock-key-for-e2e-tests",
        });

        let assistantMessage: AssistantMessage | null = null;

        for await (const event of eventStream) {
            printEvent(event);
            if (event.type === "done") {
                assistantMessage = event.message;
            } else if (event.type === "error") {
                return;
            }
        }

        if (!assistantMessage) break;

        // Add the assistant message to the conversation
        messages.push(assistantMessage);

        // Check if the model wants to call tools
        const toolCalls = assistantMessage.content.filter(
            (block): block is ToolCall => block.type === "toolCall",
        );

        if (toolCalls.length === 0) {
            // Text-only response — the loop is done
            break;
        }

        // Generate fake tool results and add them to the conversation
        process.stdout.write(`\n${MAGENTA}   ↳ sending tool results...${RESET}\n`);
        for (const tc of toolCalls) {
            printToolResult(tc);
            messages.push(fakeToolResult(tc));
        }
    }
}

// ─── Main ───────────────────────────────────────────────────────

async function main(): Promise<void> {
    process.stdout.write(`${CYAN}Mock LLM Server Demo — Agentic Loop${RESET}\n`);
    process.stdout.write(`${GRAY}Querying ${MOCK_BASE_URL} via pi-ai${RESET}\n`);

    // Demo 1: Legacy format — parallel tool calls, then text
    await runAgenticLoop(
        "Single tool call: write_file",
        mockTurnPlan({
            turns: [
                { tools: [{ name: "write_file", arguments: { path: "greeting.txt", content: "Hello from mock LLM!" } }], text: true },
                { text: true },
            ],
        }),
    );

    // Demo 2: Multi-turn — tool call → result → tool call → result → text
    await runAgenticLoop(
        "Multi-turn: write_file → bash → text",
        mockTurnPlan({
            turns: [
                { tools: [{ name: "write_file", arguments: { path: "notes.md", content: "# Notes\n\nWritten by mock LLM." } }], text: true },
                { tools: [{ name: "bash", arguments: { command: "echo 'File created successfully'" } }], text: true },
                { text: true },
            ],
        }),
    );

    // Demo 3: Multi-turn with sequential reasoning
    await runAgenticLoop(
        "Multi-turn: read_file → bash → text",
        mockTurnPlan({
            turns: [
                { tools: [{ name: "read_file", arguments: { path: "src/index.ts" } }] },
                { tools: [{ name: "bash", arguments: { command: "npm test" } }] },
                { text: true },
            ],
        }),
    );

    // Demo 4: Plain text (no tool calls)
    await runAgenticLoop(
        "Plain text (no tool calls)",
        "Just saying hello! No tools needed.",
    );
}

main().catch((err: unknown) => {
    console.error("Demo failed:", err);
    process.exit(1);
});
