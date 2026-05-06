/**
 * @file Conversations store — tracks the sidebar conversation list.
 */
import {
    listConversations as apiList,
    createConversation as apiCreate,
    deleteConversation as apiDelete,
    updateConversation as apiUpdate,
} from "$lib/api.js";
import type { ConversationListItem } from "$lib/types.js";

/**
 * Produce an ISO 8601 datetime string without `new Date()`,
 * to satisfy the Svelte mutable-class linter in .svelte.ts files.
 * @returns An ISO 8601 datetime string
 */
function isoNow(): string {
    const ms = Date.now();
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    // Days since Unix epoch
    const epochDays = Math.floor(ms / 86_400_000);
    // Time-of-day in ms
    const dayMs = ms - epochDays * 86_400_000;
    const hour = Math.floor(dayMs / 3_600_000);
    const min = Math.floor((dayMs % 3_600_000) / 60_000);
    const sec = Math.floor((dayMs % 60_000) / 1_000);
    // Convert epoch days to Y/M/D (algorithm from civil_from_days)
    const z = epochDays + 719468;
    const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const y0 = yoe + era * 400;
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const m = mp < 10 ? mp + 3 : mp - 9;
    const y = m <= 2 ? y0 + 1 : y0;
    return `${String(y)}-${p(m)}-${p(d)}T${p(hour)}:${p(min)}:${p(sec)}.000Z`;
}

let conversations = $state<ConversationListItem[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);
let activeId = $state<string | null>(null);

/** Incremented each time loadConversations is called, so stale async results are discarded. */
let loadGeneration = 0;

/**
 * Return a reactive snapshot of the conversations state.
 * @returns An object with reactive list, loading, error, activeId, and activeConversation getters
 */
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

/**
 * Fetch the conversation list from the API and update the store.
 * Discards stale results if called again before the fetch completes.
 * @returns {Promise<void>}
 */
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

/**
 * Create a new conversation via the API and add it to the store.
 * @param title - Optional title for the new conversation
 * @param modelId - Optional model ID to use
 * @returns The new conversation ID, or null on failure
 */
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
                pinned: false,
                createdAt: isoNow(),
                updatedAt: isoNow(),
            });
        }
        activeId = id;
        return id;
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to create conversation";
        return null;
    }
}

/**
 * Delete a conversation via the API and remove it from the store.
 * @param id - The conversation ID to delete
 * @returns Whether the deletion succeeded
 */
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

/**
 * Rename a conversation via the API and update the store.
 * @param id - The conversation ID to rename
 * @param title - The new title
 * @returns Whether the rename succeeded
 */
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
 * @param id - The conversation ID to update
 * @param title - The new title
 * @param tags - The new tags
 * @returns {void}
 */
export function updateConversationTitleAndTags(id: string, title: string, tags: string[]): void {
    const conv = conversations.find((c) => c.id === id);
    if (conv) {
        conv.title = title;
        conv.tags = tags;
    }
}

/**
 * Pin or unpin a conversation via the API and update the store.
 * @param id - The conversation ID to pin/unpin
 * @param pinned - Whether the conversation should be pinned
 * @returns Whether the update succeeded
 */
export async function pinConversation(id: string, pinned: boolean): Promise<boolean> {
    error = null;
    try {
        await apiUpdate(id, { pinned });
        const conv = conversations.find((c) => c.id === id);
        if (conv) conv.pinned = pinned;
        return true;
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to update pin status";
        return false;
    }
}

export function setActiveConversation(id: string | null): void {
    activeId = id;
}

export function clearError(): void {
    error = null;
}
