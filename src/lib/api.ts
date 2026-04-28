/**
 * API client for Vessel backend.
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

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(path, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...options?.headers,
        },
    });

    if (!res.ok) {
        if (res.status === 401) {
            window.location.href = "/login";
            throw new ApiError(401, "Unauthorized");
        }
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new ApiError(res.status, body.error || `HTTP ${res.status}`);
    }

    return res.json();
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
    updates: Partial<Pick<ConversationDetail, "title" | "tags" | "model_id">>
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

/**
 * Release the in-memory copy of a conversation's session on the server.
 * Does NOT delete any data on disk — the conversation can be rehydrated later.
 * Call this when the user closes the tab or ends their browser session.
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

export async function getConversationSettings(
    id: string
): Promise<Partial<ConversationSettings>> {
    return apiFetch<Partial<ConversationSettings>>(`/api/sessions/${id}/settings`);
}

export async function updateConversationSettings(
    id: string,
    settings: ConversationSettings
): Promise<{ success: boolean; restarted: boolean }> {
    return apiFetch<{ success: boolean; restarted: boolean }>(`/api/sessions/${id}/settings`, {
        method: "PUT",
        body: JSON.stringify(settings),
    });
}

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
 */
export async function listWorkspaceFiles(conversationId: string): Promise<WorkspaceFilesResult> {
    return apiFetch<WorkspaceFilesResult>(`/api/sessions/${conversationId}/workspace`);
}

/**
 * Delete a file from the agent's sandbox workspace.
 * @param path - File path relative to the workspace root
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
 */
export function uploadFile(
    conversationId: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void
): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
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
                    resolve(JSON.parse(xhr.responseText));
                } catch {
                    reject(new ApiError(xhr.status, "Invalid response"));
                }
            } else if (xhr.status === 401) {
                window.location.href = "/login";
                reject(new ApiError(401, "Unauthorized"));
            } else {
                try {
                    const body = JSON.parse(xhr.responseText);
                    reject(new ApiError(xhr.status, body.error || `HTTP ${xhr.status}`));
                } catch {
                    reject(new ApiError(xhr.status, `HTTP ${xhr.status}`));
                }
            }
        };

        xhr.onerror = () => reject(new ApiError(0, "Network error"));
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

export async function getSessionTree(conversationId: string): Promise<SessionTree> {
    return apiFetch<SessionTree>(`/api/sessions/${conversationId}/tree`);
}

export async function setSessionLeaf(conversationId: string, targetEntryId: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>(`/api/sessions/${conversationId}/set-leaf`, {
        method: "POST",
        body: JSON.stringify({ targetEntryId }),
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

export async function getMessageHistory(conversationId: string): Promise<MessageHistory> {
    return apiFetch<MessageHistory>(`/api/sessions/${conversationId}/messages`);
}

export async function abortGeneration(conversationId: string): Promise<{ aborted: boolean }> {
    return apiFetch<{ aborted: boolean }>(`/api/sessions/${conversationId}/abort`, {
        method: "POST",
    });
}

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

export async function listCustomModels(): Promise<CustomModelDef[]> {
    return apiFetch<CustomModelDef[]>("/api/models/custom");
}

export async function upsertCustomModel(model: CustomModelDef): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>("/api/models/custom", {
        method: "PUT",
        body: JSON.stringify(model),
    });
}

export async function deleteCustomModel(id: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>("/api/models/custom", {
        method: "DELETE",
        body: JSON.stringify({ id }),
    });
}

// --- Settings ---

export async function getSettings(): Promise<Record<string, string>> {
    return apiFetch<Record<string, string>>("/api/settings");
}

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

export async function listMcpServers(): Promise<McpServerInfo[]> {
    return apiFetch<McpServerInfo[]>("/api/mcp-servers");
}

export async function upsertMcpServer(
    name: string,
    config: McpServerEntry
): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>("/api/mcp-servers", {
        method: "PUT",
        body: JSON.stringify({ name, config }),
    });
}

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

export async function getMcpServerStatus(conversationId: string): Promise<McpServerStatus[]> {
    return apiFetch<McpServerStatus[]>(`/api/mcp-servers/status/${conversationId}`);
}

// --- Providers ---

export async function listProviders(): Promise<ProviderInfo[]> {
    return apiFetch<ProviderInfo[]>("/api/providers");
}

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

export async function deleteProvider(provider: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>("/api/providers", {
        method: "DELETE",
        body: JSON.stringify({ provider }),
    });
}

export async function fetchProviderModels(provider: string): Promise<{ models: string[] }> {
    return apiFetch<{ models: string[] }>(`/api/providers/${provider}/fetch-models`);
}

// --- Filesystem ---

export async function fsComplete(partial: string, type?: "file" | "directory" | "all"): Promise<{ completions: string[] }> {
    return apiFetch<{ completions: string[] }>("/api/fs-complete", {
        method: "POST",
        body: JSON.stringify({ partial, type }),
    });
}
