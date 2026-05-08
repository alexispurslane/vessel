/**
 * @file Client-side API functions for all Vessel backend endpoints.
 * All fetch calls go through here for consistent error handling.
 */
import type {
    AuthStatus,
    ConversationListItem,
    ConversationDetail,
    ProviderInfo,
    CustomModelDef,
    ModelInfo,
    ConversationSettings,
    FetchedSource,
} from "$lib/types.js";

class ApiError extends Error {
    constructor(
        public status: number,
        message: string
    ) {
        super(message);
        this.name = "ApiError";
    }
}

/**
 * Fetch a JSON API endpoint, throwing ApiError on non-OK responses.
 *
 * @param path - The API route path
 * @param options - Optional fetch options (method, body, etc.)
 * @returns The parsed JSON response
 */
async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(path, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options?.headers as Record<string, string>),
        },
    });

    if (!res.ok) {
        if (res.status === 401) {
            window.location.href = "/login";
            throw new ApiError(401, "Unauthorized");
        }
        /* eslint-disable @typescript-eslint/no-unsafe-assignment */
        const body: { error: string } = await res.json().catch((): { error: string } => ({ error: "Unknown error" }));
        /* eslint-enable @typescript-eslint/no-unsafe-assignment */
        throw new ApiError(res.status, body.error || `HTTP ${String(res.status)}`);
    }

    return res.json() as Promise<T>;
}

// --- Auth ---

export async function getAuthStatus(): Promise<AuthStatus> {
    return apiFetch<AuthStatus>("/api/auth/status");
}

export async function setupUser(username: string, password: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>("/api/auth/setup", {
        method: "POST",
        body: JSON.stringify({ username, password }),
    });
}

export async function login(username: string, password: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
    });
}

export async function logout(): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>("/api/auth/logout", {
        method: "POST",
    });
}

// --- User Info ---

export interface UserInfo {
    username: string;
    pronouns: string | null;
}

export interface UpdateUserBody {
    username?: string;
    currentPassword?: string;
    newPassword?: string;
    pronouns?: string | null;
}

export async function getUserInfo(): Promise<UserInfo> {
    return apiFetch<UserInfo>("/api/auth/user");
}

export async function updateUserInfo(body: UpdateUserBody): Promise<UserInfo & { success: boolean }> {
    return apiFetch<UserInfo & { success: boolean }>("/api/auth/user", {
        method: "PATCH",
        body: JSON.stringify(body),
    });
}

// --- Conversations / Sessions ---

export async function listConversations(): Promise<ConversationListItem[]> {
    return apiFetch<ConversationListItem[]>("/api/sessions");
}

export interface TagConversationsResult {
    tag: string;
    conversations: ConversationListItem[];
}

export async function listConversationsByTag(tag: string): Promise<TagConversationsResult> {
    return apiFetch<TagConversationsResult>(`/api/tags/${encodeURIComponent(tag)}`);
}

export async function createConversation(
    title?: string,
    modelId?: string
): Promise<{ id: string }> {
    return apiFetch<{ id: string }>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ title, model_id: modelId }),
    });
}

export async function getConversation(id: string): Promise<ConversationDetail> {
    return apiFetch<ConversationDetail>(`/api/sessions/${id}`);
}

