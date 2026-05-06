/**
 * @file Server-only types for Vessel.
 *
 * Shared domain types (ConversationListItem, CustomModelDef, etc.)
 * live in $lib/types.ts and are imported from there.
 *
 * This file only contains:
 * 1. Pi type re-exports (with Pi prefix for boundary clarity)
 * 2. Server-internal types (ActiveSession)
 */

// --- Shared domain types (re-exported for convenience) ---
export type {
    ChatSSEEvent,
    ConversationListItem,
    ConversationMeta,
    ProviderInfo,
    CustomModelDef,
} from "$lib/types.js";

// --- Pi types (re-exported with Pi prefix for clarity) ---

export type {
    AgentSessionEvent as PiAgentSessionEvent,
    AgentSession as PiAgentSession,
} from "@mariozechner/pi-coding-agent";

export type {
    Model as PiModel,
    Context as PiContext,
    Tool as PiTool,
    Message as PiMessage,
    AssistantMessage as PiAssistantMessage,
} from "@mariozechner/pi-ai";

export type {
    AgentMessage as PiAgentMessage,
    AgentState as PiAgentState,
    AgentTool as PiAgentTool,
    ThinkingLevel as PiThinkingLevel,
} from "@mariozechner/pi-agent-core";

// --- Server-internal types ---

import type { ChatSSEEvent } from "$lib/types.js";
import type { ConversationSettings } from "$lib/types.js";
import type { Sandbox } from "zerobox";

/** Internal: an active session in memory with its SSE subscribers */
export interface ActiveSession {
    agentSession: import("@mariozechner/pi-coding-agent").AgentSession;
    sessionId: string;
    subscribers: Map<string, { send: (event: ChatSSEEvent) => void }>;
    unsubscribe: () => void;
    /** Per-session zerobox sandbox controlling tool execution isolation. Null if sandboxing is disabled. */
    sandbox: Sandbox | null;
    /** Per-conversation settings that override global sandbox settings. */
    conversationSettings?: ConversationSettings;
    disposeTimer?: ReturnType<typeof setTimeout>;
    /** Monotonically increasing counter, incremented on each message_start event.
     *  Embedded in streaming SSE events so the client can distinguish different
     *  streaming turns and filter stale deltas after stream_recovery. */
    turnGeneration: number;
}
