/**
 * @file Message operations within sessions.
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
import type { SessionTiming } from "$lib/types.js";

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
import { extractMessageContent } from "./session-history.js";

// --- Message sending ---

/**
 * Send a user message to the agent session.
 *
 * If statusContent is provided, it is sent as a non-displayed custom message
 * queued for the next turn (e.g. file upload/delete notices). This way the AI
 * sees the status information in context, but it doesn't appear as a visible
 * user message in the chat UI.
 *
 * @param agentSession - The PiAgentSession to send the message to
 * @param conversationId - The conversation ID (for title generation)
 * @param content - The user message text
 * @param statusContent - Optional hidden status content for the AI
 * @returns {Promise<void>}
 */
export async function sendMessageToSession(
    agentSession: PiAgentSession,
    conversationId: string,
    content: string,
    statusContent?: string
): Promise<void> {
    // Send invisible status content (file upload/delete notices) as a hidden
    // custom message queued for the next turn — AI sees it, chat UI doesn't.
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
 *
 * @param agentSession - The PiAgentSession to send the message to
 * @param customType - The custom message type identifier
 * @param content - The message content
 * @param options - Delivery options for the custom message
 * @param options.triggerTurn - Whether this message triggers an LLM turn
 * @param options.deliverAs - How to deliver the message (steer, followUp, nextTurn)
 * @returns {Promise<void>}
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
 *
 * @param activeSession - The active session to build history from
 * @param row - The DB row with session file path and model info
 * @param row.session_file_path - Path to the session JSONL file
 * @param row.model_provider - The model provider name
 * @param row.model_id - The model identifier
 * @returns The message history and model info
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
    timing?: SessionTiming;
} {
    return buildHistoryFromSession(activeSession, row);
}

/**
 * Look up the DB row for a conversation (session_file_path, model_provider, model_id).
 * Used by getSessionHistory in session-store.ts to get the row before delegating here.
 *
 * @param conversationId - The conversation ID to look up
 * @returns The DB row, or undefined if not found
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
 *
 * @param agentSession - The PiAgentSession to navigate
 * @param targetEntryId - The entry ID to navigate to
 * @returns The editor text (if user message) and whether cancelled
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
 *
 * @param agentSession - The PiAgentSession to operate on
 * @param targetEntryId - The entry ID of the assistant message to edit
 * @param newContent - The replacement text content
 * @returns Whether the operation was cancelled
 */
export async function editSessionAssistantMessage(
    agentSession: PiAgentSession,
    targetEntryId: string,
    newContent: string
): Promise<{ cancelled: boolean }> {
    return _editAssistantMessage(agentSession, targetEntryId, newContent);
}

/**
 * Regenerate an assistant message with user feedback.
 *
 * Navigates the session tree back to before the target assistant message
 * (creating a new branch), then sends the user's critique as a hidden
 * custom message that quotes the original response. The custom message
 * triggers a new LLM turn, so the agent generates a corrected response.
 *
 * The original branch is preserved — the user can navigate back to it
 * via the session tree / DAG viewer.
 *
 * @param agentSession - The PiAgentSession to operate on
 * @param targetEntryId - The entry ID of the assistant message to regenerate
 * @param feedback - The user's critique of what was wrong
 * @returns Whether the operation was cancelled
 */
export async function regenWithFeedback(
    agentSession: PiAgentSession,
    targetEntryId: string,
    feedback: string
): Promise<{ cancelled: boolean }> {
    const sessionManager = agentSession.sessionManager;
    const entry = sessionManager.getEntry(targetEntryId);
    if (!entry) {
        throw new Error(`Entry ${targetEntryId} not found in session`);
    }
    if (entry.type !== "message" || entry.message.role !== "assistant") {
        throw new Error(`Entry ${targetEntryId} is not an assistant message`);
    }

    // 1. Extract the original assistant message text before navigating away.
    const { textContent } = extractMessageContent(entry.message as unknown as Record<string, unknown>);

    // 2. Branch from the parent so the user message stays IN context but the
    //    old assistant response is OUT, letting the model generate a fresh reply.

    // navigateTree can't do this: navigating to user msg excludes it,
    // navigating to assistant includes it. We branch + append manually.

    // branch() only moves the leaf — the branch isn't real until a child
    // entry is appended (per SessionManager.branch() docs).
    const parentEntryId = entry.parentId;

    if (!parentEntryId) {
        throw new Error(`Assistant message ${targetEntryId} has no parent — cannot regenerate`);
    }

    // 3. Format the critique as a hidden custom message quoting the original
    //    response so the model knows what it previously said (now off-branch).
    const critiqueContent =
        `Your previous response to this message was:\n\n> ${textContent.replace(/\n/g, "\n> ")}\n\nHowever, this response had issues: ${feedback}\n\nPlease provide a corrected response.`;

    // Set leaf to user message, then append the critique as its child. This
    // locks in the new branch — the old assistant becomes a sibling.
    sessionManager.branch(parentEntryId);
    sessionManager.appendCustomMessageEntry(
        "regen_feedback",
        critiqueContent,
        false
    );

    // Rebuild context: user message + critique are in, old assistant is out.
    // The custom message converts to a user message via convertToLlm.

    // Use agent.continue() instead of sendCustomMessage — the entry is already
    // appended, sendCustomMessage would cause a duplicate via _processAgentEvent.
    const sessionContext = sessionManager.buildSessionContext();
    agentSession.agent.state.messages = sessionContext.messages;
    await agentSession.agent.continue();

    return { cancelled: false };
}

/**
 * Get all user messages from the session, for editing/forking.
 * Returns entry IDs and text content.
 *
 * @param activeSession - The active session to query
 * @returns Array of entry IDs and their text content
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
 *
 * @param agentSession - The PiAgentSession to query
 * @returns The session tree nodes, relations, and current leaf ID
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
 *
 * @param agentSession - The PiAgentSession to modify
 * @param targetEntryId - The entry ID to set as the new leaf
 * @returns {Promise<void>}
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
