/**
 * Shared domain types for TalkAI.
 *
 * These types are used by both the frontend and backend.
 * Server-only types (Pi re-exports, ActiveSession) live in
 * $lib/server/agent/types.ts and import from here.
 */

// --- Auth ---

/** Auth status returned by GET /api/auth/status */
export interface AuthStatus {
    setup: boolean;
    authenticated: boolean;
    username?: string;
}

// --- Conversations ---

/** Conversation list item (for sidebar) */
export interface ConversationListItem {
    id: string;
    title: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
}

/** Conversation metadata stored in our DB */
export interface ConversationMeta {
    id: string;
    title: string;
    tags: string[];
    sessionFilePath: string;
    modelProvider?: string;
    modelId?: string;
    createdAt: string;
    updatedAt: string;
}

/** Conversation detail returned by GET /api/sessions/[id] */
export interface ConversationDetail {
    id: string;
    title: string;
    tags: string[];
    model_provider: string | null;
    model_id: string | null;
    created_at: string;
    updated_at: string;
}

// --- SSE ---

/** A single SSE event pushed to the client */
export interface ChatSSEEvent {
    /** Monotonically increasing ID for Last-Event-Id reconnection */
    id: string;
    /** The pi event type (message_update, tool_execution_start, etc.) */
    event: string;
    /** Serialized event payload */
    data: unknown;
}

// --- Providers ---

/** Provider info returned to the client (key masked) */
export interface ProviderInfo {
    provider: string;
    displayName?: string;
    baseUrl?: string;
    modelsEndpoint?: string;
    hasKey: boolean;
}

// --- Models ---

/** Custom model definition stored in our DB */
export interface CustomModelDef {
    id: string;
    provider: string;
    name: string;
    api: string;
    baseUrl: string;
    reasoning: boolean;
    inputTypes: string[];
    contextWindow: number;
    maxTokens: number;
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    };
    compat?: Record<string, unknown>;
}

/** Model info from GET /api/models */
export interface ModelInfo {
    id: string;
    name: string;
    provider: string;
    api: string;
    reasoning: boolean;
    input: ("text" | "image")[];
    contextWindow: number;
    maxTokens: number;
}

// --- Chat UI (client-only, but defined here for consistency) ---

/** A chat message in the UI */
export interface ChatMessage {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    /** For assistant messages: intermediate state like tool calls */
    toolCalls?: ToolCallInfo[];
    /** For assistant messages: thinking/reasoning content from the model */
    thinking?: string;
    /** Whether thinking is still in progress */
    thinkingStreaming?: boolean;
    /** For assistant messages: the model that generated this response */
    model?: string;
    /** For assistant messages: the provider of the model */
    modelProvider?: string;
    /** Whether the message is still being streamed */
    streaming?: boolean;
    /** Whether this message represents an error from the provider */
    isError?: boolean;
}

/** Info about a tool call being executed */
export interface ToolCallInfo {
    toolName: string;
    status: "running" | "completed" | "error";
    output?: string;
    isError?: boolean;
}
