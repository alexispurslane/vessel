import type { PageServerLoad } from "./$types.js";
import { getSessionHistory } from "$lib/server/agent/session-store.js";
import { getSessionWorkDir } from "$lib/server/agent/sandbox-factory.js";
import { messageHistoryToChatMessages } from "$lib/chat-history.js";
import { existsSync, readdirSync, statSync } from "fs";
import { resolve, relative } from "path";

/**
 * Recursively list files in a directory, returning paths relative to the base.
 */
function listFilesRecursive(dir: string, base: string): string[] {
    const results: string[] = [];
    if (!existsSync(dir)) return results;

    for (const entry of readdirSync(dir)) {
        const fullPath = resolve(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            results.push(...listFilesRecursive(fullPath, base));
        } else {
            results.push(relative(base, fullPath));
        }
    }
    return results;
}

export const load: PageServerLoad = async ({ params }) => {
    const conversationId = params.id;

    try {
        const history = await getSessionHistory(conversationId);

        // List files in the sandbox workspace so the UI can show
        // what's already been uploaded when the conversation loads.
        const workDir = getSessionWorkDir(conversationId);
        const sandboxFiles = existsSync(workDir) ? listFilesRecursive(workDir, workDir) : [];

        return {
            messageHistory: history,
            // Pre-converted ChatMessage[] for SSR rendering — avoids the client
            // having to do any conversion before first paint.
            messages: messageHistoryToChatMessages(history),
            lastModel: history.model,
            sandboxFiles,
        };
    } catch (e) {
        console.error(`[SSR] Failed to load history for ${conversationId}:`, e);
        // Return empty history so the page still renders — the client
        // can fall back to fetching via connectStream if needed.
        return {
            messageHistory: { messages: [], model: null },
            messages: [],
            lastModel: null,
            sandboxFiles: [],
        };
    }
};