export async function updateConversation(
    id: string,
    updates: Partial<Pick<ConversationDetail, "title" | "tags" | "model_id" | "pinned" | "archived">>
): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>(`/api/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
    });
}

export async function deleteConversation(id: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>(`/api/sessions/${id}`, {
        method: "DELETE",
    });
}

// --- Bulk Operations ---

/** Action type for the bulk endpoint. */
export type BulkAction = "archive" | "unarchive" | "delete" | "tag";

/** Result returned by the bulk endpoint. */
export interface BulkResult {
    action: BulkAction;
    succeeded: number;
    failed: number;
    failures?: Array<{ id: string; error: string }>;
}

/**
 * Perform a batch action on multiple conversations.
 *
 * @param ids - Conversation IDs to act on (1–100)
 * @param action - The bulk action to perform
 * @param tags - Tags to add (required when action is "tag")
 * @returns Result with success/failure counts
 */
export async function bulkConversationAction(
    ids: string[],
    action: BulkAction,
    tags?: string[]
): Promise<BulkResult> {
    return apiFetch<BulkResult>("/api/sessions/bulk", {
        method: "POST",
        body: JSON.stringify({ ids, action, tags }),
    });
}

// --- Search ---

export interface ConversationSearchResult {
    id: string;
    title: string;
    tags: string[];
    archived: boolean;
    updatedAt: string;
    matchSource: "title" | "content" | "both";
    snippets: Array<{ text: string; messageId: string | null }>;
}

/**
 * Search conversations by text query.
 *
 * @param query - The search string
 * @param limit - Optional max results
 * @returns Matching conversation search results
 */
export async function searchConversations(query: string, limit?: number): Promise<ConversationSearchResult[]> {
    const params = new URLSearchParams({ q: query });
    if (limit) params.set("limit", String(limit));
    return apiFetch<ConversationSearchResult[]>(`/api/sessions/search?${params}`);
}

/**
 * Release the in-memory copy of a conversation's session on the server.
 * Does NOT delete any data on disk — the conversation can be rehydrated later.
 * Call this when the user closes the tab or ends their browser session.
 *
 * @param id - The conversation ID to release
 * @returns Whether the conversation was successfully released
 */
export async function releaseConversation(id: string): Promise<{ released: boolean }> {
    try {
        return await apiFetch<{ released: boolean }>(`/api/sessions/${id}/release`, {
            method: "POST",
        });
    } catch {
        // Best-effort — if the server is unreachable or the session
        // isn't loaded, that's fine. The idle timeout will clean up eventually.
        return { released: false };
    }
}

/**
 * Get per-conversation settings (sandbox, network, MCP, etc.).
 *
 * @param id - The conversation ID
 * @returns Partial conversation settings (may be empty if no custom settings)
 */
export async function getConversationSettings(
    id: string
): Promise<Partial<ConversationSettings>> {
    return apiFetch<Partial<ConversationSettings>>(`/api/sessions/${id}/settings`);
}

/**
 * Update per-conversation settings.
 *
 * @param id - The conversation ID
 * @param settings - The new settings to apply
 * @returns Success flag and whether the session was restarted
 */
export async function updateConversationSettings(
    id: string,
    settings: ConversationSettings
): Promise<{ success: boolean; restarted: boolean }> {
    return apiFetch<{ success: boolean; restarted: boolean }>(`/api/sessions/${id}/settings`, {
        method: "PUT",
        body: JSON.stringify(settings),
    });
}

/**
 * Send a user message to a conversation's active session.
 *
 * @param conversationId - The conversation ID
 * @param content - The message text
 * @param modelId - Optional model override for this message
 * @param statusContent - Optional status content for file attachments
 * @returns Whether the message was accepted
 */
export async function sendMessage(
    conversationId: string,
    content: string,
    modelId?: string,
    statusContent?: string
): Promise<{ accepted: boolean }> {
    const body: Record<string, unknown> = { content };
    if (modelId) body.model_id = modelId;
    if (statusContent) body.status_content = statusContent;
    return apiFetch<{ accepted: boolean }>(`/api/sessions/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify(body),
    });
}

/**
 * Navigate the session tree to a target entry (for delete/edit operations).
 * Moves the conversation's current position back to before the target message.
 * For user messages, returns the message text for editing.
 *
 * @param conversationId - The conversation ID
 * @param targetEntryId - The entry ID to navigate to
 * @returns Editor text for user messages, and whether navigation was cancelled
 */
export async function navigateMessage(
    conversationId: string,
    targetEntryId: string
): Promise<{ editorText?: string; cancelled: boolean }> {
    return apiFetch<{ editorText?: string; cancelled: boolean }>(
        `/api/sessions/${conversationId}/navigate`,
        {
            method: "POST",
            body: JSON.stringify({ targetEntryId }),
        }
    );
}

/**
 * In-place edit of an assistant message in the session tree.
 * Navigates back, appends the edited message, then replays all subsequent entries.
 * Does NOT trigger a new AI generation.
 *
 * @param conversationId - The conversation ID
 * @param targetEntryId - The assistant message entry ID to edit
 * @param newContent - The replacement text
 * @returns Whether the edit was cancelled
 */
export async function editAssistantMessage(
    conversationId: string,
    targetEntryId: string,
    newContent: string
): Promise<{ cancelled: boolean }> {
    return apiFetch<{ cancelled: boolean }>(
        `/api/sessions/${conversationId}/edit-assistant`,
        {
            method: "POST",
            body: JSON.stringify({ targetEntryId, newContent }),
        }
    );
}

