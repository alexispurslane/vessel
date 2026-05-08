import type { PageServerLoad } from "./$types.js";
import { getSessionHistory } from "$lib/server/agent/session-store.js";
import { getSessionWorkDir } from "$lib/server/agent/sandbox-factory.js";
import { messageHistoryToChatMessages } from "$lib/chat-history.js";
import { getDb } from "$lib/server/db/index.js";
import { resolve, relative } from "path";
import { readdir } from "node:fs/promises";

/**
 * Recursively list files in a directory, returning paths relative to the base.
 *
 * @param dir - The directory to list
 * @param base - The base directory for relative paths
 * @returns Array of relative file paths
 */
async function listFilesRecursive(dir: string, base: string): Promise<string[]> {
    const results: string[] = [];
    if (!(await Bun.file(dir).exists())) return results;

    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...await listFilesRecursive(fullPath, base));
        } else {
            results.push(relative(base, fullPath));
        }
    }
    return results;
}

/**
 * Load conversation data for SSR: message history and sandbox files.
 *
 * @param root0 - The load function params
 * @param root0.params - The route params (includes id)
 * @returns Page data with messages and sandbox files
 */
export const load: PageServerLoad = async ({ params }) => {
    const conversationId = params.id;

    try {
        const history = await getSessionHistory(conversationId);

        // List files in the sandbox workspace so the UI can show
        // what's already been uploaded when the conversation loads.
        const workDir = getSessionWorkDir(conversationId);
        const sandboxFiles = (await Bun.file(workDir).exists()) ? await listFilesRecursive(workDir, workDir) : [];

        // Fetch the conversation's default model from the DB.
        // Every conversation gets an explicit default at creation time.
        const db = getDb();
        const convRow = db
            .query("SELECT model_provider, model_id FROM conversations WHERE id = ?")
            .get(conversationId) as { model_provider: string | null; model_id: string | null } | undefined;
        const conversationDefaultModel = convRow?.model_id
            ? { provider: convRow.model_provider, modelId: convRow.model_id }
            : null;

        return {
            messageHistory: history,
            // Pre-converted ChatMessage[] for SSR rendering — avoids the client
            // having to do any conversion before first paint.
            messages: messageHistoryToChatMessages(history),
            conversationDefaultModel,
            timing: history.timing ?? null,
            sandboxFiles,
        };
    } catch (e) {
        console.error(`[SSR] Failed to load history for ${conversationId}:`, e);
        // Return empty history so the page still renders — the client
        // can fall back to fetching via connectStream if needed.
        return {
            messageHistory: { messages: [], model: null },
            messages: [],
            conversationDefaultModel: null,
            timing: null,
            sandboxFiles: [],
        };
    }
};
