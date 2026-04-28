/**
 * Shared domain types for Vessel.
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

// --- Conversation Settings ---

/** Per-conversation settings stored as JSON in the conversation_settings table. */
export interface ConversationSettings {
    /** Whether the sandbox is enabled for this conversation (null = use global default) */
    sandboxEnabled?: boolean | null;
    /** Extra readable paths for the sandbox (null = use global default) */
    extraReadPaths?: string[] | null;
    /** Extra writable paths for the sandbox (null = use global default) */
    extraWritePaths?: string[] | null;
    /** Whether network access is allowed (null = use global default) */
    allowNet?: boolean | null;
    /** Whether all domains are allowed when network is on (null = use global default, true = all domains, false = specific domains only) */
    allowAllDomains?: boolean | null;
    /** Allowed network domains when allowNet is truthy and allowAllDomains is false (null = use global default) */
    allowedNetDomains?: string[] | null;
    /** Secrets to inject into the sandbox (null = use global default) */
    secrets?: Record<string, { value: string; hosts: string[] }> | null;
    /** Environment variable names to allow in the sandbox (null = use global default) */
    allowEnv?: string[] | null;
    /** Whether to delete the workspace when the conversation is trashed */
    deleteWorkspaceWithConversation?: boolean;
    /** Conversation mode: "agent" = all tools enabled, "chat" = no tools (plain chat). null = inherit global default. */
    agentMode?: "agent" | "chat" | null;
    /** Custom system prompt that replaces the default (null = use default). Use with caution — overrides tool descriptions and guidelines. */
    customSystemPrompt?: string | null;
    /** List of instruction strings appended to the default system prompt (null = nothing appended). Each item is a separate instruction. */
    appendSystemPrompt?: string[] | null;
    /** MCP server names to enable for this conversation (null = use per-server defaultEnabled, empty = none) */
    enabledMcpServers?: string[] | null;
}

/** Default values for per-conversation settings. Null fields inherit from global settings. */
export const DEFAULT_CONVERSATION_SETTINGS: ConversationSettings = {
    sandboxEnabled: null,
    extraReadPaths: null,
    extraWritePaths: null,
    allowNet: null,
    allowAllDomains: null,
    allowedNetDomains: null,
    secrets: null,
    allowEnv: null,
    deleteWorkspaceWithConversation: true,
    agentMode: null,
    customSystemPrompt: null,
    appendSystemPrompt: null,
    enabledMcpServers: null,
};

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
    input: ("text" | "image" | "video")[];
    contextWindow: number;
    maxTokens: number;
}

// --- Chat UI (client-only, but defined here for consistency) ---

/** A single search result from a web search */
export interface SearchResultItem {
    url: string;
    title: string;
    text?: string;
    publishedDate?: string;
}

/** A source the agent consulted during a turn (fetched page or web search) */
export type FetchedSource =
    | { type: "page"; url: string; title: string; contentLength: number; truncated: boolean; content: string; turn: number }
    | { type: "search"; query: string; resultCount: number; results: SearchResultItem[]; turn: number };

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
    /** Token usage data from the model provider (assistant messages only) */
    usage?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        totalTokens: number;
    };
    /** Sources consulted by the agent (fetched pages & web searches) since the last assistant message */
    fetchedSources?: FetchedSource[];
}

/** Info about a tool call being executed */
export interface ToolCallInfo {
    toolName: string;
    status: "running" | "completed" | "error";
    output?: string;
    isError?: boolean;
    /** The arguments the tool was called with, as parsed JSON */
    arguments?: Record<string, unknown>;
}

/** A single step within a thinking group — either a thinking text chunk or a tool call */
export interface ThinkingStep {
    /** Unique ID for this step */
    id: string;
    /** The message this step came from */
    messageId: string;
    type: "thinking" | "toolCall";
    /** For thinking steps: the reasoning text */
    thinking?: string;
    /** For toolCall steps: the tool call info */
    toolCall?: ToolCallInfo;
    /** Whether this step's content is still streaming */
    streaming?: boolean;
}

/** A group of consecutive assistant messages that are "intermediate" — thinking + tool calls
 *  with no visible text content for the user. Displayed as a single collapsible block
 *  showing the full interleaved trace of reasoning and tool use. */
export interface ThinkingGroup {
    type: "thinkingGroup";
    /** Unique ID for this group (derived from first message ID) */
    id: string;
    /** The ordered steps within this group (thinking chunks + tool calls, interleaved) */
    steps: ThinkingStep[];
    /** Whether any step in this group is still streaming */
    streaming: boolean;
    /** The model used for these steps */
    model?: string;
    /** The provider of the model */
    modelProvider?: string;
    /** Message IDs in this group, for delete/edit callbacks */
    messageIds: string[];
}

/** A renderable item in the chat view — either a single message or a grouped thinking block */
export type RenderItem =
    | { type: "message"; msg: ChatMessage }
    | ThinkingGroup;
