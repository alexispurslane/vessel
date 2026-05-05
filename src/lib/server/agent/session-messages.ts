/**
 * Message operations within sessions.
 *
 * Functions for sending messages, retrieving history, navigating the session
 * tree, editing assistant messages, and managing session leaf position.
 *
 * All functions in this module operate on an already-resolved session
 * (PiAgentSession or ActiveSession) — they do NOT look up the session from
 * the sessions Map, call getOrCreateConversation, or call cancelDispose.
 * Those concerns belong to session-store.ts, which wraps these functions
 * with session lookup and disposal cancellation before delegating here.
 *
 * This avoids circular imports: session-messages imports from session-history,
 * session-events, model-registry, title-generator, etc. — but NEVER from
 * session-store.
 */

import type { AgentSession as PiAgentSession } from "@mariozechner/pi-coding-agent";
import type { ActiveSession } from "./types.js";
import type { FetchedSource } from "./extensions/fetch-tracker.js";

import {
    buildHistoryFromSession,
    getSessionTreeFromAgent,
    navigateMessage as _navigateMessage,
    editAssistantMessage as _editAssistantMessage,
    getUserMessages as _getUserMessages,
} from "./session-history.js";
export {
    buildHistoryFromSession,
} from "./session-history.js";
export type {
    SessionTreeNodeData,
    SessionTreeRelation,
} from "./session-history.js";

import { generateTitleAndTags } from "./title-generator.js";
import { getDb } from "../db/index.js";
import { log } from "$lib/server/logger.js";

// --- Message sending ---

/**
 * Send a user message to the agent session.
 *
 * If statusContent is provided, it is sent as a non-displayed custom message
 * queued for the next turn (e.g. file upload/delete notices). This way the AI
 * sees the status information in context, but it doesn't appear as a visible
 * user message in the chat UI.
 */
export async function sendMessageToSession(
    agentSession: PiAgentSession,
    conversationId: string,
    content: string,
    statusContent?: string
): Promise<void> {
    // If there's invisible status content (e.g., file upload/delete notices),
    // send it as a custom message queued for the next turn. This way the AI
    // sees the status information in context, but it doesn't appear as a
    // visible user message in the chat UI.
    if (statusContent) {
        await agentSession.sendCustomMessage(
            {
                customType: "status_update",
                content: statusContent,
                display: false,
            },
            {
                deliverAs: "nextTurn",
            }
        );
    }

    await agentSession.prompt(content);

    // After the prompt completes, trigger title/tag generation in the background.
    // This runs even if the client isn't connected to the SSE stream yet.
    generateTitleAndTags(conversationId).catch((err: unknown) => {
        log.error(
            "session-messages",
            `Background title generation failed for ${conversationId}`,
            err
        );
    });
}

/**
 * Send a custom (non-displayed) message to the agent session.
 */
export async function sendCustomMessageToSession(
    agentSession: PiAgentSession,
    customType: string,
    content: string,
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }
): Promise<void> {
    await agentSession.sendCustomMessage(
        {
            customType,
            content,
            display: false,
        },
        {
            triggerTurn: options?.triggerTurn ?? false,
            deliverAs: options?.deliverAs,
        }
    );
}

// --- History retrieval ---

/**
 * Build and return the full message history for a session.
 *
 * Delegates to buildHistoryFromSession from session-history.ts.
 */
export function getHistoryFromSession(
    activeSession: ActiveSession,
    row: { session_file_path: string; model_provider: string | null; model_id: string | null }
): {
    messages: Array<{
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
    }>;
    model: { provider: string; modelId: string } | null;
} {
    return buildHistoryFromSession(activeSession, row);
}

/**
 * Look up the DB row for a conversation (session_file_path, model_provider, model_id).
 * Used by getSessionHistory in session-store.ts to get the row before delegating here.
 */
export function getConversationDbRow(conversationId: string): {
    session_file_path: string;
    model_provider: string | null;
    model_id: string | null;
} | undefined {
    const db = getDb();
    return db
        .query(
            "SELECT session_file_path, model_provider, model_id FROM conversations WHERE id = ?"
        )
        .get(conversationId) as
        | { session_file_path: string; model_provider: string | null; model_id: string | null }
        | undefined;
}

// --- Session tree navigation ---

/**
 * Navigate the session tree to a target entry.
 * Used for delete/edit operations — moves the conversation's "current position"
 * back to before the target message, effectively abandoning that message and
 * everything after it in the conversation.
 *
 * For user messages: returns the message text (for editing and re-sending).
 * For other messages: just navigates back.
 *
 * This uses the SDK's navigateTree method which handles branching properly
 * in the append-only session tree.
 */
export async function navigateSessionMessage(
    agentSession: PiAgentSession
    ,
    targetEntryId: string
): Promise<{ editorText?: string; cancelled: boolean }> {
    return _navigateMessage(agentSession, targetEntryId);
}

/**
 * In-place edit of an assistant message.
 *
 * Navigates the tree back to before the target assistant message, appends a
 * new assistant message with the edited text content, then replays all subsequent
 * entries (user messages, assistant messages, model changes, etc.) from the
 * abandoned branch onto the new branch.
 *
 * Since the session tree is append-only, this creates a new branch — the old
 * entries remain in the JSONL file but are no longer on the active path.
 */
export async function editSessionAssistantMessage(
    agentSession: PiAgentSession,
    targetEntryId: string,
    newContent: string
): Promise<{ cancelled: boolean }> {
    return _editAssistantMessage(agentSession, targetEntryId, newContent);
}

/**
 * Get all user messages from the session, for editing/forking.
 * Returns entry IDs and text content.
 */
export function getSessionUserMessages(
    activeSession: ActiveSession
): Array<{ entryId: string; text: string }> {
    return _getUserMessages(activeSession);
}

// --- Session tree ---

/**
 * Get the full session tree as nodes and relations for DAG visualization.
 * Returns only user messages and final assistant text responses (no tool calls,
 * thinking blocks, tool results, or other intermediate entries).
 */
export async function getSessionTreeFromSession(
    agentSession: PiAgentSession
): Promise<{
    nodes: import("./session-history.js").SessionTreeNodeData[];
    relations: import("./session-history.js").SessionTreeRelation[];
    leafId: string | null;
}> {
    return getSessionTreeFromAgent(agentSession);
}

/**
 * Set the session's current leaf position to a specific entry ID.
 * Used by the DAG viewer to navigate to a different point in the tree.
 * Unlike navigateMessage (which handles edit/delete semantics), this directly
 * branches to the target entry.
 */
export async function setSessionLeafEntry(
    agentSession: PiAgentSession,
    targetEntryId: string
): Promise<void> {
    const sessionManager = agentSession.sessionManager;
    const entry = sessionManager.getEntry(targetEntryId);
    if (!entry) {
        throw new Error(`Entry ${targetEntryId} not found in session`);
    }

    // Use the session's navigateTree to move the leaf position
    // This handles branching and context updates properly
    await agentSession.navigateTree(targetEntryId, { summarize: false });
}
