/**
 * History building and session tree navigation.
 *
 * Functions for building message history from in-memory sessions,
 * navigating the session tree, editing assistant messages, and
 * getting user messages for forking.
 */

import type { AgentSession as PiAgentSession } from "@mariozechner/pi-coding-agent";
import type { ActiveSession } from "./types.js";
import type { FetchedSource } from "./extensions/fetch-tracker.js";

// --- Types ---

/** A node in the session tree for DAG visualization */
export interface SessionTreeNodeData {
    /** Entry ID */
    id: string;
    /** Parent entry ID (null for root) */
    parentId: string | null;
    /** Entry type (message, model_change, etc.) */
    type: string;
    /** Message role (only for type=message entries) */
    role?: string;
    /** First few words of the message content */
    preview: string;
    /** Full message content (for hover expansion) */
    fullContent: string;
    /** Whether this entry is on the current active branch (from root to leaf) */
    onActiveBranch: boolean;
    /** Whether this entry is the current leaf */
    isCurrentLeaf: boolean;
}

/** A relation in the session tree DAG */
export interface SessionTreeRelation {
    id: string;
    parentId: string;
    childId: string;
}

// --- History building ---

/**
 * Build message history from an in-memory session, respecting the
 * current branch/leaf position. Uses the SessionManager's getBranch() method
 * to walk only the entries on the current branch path.
 *
 * This is the sole method for reading session history — the SessionManager
 * handles JSONL file restoration automatically when the session is loaded.
 */
