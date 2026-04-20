/**
 * Title and tag generation for conversations.
 *
 * Uses the user's configured secondary model to auto-generate
 * a conversation title and tags after the first message exchange.
 * Falls back to the default model if no secondary model is set.
 *
 * Uses the pi-ai provider-agnostic API (complete()) with structured
 * tool-call output instead of free-form text parsing.
 */

import {
    complete,
    Type,
    type Context,
    type Model,
    type Tool,
    type ToolCall,
} from "@mariozechner/pi-ai";
import { getDb } from "../db/index.js";
import { findModelById, getModelRegistry, getSessionHistory } from "./session-store.js";

// --- Types ---

interface GenerateResult {
    title: string;
    tags: string[];
}

// --- Public API ---

/**
 * Generate a title and tags for a conversation using the secondary model.
 *
 * Reads the first user message from the session history, sends it to the
 * secondary model with a structured tool-call request, and returns the
 * result. Also updates the conversation in the DB.
 *
 * @param conversationId - The conversation to generate a title for
 * @param force - If true, regenerate even if the conversation already has a title
 */
export async function generateTitleAndTags(
    conversationId: string,
    force = false
): Promise<GenerateResult | null> {
    const db = getDb();

    // Check if this conversation already has a non-default title
    const conv = db
        .prepare("SELECT title FROM conversations WHERE id = ?")
        .get(conversationId) as { title: string } | undefined;

    if (!conv) return null;

    // Skip if already titled (not "New Chat") unless forced
    if (!force && conv.title !== "New Chat") return null;

    console.log(
        force
            ? "Force-regenerating title for conversation"
            : "Decided should generate title for conversation"
    );

    // Get the first user message content
    const userMessage = await extractFirstUserMessage(conversationId);
    console.log(`Extracted first user message: ${userMessage}`);
    if (!userMessage) return null;

    // Resolve the model to use
    const model = resolveTitleModel();
    if (!model) {
        console.warn(
            "[title-generator] No secondary or default model configured — skipping title generation"
        );
        return null;
    }

    try {
        const result = await callModelForTitle(model, userMessage);
        console.log(`Generated title: ${result.title}, tags: ${result.tags.join(", ")}`);

        // Update the conversation in DB
        db.prepare(
            "UPDATE conversations SET title = ?, tags = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(result.title, JSON.stringify(result.tags), conversationId);

        return result;
    } catch (err) {
        console.error("[title-generator] Failed to generate title:", err);
        return null;
    }
}

// --- Internal helpers ---

/**
 * Extract the first user message using getSessionHistory.
 */
async function extractFirstUserMessage(conversationId: string): Promise<string | null> {
    try {
        const history = await getSessionHistory(conversationId);
        const firstUserMsg = history.messages.find((msg) => msg.role === "user");
        if (firstUserMsg?.content) {
            return firstUserMsg.content.slice(0, 2000); // Truncate to avoid huge prompts
        }
    } catch {
        // History retrieval error
    }

    return null;
}

/**
 * Resolve which model to use for title generation.
 * Prefers the secondary model, falls back to the default model.
 * Uses findModelById (pi-ai ModelRegistry) as the single source of truth.
 */
function resolveTitleModel(): Model<any> | null {
    const db = getDb();
    const settingsRows = db.prepare("SELECT key, value FROM settings").all() as {
        key: string;
        value: string;
    }[];

    const settings: Record<string, string> = {};
    for (const row of settingsRows) {
        settings[row.key] = row.value;
    }

    // Try secondary model first, then fall back to default model
    let modelId = settings["secondaryModel"];
    if (!modelId) {
        modelId = settings["defaultModel"];
    }

    if (!modelId) return null;

    return findModelById(modelId) ?? null;
}

/**
 * Tool definition for structured title/tag output.
 * The model calls this tool instead of generating free-form text,
 * giving us a reliable, parseable result.
 */
const generateTitleTool: Tool = {
    name: "generate_conversation_title",
    description:
        "Generate a concise title and relevant tags for a chat conversation based on the user's first message.",
    parameters: Type.Object({
        title: Type.String({
            description: "A short, descriptive title for the conversation (3-6 words)",
        }),
        tags: Type.Array(Type.String({ description: "A relevant tag" }), {
            description: "1-3 relevant tags (single words or short phrases)",
            minItems: 1,
            maxItems: 5,
        }),
    }),
};

/**
 * Call the model via pi-ai's complete() to generate a title and tags.
 *
 * Uses structured tool-call output: instead of asking the model to
 * produce free-form JSON text, we define a tool with the exact schema
 * we want. The model calls the tool with structured arguments, which
 * we extract directly — no fragile text parsing needed.
 *
 * Note: complete() is a low-level pi-ai function that doesn't automatically
 * resolve API keys from ModelRegistry/AuthStorage. We must explicitly
 * resolve the key via ModelRegistry.getApiKeyAndHeaders() and pass it
 * in the options. (pi-coding-agent's AgentSession does this same
 * resolution internally before every request.)
 */
async function callModelForTitle(model: Model<any>, userMessage: string): Promise<GenerateResult> {
    // Resolve API key and headers from ModelRegistry
    const modelRegistry = getModelRegistry();
    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
        throw new Error(auth.error);
    }

    const systemPrompt = `You generate concise titles and relevant tags for chat conversations. Given the user's first message, call the generate_conversation_title tool with an appropriate title and tags. You MUST call the tool — do not respond with text.`;

    const context: Context = {
        systemPrompt,
        messages: [
            {
                role: "user",
                content: `First message in conversation:\n\n${userMessage}`,
                timestamp: Date.now(),
            },
        ],
        tools: [generateTitleTool],
    };

    const assistantMessage = await complete(model, context, {
        maxTokens: 200,
        temperature: 0.3,
        apiKey: auth.apiKey,
        headers: auth.headers,
        signal: AbortSignal.timeout(30_000),
    });

    // Extract the tool call from the response
    const toolCall = assistantMessage.content.find(
        (block): block is ToolCall => block.type === "toolCall"
    );

    if (toolCall && toolCall.name === "generate_conversation_title") {
        const args = toolCall.arguments as { title?: string; tags?: unknown[] };
        const title =
            typeof args.title === "string" ? args.title.trim().slice(0, 80) : "New Chat";
        const tags = Array.isArray(args.tags)
            ? args.tags
                .filter((t: unknown) => typeof t === "string")
                .map((t: string) => t.trim().toLowerCase())
                .slice(0, 5)
            : [];
        return { title, tags };
    }

    // Fallback: if the model didn't call the tool, try to parse any text content
    const textContent = assistantMessage.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("");

    if (textContent) {
        return parseModelResponse(textContent);
    }

    throw new Error(
        `Model did not call the generate_conversation_title tool and produced no text (stopReason: ${assistantMessage.stopReason}${assistantMessage.errorMessage ? `, error: ${assistantMessage.errorMessage}` : ""})`
    );
}

/**
 * Fallback: parse free-form text response into a title and tags.
 * Used when a model doesn't support tool calling and responds with text instead.
 */
function parseModelResponse(content: string): GenerateResult {
    // Try to extract JSON from the response (may have markdown wrapping)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        // Fallback: use the whole response as a title
        return { title: content.trim().slice(0, 80), tags: [] };
    }

    try {
        const parsed = JSON.parse(jsonMatch[0]) as { title?: string; tags?: string[] };
        const title =
            typeof parsed.title === "string" ? parsed.title.trim().slice(0, 80) : "New Chat";
        const tags = Array.isArray(parsed.tags)
            ? parsed.tags
                .filter((t: unknown) => typeof t === "string")
                .map((t: string) => t.trim().toLowerCase())
                .slice(0, 5)
            : [];
        return { title, tags };
    } catch {
        return { title: content.trim().slice(0, 80), tags: [] };
    }
}