/**
 * Regenerate an assistant message with user feedback.
 * Navigates back, sends the critique as a hidden custom message, and
 * triggers a new LLM turn to generate a corrected response.
 *
 * @param conversationId - The conversation ID
 * @param targetEntryId - The assistant message entry ID to regenerate
 * @param feedback - The user's critique/feedback text
 * @returns Whether the regeneration was cancelled
 */
export async function regenWithFeedback(
    conversationId: string,
    targetEntryId: string,
    feedback: string
): Promise<{ cancelled: boolean }> {
    return apiFetch<{ cancelled: boolean }>(
        `/api/sessions/${conversationId}/regen-with-feedback`,
        {
            method: "POST",
            body: JSON.stringify({ targetEntryId, feedback }),
        }
    );
}

// --- File Upload ---

export interface UploadResult {
    success: boolean;
    filename: string;
    path: string;
}

export interface WorkspaceFilesResult {
    files: string[];
}

/**
 * List files in the agent's sandbox workspace.
 * Returns an array of file paths relative to the workspace root.
 *
 * @param conversationId - The conversation ID
 * @returns Object with array of workspace file paths
 */
export async function listWorkspaceFiles(conversationId: string): Promise<WorkspaceFilesResult> {
    return apiFetch<WorkspaceFilesResult>(`/api/sessions/${conversationId}/workspace`);
}

/**
 * Download a file from the agent's sandbox workspace.
 * Triggers a browser download of the file at the given path.
 * @param conversationId - The conversation/session ID
 * @param path - File path relative to the workspace root
 */
export function downloadWorkspaceFile(conversationId: string, path: string): void {
    const url = `/api/sessions/${conversationId}/workspace/download?path=${encodeURIComponent(path)}`;
    // Use an invisible <a> to trigger the download without navigating away
    const a = document.createElement("a");
    a.href = url;
    a.download = ""; // Let the server's Content-Disposition header set the filename
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

/**
 * Delete a file from the agent's sandbox workspace.
 *
 * @param conversationId - The conversation ID
 * @param path - File path relative to the workspace root
 * @returns Whether the deletion succeeded
 */
export async function deleteWorkspaceFile(
    conversationId: string,
    path: string
): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>(`/api/sessions/${conversationId}/workspace`, {
        method: "DELETE",
        body: JSON.stringify({ path }),
    });
}

/**
 * Upload a file to the agent's sandbox workspace using streaming (no size limits).
 * Uses XMLHttpRequest to support upload progress reporting.
 * No encoding overhead — bytes go straight to disk.
 *
 * @param conversationId - The conversation ID
 * @param file - The file to upload
 * @param onProgress - Optional callback for upload progress
 * @returns Upload result with filename and path
 */