export function buildHistoryFromSession(
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
    const sessionManager = activeSession.agentSession.sessionManager;
    // getBranch() returns entries from root to current leaf
    const branchEntries = sessionManager.getBranch();

    const messages: Array<{
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
    }> = [];

    // Track tool call IDs to match results from tool-role messages
    const pendingToolCalls: Map<
        string,
        { toolName: string; msgIndex: number; toolCallIndex: number }
    > = new Map();

    let lastModelProvider: string | null = null;
    let lastModelId: string | null = null;

    // Accumulated fetched sources — once sources enter the LLM context, they
    // remain there for all subsequent assistant messages, so each one gets the
    // full cumulative list appended to it.
    let lastAssistantMsgIndex = -1;
    let accumulatedSources: FetchedSource[] = [];

    for (const entry of branchEntries) {
        // Track model changes
        if (entry.type === "model_change") {
            const modelEntry = entry as unknown as { provider: string; modelId: string };
            lastModelProvider = modelEntry.provider ?? null;
            lastModelId = modelEntry.modelId ?? null;
            continue;
        }

        // Accumulate fetched_sources custom entries — they stay in context forever
        if (entry.type === "custom" && (entry as any).customType === "fetched_sources") {
            const sources = (entry as any).data as FetchedSource[] | undefined;
            if (sources && sources.length > 0) {
                accumulatedSources = [...accumulatedSources, ...sources];
                // Retroactively attach to the assistant message that just produced them
                if (lastAssistantMsgIndex >= 0) {
                    messages[lastAssistantMsgIndex].fetchedSources = [...accumulatedSources];
                }
            }
            continue;
        }

        if (entry.type !== "message") continue;

        const msg = (entry as unknown as { message: Record<string, unknown> }).message;
        if (!msg || typeof msg !== "object") continue;

        const role = msg.role as string;

        // Handle tool result messages — attach output to the matching pending tool call
        if (role === "toolResult") {
            const toolCallId = (msg.toolCallId ?? msg.tool_call_id) as string | undefined;
            if (toolCallId && pendingToolCalls.has(toolCallId)) {
                const pending = pendingToolCalls.get(toolCallId)!;
                const targetMsg = messages[pending.msgIndex];
                if (targetMsg?.toolCalls?.[pending.toolCallIndex]) {
                    const tc = targetMsg.toolCalls[pending.toolCallIndex];
                    tc.status = msg.isError ? "error" : "completed";
                    if (Array.isArray(msg.content)) {
                        tc.output = (msg.content as Record<string, unknown>[])
                            .filter(
                                (b) => b.type === "text" && typeof b.text === "string"
                            )
                            .map((b) => b.text as string)
                            .join("");
                    } else if (typeof msg.content === "string") {
                        tc.output = msg.content;
                    }
                }
                pendingToolCalls.delete(toolCallId);
            }
            continue;
        }

        if (role !== "user" && role !== "assistant") continue;

        // Extract text content
        let textContent = "";
        let thinkingContent: string | undefined;
        const extractedToolCalls: Array<{
            toolName: string;
            status: string;
            output?: string;
            toolCallId?: string;
            arguments?: Record<string, unknown>;
        }> = [];

        if (Array.isArray(msg.content)) {
            for (const block of msg.content as Record<string, unknown>[]) {
                if (block.type === "text" && typeof block.text === "string") {
                    textContent += block.text;
                } else if (
                    block.type === "thinking" &&
                    typeof block.thinking === "string"
                ) {
                    thinkingContent = (thinkingContent ?? "") + block.thinking;
                } else if (block.type === "toolCall") {
                    extractedToolCalls.push({
                        toolName: (block.name as string) ?? "unknown",
                        status: "completed",
                        toolCallId: block.id as string,
                        arguments: block.arguments as Record<string, unknown> | undefined,
                    });
                }
            }
        } else if (typeof msg.content === "string") {
            textContent = msg.content;
        }

        // Skip empty user messages that pi sometimes adds
        if (role === "user" && !textContent.trim()) continue;

        // Strip leading newlines
        textContent = textContent.replace(/^\n+/, "");
        if (thinkingContent) {
            thinkingContent = thinkingContent.replace(/^\n+/, "");
        }

        const model =
            role === "assistant" ? (msg.model as string | undefined) ?? lastModelId ?? undefined : undefined;
        const modelProvider =
            role === "assistant"
                ? (msg.provider as string | undefined) ?? lastModelProvider ?? undefined
                : undefined;
        const isError = role === "assistant" && !!msg.errorMessage;

        // Extract usage data from assistant messages
        const usage = role === "assistant" && msg.usage ? {
            input: (msg.usage as Record<string, unknown>).input as number ?? 0,
            output: (msg.usage as Record<string, unknown>).output as number ?? 0,
            cacheRead: (msg.usage as Record<string, unknown>).cacheRead as number ?? 0,
            cacheWrite: (msg.usage as Record<string, unknown>).cacheWrite as number ?? 0,
            totalTokens: (msg.usage as Record<string, unknown>).totalTokens as number ?? 0,
        } : undefined;

        const msgIndex = messages.length;
        messages.push({
            id: entry.id,
            role,
            content: textContent,
            thinking: thinkingContent || undefined,
            model,
            modelProvider,
            toolCalls: extractedToolCalls.length > 0 ? extractedToolCalls : undefined,
            isError: isError || undefined,
            usage,
            timestamp: (msg.timestamp as number) ?? 0,
        });

        // Track the last assistant message index for attaching fetched_sources.
        // Also attach any accumulated sources — once sources are in the LLM context,
        // they remain there for every subsequent assistant message.
        if (role === "assistant") {
            lastAssistantMsgIndex = msgIndex;
            if (accumulatedSources.length > 0) {
                messages[msgIndex].fetchedSources = [...accumulatedSources];
            }
        }

        // Register tool calls for later matching with tool result messages
        if (extractedToolCalls.length > 0) {
            extractedToolCalls.forEach((tc, tcIdx) => {
                if (tc.toolCallId) {
                    pendingToolCalls.set(tc.toolCallId, {
                        toolName: tc.toolName,
                        msgIndex,
                        toolCallIndex: tcIdx,
                    });
                }
            });
        }
    }

    const model =
        lastModelProvider && lastModelId
            ? { provider: lastModelProvider, modelId: lastModelId }
            : row.model_provider && row.model_id
                ? { provider: row.model_provider, modelId: row.model_id }
                : null;

    return { messages, model };
}

// --- Session tree ---

/**
 * Get the full session tree as nodes and relations for DAG visualization.
 * Returns only user messages and final assistant text responses (no tool calls,
 * thinking blocks, tool results, or other intermediate entries).
 */
