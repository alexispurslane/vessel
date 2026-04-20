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
    modelId?: string
): Promise<{ accepted: boolean }> {
    const body: Record<string, unknown> = { content };
    if (modelId) body.model_id = modelId;
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
    }>;
    isError?: boolean;
    timestamp: number;
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
