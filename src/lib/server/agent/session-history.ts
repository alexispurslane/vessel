/**
 * History building and session tree navigation.
 *
 * Functions for building message history from in-memory sessions,
 * navigating the session tree, editing assistant messages, and
 * getting user messages for forking.
 */

import type { AgentSession as PiAgentSession } from "@mariozechner/pi-coding-agent";
import type { ActiveSession } from "./types.js";
import type { FetchedSource, HistoryMessage, HistoryResult } from "$lib/types.js";

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

/** Mutable state shared across the entry-type handlers during history building. */
interface HistoryBuilderState {
    messages: HistoryMessage[];
    pendingToolCalls: Map<
        string,
        { toolName: string; msgIndex: number; toolCallIndex: number }
    >;
    lastModelProvider: string | null;
    lastModelId: string | null;
    lastAssistantMsgIndex: number;
    accumulatedSources: FetchedSource[];
}

/** Track model changes from `model_change` entries. */
function handleModelChange(state: HistoryBuilderState, entry: { provider: string; modelId: string }): void {
    state.lastModelProvider = entry.provider;
    state.lastModelId = entry.modelId;
}

/** Accumulate fetched_sources custom entries and retroactively attach them. */
function handleFetchedSources(state: HistoryBuilderState, entry: unknown): void {
    const sources = (entry as { data: FetchedSource[] | undefined }).data;
    if (sources && sources.length > 0) {
        state.accumulatedSources = [...state.accumulatedSources, ...sources];
        // Retroactively attach to the assistant message that just produced them
        if (state.lastAssistantMsgIndex >= 0) {
            state.messages[state.lastAssistantMsgIndex].fetchedSources = [
                ...state.accumulatedSources,
            ];
        }
    }
}

/** Match tool result messages back to their pending tool calls. */
function handleToolResult(
    state: HistoryBuilderState,
    msg: Record<string, unknown>
): void {
    const toolCallId = (msg.toolCallId ?? msg.tool_call_id) as string | undefined;
    if (toolCallId && state.pendingToolCalls.has(toolCallId)) {
        const pending = state.pendingToolCalls.get(toolCallId);
        if (!pending) return;
        const targetMsg = state.messages[pending.msgIndex];
        if (targetMsg.toolCalls && targetMsg.toolCalls[pending.toolCallIndex]) {
            const tc = targetMsg.toolCalls[pending.toolCallIndex];
            tc.status = msg.isError ? "error" : "completed";
            if (Array.isArray(msg.content)) {
                tc.output = (msg.content as Record<string, unknown>[])
                    .filter((b) => b.type === "text" && typeof b.text === "string")
                    .map((b) => b.text as string)
                    .join("");
            } else if (typeof msg.content === "string") {
                tc.output = msg.content;
            }
        }
        state.pendingToolCalls.delete(toolCallId);
    }
}

/** Parsed content blocks from a message's content field. */
interface ExtractedContent {
    textContent: string;
    thinkingContent: string | undefined;
    toolCalls: Array<{
        toolName: string;
        status: string;
        output?: string;
        toolCallId?: string;
        arguments?: Record<string, unknown>;
    }>;
}

/** Parse a message's content field into text, thinking, and tool call blocks. */
function extractMessageContent(msg: Record<string, unknown>): ExtractedContent {
    let textContent = "";
    let thinkingContent: string | undefined;
    const toolCalls: ExtractedContent["toolCalls"] = [];

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
                toolCalls.push({
                    toolName: (block.name as string),
                    status: "completed",
                    toolCallId: block.id as string,
                    arguments: block.arguments as Record<string, unknown> | undefined,
                });
            }
        }
    } else if (typeof msg.content === "string") {
        textContent = msg.content;
    }

    // Strip leading newlines
    textContent = textContent.replace(/^\n+/, "");
    if (thinkingContent) {
        thinkingContent = thinkingContent.replace(/^\n+/, "");
    }

    return { textContent, thinkingContent, toolCalls };
}

/** Extract token usage data from an assistant message, if present. */
function extractUsage(msg: Record<string, unknown>): HistoryMessage["usage"] {
    if (!msg.usage) return undefined;
    const u = msg.usage as Record<string, unknown>;
    return {
        input: u.input as number,
        output: u.output as number,
        cacheRead: u.cacheRead as number,
        cacheWrite: u.cacheWrite as number,
        totalTokens: u.totalTokens as number,
    };
}