export function getSessionTreeFromAgent(
    agentSession: PiAgentSession
): Promise<{
    nodes: SessionTreeNodeData[];
    relations: SessionTreeRelation[];
    leafId: string | null;
}> {
    const sessionManager = agentSession.sessionManager;
    const allEntries = sessionManager.getEntries();
    const leafId = sessionManager.getLeafId();

    // Get the set of entry IDs on the current active branch
    const activeBranch = sessionManager.getBranch();
    const activeBranchIds = new Set(activeBranch.map((e) => e.id));

    const nodes: SessionTreeNodeData[] = [];
    const relations: SessionTreeRelation[] = [];

    for (const entry of allEntries) {
        // Only include message entries — skip model_change, compaction, branch_summary, etc.
        if (entry.type !== "message") continue;

        const msg = (entry as unknown as { message: Record<string, unknown> }).message;
        const role = msg.role as string | undefined;

        // Only include user and assistant messages — skip toolResult, etc.
        if (role !== "user" && role !== "assistant") continue;

        // Extract text content and check for tool calls / thinking blocks
        let fullContent = "";
        let hasToolCall = false;
        let hasThinking = false;

        if (Array.isArray(msg.content)) {
            for (const block of msg.content as Record<string, unknown>[]) {
                if (block.type === "text" && typeof block.text === "string") {
                    fullContent += block.text;
                } else if (block.type === "thinking") {
                    hasThinking = true;
                } else if (block.type === "toolCall") {
                    hasToolCall = true;
                }
            }
        } else if (typeof msg.content === "string") {
            fullContent = msg.content;
        }

        // Skip assistant messages that contain tool calls or thinking blocks.
        // In the DAG we only show complete conversation turns
        // (user messages and final assistant text responses),
        // not intermediate reasoning/tool-use steps.
        if (role === "assistant" && (hasToolCall || (hasThinking && !fullContent.trim()))) continue;

        // Skip empty user messages that pi sometimes adds
        if (role === "user" && !fullContent.trim()) continue;

        fullContent = fullContent.replace(/^\n+/, "");
        // Preview: first ~40 characters or first line, whichever is shorter
        const firstLine = fullContent.split('\n')[0] || '';
        const preview = firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine;

        nodes.push({
            id: entry.id,
            parentId: entry.parentId,
            type: entry.type,
            role,
            preview,
            fullContent,
            onActiveBranch: activeBranchIds.has(entry.id),
            isCurrentLeaf: entry.id === leafId,
        });

        // Add a relation for the parent-child link
        if (entry.parentId !== null) {
            relations.push({
                id: `rel-${entry.id}`,
                parentId: entry.parentId,
                childId: entry.id,
            });
        }
    }

    // Repair parent IDs: since we filtered out non-message nodes, some visible nodes'
    // parentIds point to hidden entries (model_change, compaction, etc.). Walk up
    // through the full entry tree to find the closest visible ancestor.
    const visibleById = new Set(nodes.map((n) => n.id));
    const fullEntryById = new Map(allEntries.map((e) => [e.id, e]));

    for (let i = 0; i < nodes.length; i++) {
        const rawParentId = nodes[i].parentId;
        if (rawParentId === null) continue;
        // If the parent is visible, no repair needed
        if (visibleById.has(rawParentId)) continue;
        // Walk up through hidden entries until we find a visible ancestor (or nothing)
        let ancestorId: string | null = rawParentId;
        let repaired: string | null = null;
        while (ancestorId) {
            if (visibleById.has(ancestorId)) {
                repaired = ancestorId;
                break;
            }
            const ancestor = fullEntryById.get(ancestorId);
            ancestorId = ancestor?.parentId ?? null;
        }
        nodes[i].parentId = repaired;

        // Also repair the corresponding relation if it exists
        const rel = relations.find((r) => r.childId === nodes[i].id);
        if (rel) {
            rel.parentId = repaired ?? "";
        }
    }

    return Promise.resolve({ nodes, relations, leafId });
}

// --- Navigation ---

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
 * @param agentSession - The PiAgentSession to navigate (caller passes it in)
 */