export function uploadFile(
    conversationId: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void
): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
        // oxlint-disable-next-line secure-coding/no-xxe-injection -- XHR upload, not XML
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/sessions/${conversationId}/upload`);
        xhr.setRequestHeader("X-Filename", file.name);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
                onProgress(e.loaded, e.total);
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    resolve(JSON.parse(xhr.responseText) as UploadResult);
                } catch {
                    reject(new ApiError(xhr.status, "Invalid response"));
                }
            } else if (xhr.status === 401) {
                window.location.href = "/login";
                reject(new ApiError(401, "Unauthorized"));
            } else {
                try {
                    const body = JSON.parse(xhr.responseText) as { error?: string };
                    reject(new ApiError(xhr.status, body.error || `HTTP ${String(xhr.status)}`));
                } catch {
                    reject(new ApiError(xhr.status, `HTTP ${String(xhr.status)}`));
                }
            }
        };

        xhr.onerror = () => { reject(new ApiError(0, "Network error")); };
        xhr.send(file);
    });
}

// --- Agent Info ---

export interface AgentToolInfo {
    name: string;
    description: string;
    source: string;
    scope: string;
}

export interface AgentSkillInfo {
    name: string;
    description: string;
    source: string;
    scope: string;
    disableModelInvocation: boolean;
}

export interface AgentInfo {
    systemPrompt: string;
    tools: AgentToolInfo[];
    skills: AgentSkillInfo[];
    /** Custom system prompt from conversation settings (null = use default) */
    customSystemPrompt?: string | null;
    /** Appended system prompt instructions from conversation settings (null = nothing appended) */
    appendSystemPrompt?: string[] | null;
}

/**
 * Get agent info (tools, skills, system prompt) for an active session.
 *
 * @param conversationId - The conversation ID
 * @returns Agent info, or null if the session is not active
 */
export async function getSessionAgentInfo(conversationId: string): Promise<AgentInfo | null> {
    try {
        return await apiFetch<AgentInfo>(`/api/sessions/${conversationId}/agent-info`);
    } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
            return null;
        }
        throw e;
    }
}

export interface UpdateSystemPromptResult {
    success: boolean;
    info: AgentInfo;
}

/**
 * Update the system prompt for an active session.
 *
 * @param conversationId - The conversation ID
 * @param options - Custom and/or appended system prompt overrides
 * @param options.customSystemPrompt - Override the system prompt
 * @param options.appendSystemPrompt - Append instructions to the system prompt
 * @returns Updated agent info
 */
export async function updateSessionSystemPrompt(
    conversationId: string,
    options: {
        customSystemPrompt?: string | null;
        appendSystemPrompt?: string[] | null;
    }
): Promise<UpdateSystemPromptResult> {
    return apiFetch<UpdateSystemPromptResult>(`/api/sessions/${conversationId}/agent-info`, {
        method: "PATCH",
        body: JSON.stringify(options),
    });
}

// --- Session Tree DAG ---

export interface SessionTreeNodeData {
    id: string;
    parentId: string | null;
    type: string;
    role?: string;
    preview: string;
    fullContent: string;
    onActiveBranch: boolean;
    isCurrentLeaf: boolean;
}

export interface SessionTreeRelation {
    id: string;
    parentId: string;
    childId: string;
}

export interface SessionTree {
    nodes: SessionTreeNodeData[];
    relations: SessionTreeRelation[];
    leafId: string | null;
}

/**
 * Get the session tree (DAG) for a conversation.
 *
 * @param conversationId - The conversation ID
 * @returns The session tree with nodes and relations
 */
export async function getSessionTree(conversationId: string): Promise<SessionTree> {
    return apiFetch<SessionTree>(`/api/sessions/${conversationId}/tree`);
}

/**
 * Set the current leaf of the session tree.
 *
 * @param conversationId - The conversation ID
 * @param targetEntryId - The entry ID to set as the new leaf
 * @returns Whether the operation succeeded
 */
export async function setSessionLeaf(conversationId: string, targetEntryId: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>(`/api/sessions/${conversationId}/set-leaf`, {
        method: "POST",
        body: JSON.stringify({ targetEntryId }),
    });
}

/**
 * Fork a conversation before a specific entry.
 *
 * Creates a new conversation whose session contains the history
 * from root up to and including the parent of the specified entry,
 * capturing any custom messages (fetched sources, etc.) in between.
 *
 * @param conversationId - The conversation ID to fork from
 * @param beforeEntryId - The entry ID to fork before (its parent becomes the fork leaf)
 * @returns The new conversation ID
 */
export async function forkConversation(conversationId: string, beforeEntryId: string): Promise<{ id: string }> {
    return apiFetch<{ id: string }>(`/api/sessions/${conversationId}/fork`, {
        method: "POST",
        body: JSON.stringify({ beforeEntryId }),
    });
}

export interface MessageHistoryItem {
    id: string;
    role: string;
    content: string;
    thinking?: string;
    model?: string;
    modelProvider?: string;
    toolCalls?: Array<{
        toolName: string;
        status: string;
        output?: string;
        arguments?: Record<string, unknown>;
    }>;
    isError?: boolean;
    errorMessage?: string;
    usage?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        totalTokens: number;
    };
    timestamp: number;
    fetchedSources?: FetchedSource[];
}

export interface MessageHistory {
    messages: MessageHistoryItem[];
    model: { provider: string; modelId: string } | null;
}

/**
 * Get the full message history for a conversation.
 *
 * @param conversationId - The conversation ID
 * @returns The message history with model info
 */
export async function getMessageHistory(conversationId: string): Promise<MessageHistory> {
    return apiFetch<MessageHistory>(`/api/sessions/${conversationId}/messages`);
}

/**
 * Abort an in-progress generation for a conversation.
 *
 * @param conversationId - The conversation ID
 * @returns Whether the generation was aborted
 */
export async function abortGeneration(conversationId: string): Promise<{ aborted: boolean }> {
    return apiFetch<{ aborted: boolean }>(`/api/sessions/${conversationId}/abort`, {
        method: "POST",
    });
}

/**
 * Restart all server-side sessions.
 *
 * @returns Number of sessions restarted
 */
export async function restartAllSessions(): Promise<{ restarted: number }> {
    return apiFetch<{ restarted: number }>("/api/sessions/restart-all", {
        method: "POST",
    });
}

export interface GenerateTitleResult {
    generated: boolean;
    title?: string;
    tags?: string[];
}

/**
 * Generate a title and tags for a conversation.
 *
 * @param conversationId - The conversation ID
 * @param options - Optional force flag to regenerate even if titled
 * @param options.force - Force regeneration even if already titled
 * @returns Generation result with optional title and tags
 */
export async function generateTitle(
    conversationId: string,
    options?: { force?: boolean }
): Promise<GenerateTitleResult> {
    return apiFetch<GenerateTitleResult>(`/api/sessions/${conversationId}/generate-title`, {
        method: "POST",
        body: JSON.stringify({ force: options?.force ?? false }),
    });
}

// --- Models ---

/** Model info returned by GET /api/models/[modelId] */
export interface ResolvedModelInfo {
    provider: string;
    modelId: string;
    name: string;
    api: string;
    reasoning: boolean;
    input: string[];
    contextWindow: number;
    maxTokens: number;
}

/**
 * List all available models (built-in + custom).
 *
 * @returns Array of model info objects
 */
export async function listModels(): Promise<ModelInfo[]> {
    return apiFetch<ModelInfo[]>("/api/models");
}

/**
 * Look up a model's full info (including provider) from just its model ID.
 * This is the frontend implementation of the "model ID → provider" pattern.
 *
 * @param modelId - The model ID to look up
 * @returns The resolved model info, or null if not found
 */
export async function getModelInfo(modelId: string): Promise<ResolvedModelInfo | null> {
    try {
        return await apiFetch<ResolvedModelInfo>(`/api/models/${encodeURIComponent(modelId)}`);
    } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
            return null;
        }
        throw e;
    }
}

/**
 * List user-defined custom models.
 *
 * @returns Array of custom model definitions
 */
export async function listCustomModels(): Promise<CustomModelDef[]> {
    return apiFetch<CustomModelDef[]>("/api/models/custom");
}

/**
 * Create or update a custom model definition.
 *
 * @param model - The custom model to upsert
 * @returns Whether the operation succeeded
 */
export async function upsertCustomModel(model: CustomModelDef): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>("/api/models/custom", {
        method: "PUT",
        body: JSON.stringify(model),
    });
}

/**
 * Delete a custom model by ID.
 *
 * @param id - The custom model ID to delete
 * @returns Whether the deletion succeeded
 */
export async function deleteCustomModel(id: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>("/api/models/custom", {
        method: "DELETE",
        body: JSON.stringify({ id }),
    });
}

// --- Settings ---

/**
 * Get all app settings as key-value pairs.
 *
 * @returns Settings map
 */
export async function getSettings(): Promise<Record<string, string>> {
    return apiFetch<Record<string, string>>("/api/settings");
}

/**
 * Update app settings.
 *
 * @param settings - Key-value pairs to update
 * @returns Whether the update succeeded
 */
export async function updateSettings(
    settings: Record<string, string>
): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
    });
}

// --- MCP Servers ---

/** MCP server entry matching the Claude-like JSON config syntax */
export interface McpServerEntry {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
    auth?: "oauth" | "bearer" | false;
    bearerToken?: string;
    lifecycle?: "keep-alive" | "lazy" | "eager";
    idleTimeout?: number;
    exposeResources?: boolean;
    directTools?: boolean | string[];
    excludeTools?: string[];
    debug?: boolean;
    /** Whether this server is enabled by default in new conversations (default: true) */
    defaultEnabled?: boolean;
}

export interface McpServerInfo {
    name: string;
    config: McpServerEntry;
}

/**
 * List all configured MCP servers.
 *
 * @returns Array of MCP server info
 */
export async function listMcpServers(): Promise<McpServerInfo[]> {
    return apiFetch<McpServerInfo[]>("/api/mcp-servers");
}

/**
 * Create or update an MCP server configuration.
 *
 * @param name - The server name
 * @param config - The server configuration
 * @returns Whether the operation succeeded
 */
export async function upsertMcpServer(
    name: string,
    config: McpServerEntry
): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>("/api/mcp-servers", {
        method: "PUT",
        body: JSON.stringify({ name, config }),
    });
}

/**
 * Delete an MCP server by name.
 *
 * @param name - The server name to delete
 * @returns Whether the deletion succeeded
 */
export async function deleteMcpServer(name: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>("/api/mcp-servers", {
        method: "DELETE",
        body: JSON.stringify({ name }),
    });
}

export interface McpServerStatus {
    name: string;
    status: "connected" | "closed" | "needs-auth" | "unknown";
    toolCount?: number;
}

/**
 * Get MCP server connection status for a conversation.
 *
 * @param conversationId - The conversation ID
 * @returns Array of MCP server status objects
 */
export async function getMcpServerStatus(conversationId: string): Promise<McpServerStatus[]> {
    return apiFetch<McpServerStatus[]>(`/api/mcp-servers/status/${conversationId}`);
}

// --- Providers ---

/**
 * List all configured providers.
 *
 * @returns Array of provider info objects
 */
export async function listProviders(): Promise<ProviderInfo[]> {
    return apiFetch<ProviderInfo[]>("/api/providers");
}

/**
 * Create or update a provider with API key and optional overrides.
 *
 * @param provider - The provider ID
 * @param key - The API key
 * @param opts - Optional base URL, display name, models endpoint
 * @param opts.baseUrl - Override the provider's base URL
 * @param opts.displayName - Human-readable display name
 * @param opts.modelsEndpoint - Override the models listing endpoint
 * @returns Whether the operation succeeded
 */
export async function upsertProvider(
    provider: string,
    key: string,
    opts?: { baseUrl?: string; displayName?: string; modelsEndpoint?: string }
): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>("/api/providers", {
        method: "PUT",
        body: JSON.stringify({
            provider,
            key,
            base_url: opts?.baseUrl,
            display_name: opts?.displayName,
            models_endpoint: opts?.modelsEndpoint,
        }),
    });
}

/**
 * Delete a provider by ID.
 *
 * @param provider - The provider ID to delete
 * @returns Whether the deletion succeeded
 */
export async function deleteProvider(provider: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>("/api/providers", {
        method: "DELETE",
        body: JSON.stringify({ provider }),
    });
}

/**
 * Fetch available model IDs from a provider's API.
 *
 * @param provider - The provider ID
 * @returns Array of model ID strings
 */
export async function fetchProviderModels(provider: string): Promise<{ models: string[] }> {
    return apiFetch<{ models: string[] }>(`/api/providers/${provider}/fetch-models`);
}

/**
 * Check if a base URL is accessible.
 *
 * @param url - The URL to check
 * @returns Accessibility result with optional error message
 */
export async function checkBaseUrl(
    url: string
): Promise<{ accessible: boolean; error?: string }> {
    return apiFetch<{ accessible: boolean; error?: string }>('/api/providers/check-url', {
        method: 'POST',
        body: JSON.stringify({ url }),
    });
}

// --- Filesystem ---

/**
 * Get filesystem path completions for a partial path.
 *
 * @param partial - The partial path to complete
 * @param type - Optional filter: "file", "directory", or "all"
 * @returns Array of completion paths
 */
export async function fsComplete(partial: string, type?: "file" | "directory" | "all"): Promise<{ completions: string[] }> {
    return apiFetch<{ completions: string[] }>('/api/fs-complete', {
        method: 'POST',
        body: JSON.stringify({ partial, type }),
    });
}

/** Supported export formats */
export type ExportFormat = "pdf" | "markdown" | "json";

/** Options controlling what content is included in an export. */
export interface ExportOptions {
    /** Whether to include thinking/reasoning content from assistant messages */
    includeThinking?: boolean;
    /** Whether to include tool call details */
    includeToolCalls?: boolean;
}

/**
 * Trigger a download of a conversation in the specified format.
 *
 * Creates a temporary anchor element pointing to the server-side
 * export endpoint and clicks it, causing the browser to download
 * the file. The anchor is removed immediately after.
 *
 * @param conversationId - The conversation to export
 * @param format - The export format: "pdf", "markdown", or "json"
 * @param options - Export content options (thinking, tool calls)
 */
export function exportConversation(conversationId: string, format: ExportFormat, options: ExportOptions = {}): void {
    const params = new URLSearchParams({ format });
    if (options.includeThinking) params.set("includeThinking", "true");
    if (options.includeToolCalls) params.set("includeToolCalls", "true");
    const url = `/api/sessions/${conversationId}/export?${params.toString()}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