/** After appending an assistant message, update accumulated-source tracking. */
function handlePostAssistantPush(
    state: HistoryBuilderState,
    msgIndex: number
): void {
    state.lastAssistantMsgIndex = msgIndex;
    if (state.accumulatedSources.length > 0) {
        state.messages[msgIndex].fetchedSources = [...state.accumulatedSources];
    }
}

/** Register tool calls from a message so later tool-result messages can match back. */
function registerPendingToolCalls(
    state: HistoryBuilderState,
    toolCalls: ExtractedContent["toolCalls"],
    msgIndex: number
): void {
    for (let tcIdx = 0; tcIdx < toolCalls.length; tcIdx++) {
        const tc = toolCalls[tcIdx];
        if (tc.toolCallId) {
            state.pendingToolCalls.set(tc.toolCallId, {
                toolName: tc.toolName,
                msgIndex,
                toolCallIndex: tcIdx,
            });
        }
    }
}

/** Resolve assistant-specific fields (model, provider, error, usage) from a message. */
function resolveAssistantFields(
    msg: Record<string, unknown>,
    role: string,
    state: HistoryBuilderState
): Pick<HistoryMessage, "model" | "modelProvider" | "isError" | "usage"> {
    if (role !== "assistant") {
        return { model: undefined, modelProvider: undefined, isError: undefined, usage: undefined };
    }
    return {
        model: (msg.model as string | undefined) ?? state.lastModelId ?? undefined,
        modelProvider: (msg.provider as string | undefined) ?? state.lastModelProvider ?? undefined,
        isError: !!msg.errorMessage || undefined,
        usage: extractUsage(msg),
    };
}

/** Process a user or assistant message entry and append it to the history. */
function handleMessage(
    state: HistoryBuilderState,
    entry: { id: string },
    msg: Record<string, unknown>,
    role: string
): void {
    const { textContent, thinkingContent, toolCalls } = extractMessageContent(msg);

    // Skip empty user messages that pi sometimes adds
    if (role === "user" && !textContent.trim()) return;

    const { model, modelProvider, isError, usage } = resolveAssistantFields(msg, role, state);

    const msgIndex = state.messages.length;
    state.messages.push({
        id: entry.id,
        role,
        content: textContent,
        thinking: thinkingContent || undefined,
        model,
        modelProvider,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        isError,
        usage,
        timestamp: msg.timestamp as number,
    });

    if (role === "assistant") {
        handlePostAssistantPush(state, msgIndex);
    }

    if (toolCalls.length > 0) {
        registerPendingToolCalls(state, toolCalls, msgIndex);
    }
}

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
): HistoryResult {
    const sessionManager = activeSession.agentSession.sessionManager;
    // getBranch() returns entries from root to current leaf
    const branchEntries = sessionManager.getBranch();

    const state: HistoryBuilderState = {
        messages: [],
        pendingToolCalls: new Map(),
        lastModelProvider: null,
        lastModelId: null,
        lastAssistantMsgIndex: -1,
        accumulatedSources: [],
    };

    for (const entry of branchEntries) {
        // Track model changes
        if (entry.type === "model_change") {
            handleModelChange(state, entry);
            continue;
        }

        // Accumulate fetched_sources custom entries — they stay in context forever
        if (entry.type === "custom" && (entry as { customType: string }).customType === "fetched_sources") {
            handleFetchedSources(state, entry);
            continue;
        }

        if (entry.type !== "message") continue;

        const msg = (entry as unknown as { message: Record<string, unknown> }).message;
        if (!msg || typeof msg !== "object") continue;

        const role = msg.role as string;

        // Handle tool result messages — attach output to the matching pending tool call
        if (role === "toolResult") {
            handleToolResult(state, msg);
            continue;
        }

        if (role !== "user" && role !== "assistant") continue;

        handleMessage(state, entry, msg, role);
    }

    const model =
        state.lastModelProvider && state.lastModelId
            ? { provider: state.lastModelProvider, modelId: state.lastModelId }
            : row.model_provider && row.model_id
                ? { provider: row.model_provider, modelId: row.model_id }
                : null;

    return { messages: state.messages, model };
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
    if (entry.type === "message" && entry.message.role !== "user") {
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
                sessionManager.appendLabelChange(labelEntry.targetId, labelEntry.label);
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