export async function navigateMessage(
    agentSession: PiAgentSession,
    targetEntryId: string
): Promise<{ editorText?: string; cancelled: boolean }> {
    // Check the type of entry we're navigating to — for non-user messages (e.g., assistant),
    // we want to navigate to the parent entry so the message gets "deleted"
    const entry = agentSession.sessionManager.getEntry(targetEntryId);
    if (!entry) {
        throw new Error(`Entry ${targetEntryId} not found in session`);
    }

    // For user messages: navigateTree handles this correctly — sets leaf to parent and returns text
    // For non-user messages (assistant, etc.): we need to navigate to the parent to effectively delete this message
    let navigateTargetId = targetEntryId;
    if (entry.type === "message" && entry.message && entry.message.role !== "user") {
        // For assistant messages, navigate to the parent entry to delete this response
        // The parent is typically the user message or tool result that preceded this response
        const parentId = entry.parentId;
        if (parentId) {
            navigateTargetId = parentId;
        } else {
            // If the assistant message is a root (no parent), we can't navigate further back
            // Just navigate to the message itself
            navigateTargetId = targetEntryId;
        }
    }

    const result = await agentSession.navigateTree(navigateTargetId, {
        summarize: false,
    });

    return {
        editorText: result.editorText,
        cancelled: result.cancelled,
    };
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
 * @param agentSession - The PiAgentSession to edit (caller passes it in)
 */
export async function editAssistantMessage(
    agentSession: PiAgentSession,
    targetEntryId: string,
    newContent: string
): Promise<{ cancelled: boolean }> {
    const sessionManager = agentSession.sessionManager;
    const targetEntry = sessionManager.getEntry(targetEntryId);
    if (!targetEntry) {
        throw new Error(`Entry ${targetEntryId} not found in session`);
    }
    if (targetEntry.type !== "message" || targetEntry.message.role !== "assistant") {
        throw new Error(`Entry ${targetEntryId} is not an assistant message`);
    }

    // 1. Collect entries on the current branch after the target assistant message.
    //    These are the entries we'll need to replay after appending the edited version.
    const currentBranch = sessionManager.getBranch();
    const targetIdx = currentBranch.findIndex((e) => e.id === targetEntryId);
    if (targetIdx === -1) {
        throw new Error(`Entry ${targetEntryId} is not on the current branch`);
    }
    // Entries after the target (chronological order, root → leaf)
    const entriesToReplay = currentBranch.slice(targetIdx + 1);

    // 2. Navigate back to before the target assistant message.
    //    For assistant messages, navigateTree with the parent moves the leaf
    //    to the parent, returning the parent's editorText (user msg text)
    //    which we don't need here.
    const navigateResult = await agentSession.navigateTree(targetEntryId, {
        summarize: false,
    });

    if (navigateResult.cancelled) {
        return { cancelled: true };
    }

    // 3. Append the edited assistant message as a child of the new leaf.
    //    We reconstruct an AssistantMessage with the new text content,
    //    preserving the original model/provider/usage metadata.
    const originalMsg = targetEntry.message;
    const editedAssistantMessage = {
        ...originalMsg,
        content: [{ type: "text" as const, text: newContent }],
    };
    sessionManager.appendMessage(editedAssistantMessage);

    // 4. Replay all subsequent entries from the abandoned branch.
    //    Each entry is appended as a child of the current leaf, so the
    //    tree structure is preserved on the new branch.
    for (const entry of entriesToReplay) {
        switch (entry.type) {
            case "message":
                // The SessionMessageEntry.message type is AgentMessage which includes custom
                // message types (BranchSummaryMessage, etc.) via declaration merging, but
                // appendMessage only accepts the base LLM-compatible message types. Since
                // we're replaying entries from the current branch, all message entries
                // will be standard LLM-compatible messages — safe to cast.
                sessionManager.appendMessage(entry.message as Parameters<typeof sessionManager.appendMessage>[0]);
                break;
            case "model_change":
                sessionManager.appendModelChange(entry.provider, entry.modelId);
                break;
            case "thinking_level_change":
                sessionManager.appendThinkingLevelChange(entry.thinkingLevel);
                break;
            case "custom":
                sessionManager.appendCustomEntry(entry.customType, entry.data);
                break;
            case "custom_message":
                sessionManager.appendCustomMessageEntry(
                    entry.customType,
                    entry.content,
                    entry.display,
                    entry.details
                );
                break;
            case "label": {
                // entry.label is string | undefined on LabelEntry; appendLabelChange
                // accepts string | undefined per the .d.ts, but TS narrowing through
                // the SessionEntry union doesn't cooperate. Force-cast to satisfy TS.
                const labelEntry = entry as { targetId: string; label: string | undefined };
                sessionManager.appendLabelChange(labelEntry.targetId, labelEntry.label as string);
                break;
            }
            case "session_info":
                if (entry.name) {
                    sessionManager.appendSessionInfo(entry.name);
                }
                break;
            // Skip compaction/branch_summary entries — they belong to the old branch
            // and will be regenerated if needed.
            default:
                break;
        }
    }

    // 5. Update agent state to reflect the new session context
    const sessionContext = sessionManager.buildSessionContext();
    agentSession.agent.state.messages = sessionContext.messages;

    return { cancelled: false };
}

/**
 * Get all user messages from the session, for editing/forking.
 * Returns entry IDs and text content.
 *
 * @param activeSession - The active session to read from
 */
export function getUserMessages(activeSession: ActiveSession): Array<{ entryId: string; text: string }> {
    return activeSession.agentSession.getUserMessagesForForking();
}
