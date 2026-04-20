/**
 * Conversations store — tracks the sidebar conversation list.
 */
import {
    listConversations as apiList,
    createConversation as apiCreate,
    deleteConversation as apiDelete,
    updateConversation as apiUpdate,
} from "$lib/api.js";
import type { ConversationListItem } from "$lib/types.js";

let conversations = $state<ConversationListItem[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);
let activeId = $state<string | null>(null);

/** Incremented each time loadConversations is called, so stale async results are discarded. */
let loadGeneration = 0;

export function getConversations() {
    return {
        get list() {
            return conversations;
        },
        get loading() {
            return loading;
        },
        get error() {
            return error;
        },
        get activeId() {
            return activeId;
        },
        get activeConversation() {
            return conversations.find((c) => c.id === activeId) ?? null;
        },
    };
}

export async function loadConversations(): Promise<void> {
    loading = true;
    error = null;
    const thisGeneration = ++loadGeneration;
    try {
        const result = await apiList();
        // If another load was started while we awaited, discard this result
        if (thisGeneration !== loadGeneration) return;
        conversations = result;
    } catch (e) {
        if (thisGeneration !== loadGeneration) return;
        error = e instanceof Error ? e.message : "Failed to load conversations";
    } finally {
        if (thisGeneration === loadGeneration) {
            loading = false;
        }
    }
}

export async function createConversation(title?: string, modelId?: string): Promise<string | null> {
    error = null;
    try {
        const { id } = await apiCreate(title, modelId);
        // Optimistically add to the list — but only if not already present
        // (e.g. a concurrent loadConversations may have already included it)
        if (!conversations.some((c) => c.id === id)) {
            conversations.unshift({
                id,
                title: title ?? "New Chat",
                tags: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
        }
        activeId = id;
        return id;
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to create conversation";
        return null;
    }
}

export async function deleteConversation(id: string): Promise<boolean> {
    error = null;
    try {
        await apiDelete(id);
        conversations = conversations.filter((c) => c.id !== id);
        if (activeId === id) {
            activeId = conversations[0]?.id ?? null;
        }
        return true;
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to delete conversation";
        return false;
    }
}

export async function renameConversation(id: string, title: string): Promise<boolean> {
    error = null;
    try {
        await apiUpdate(id, { title });
        const conv = conversations.find((c) => c.id === id);
        if (conv) conv.title = title;
        return true;
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to rename conversation";
        return false;
    }
}

/**
 * Update a conversation's title and tags locally (e.g., after auto-generation).
 * Does NOT call the API since the server already updated the DB.
 */
export function updateConversationTitleAndTags(id: string, title: string, tags: string[]): void {
    const conv = conversations.find((c) => c.id === id);
    if (conv) {
        conv.title = title;
        conv.tags = tags;
    }
}

export function setActiveConversation(id: string | null): void {
    activeId = id;
}

export function clearError(): void {
    error = null;
}
