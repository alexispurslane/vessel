/**
 * Adapter layer for pi-coding-agent internal API access.
 *
 * These functions access pi-coding-agent internal properties that are not
 * part of the public API. Each function includes a runtime guard that checks
 * if the property exists before accessing it. If the guard fails (property
 * is undefined), the function throws a clear, actionable error message so
 * that upstream renames or removals are caught immediately rather than
 * causing silent runtime failures.
 *
 * Currently covers:
 * - AgentSession internal tool maps (_toolRegistry, _toolDefinitions, _baseToolDefinitions)
 * - AgentSession internal extensionRunner
 * - ResourceLoader internal properties (systemPrompt, appendSystemPrompt)
 * - ModelRegistry internal model list
 */

import type { AgentSession as PiAgentSession } from "@mariozechner/pi-coding-agent";
import { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";

// --- Internal interfaces for casting to private fields ---
// These interfaces describe the internal shape of pi-coding-agent objects
// that are not part of the public API. They are used exclusively in this
// adapter layer to avoid `any` casts. If pi-coding-agent changes its
// internals, the runtime guards below will catch the breakage.

/**
 * Type alias for storing heterogeneous AgentTool instances in maps/arrays.
 *
 * AgentTool is contravariant in its TParameters generic (the execute method
 * consumes params), so specific tool types like `AgentTool<FetchSchema, FetchDetails>`
 * are NOT assignable to `AgentTool<TSchema, unknown>`. This alias uses the same
 * erasure approach as the pi-agent-core library itself (which uses `AgentTool<any>[]`
 * in its own AgentState interface). The `any` here is required for type compatibility
 * when storing tools with different parameter schemas in a single collection.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAgentTool = AgentTool<any>;

/** Shape of a tool definition record as stored in _toolDefinitions. */
export interface ToolDefinitionRecord {
    definition: AnyAgentTool;
    sourceInfo: {
        path: string;
        source: string;
        scope: string;
        origin: string;
    };
}

/** Internal AgentSession shape for accessing private properties. */
interface InternalAgentSession {
    _toolRegistry?: Map<string, AnyAgentTool>;
    _toolDefinitions?: Map<string, ToolDefinitionRecord>;
    _baseToolDefinitions?: Map<string, AnyAgentTool>;
    extensionRunner?: ExtensionRunner;
}

/** Minimal shape of the extension runner (used for MCP status reporting). */
export interface ExtensionRunner {
    extensions?: Array<{ tools?: Map<string, unknown>;[key: string]: unknown }>;
    adapters?: Array<unknown>;
    [key: string]: unknown;
}

/** Internal ResourceLoader shape for accessing prompt properties. */
interface InternalResourceLoader {
    systemPrompt?: string;
    appendSystemPrompt?: string[];
}

/** Internal ModelRegistry shape for accessing the models array. */
interface InternalModelRegistry {
    models?: Array<{ provider: string }>;
}

// --- Error message template ---

const ISSUE_URL = "https://github.com/mariozechner/pi-coding-agent/issues";

function internalAccessError(objectName: string, propertyName: string): Error {
    return new Error(
        `pi-adapter: ${objectName}.${propertyName} is undefined — ` +
        `pi-coding-agent may have renamed or removed this internal property. ` +
        `Check for updates to @mariozechner/pi-coding-agent. ` +
        `If this persists after updating, please file an issue at ${ISSUE_URL}.`
    );
}

// --- AgentSession internal accessors ---

/**
 * Get the tool registry map from an AgentSession.
 *
 * Accesses `agentSession._toolRegistry` — the internal Map<string, AgentTool>
 * used by `setActiveToolsByName()` to resolve tool objects by name.
 * We write to this map when registering Vessel-specific tools (fetch, web_search)
 * and sandboxed tool overrides.
 *
 * Runtime guard: throws if the property is undefined.
 */
export function getToolRegistry(session: PiAgentSession): Map<string, AnyAgentTool> {
    const registry = (session as unknown as InternalAgentSession)._toolRegistry;
    if (!registry) {
        throw internalAccessError("agentSession", "_toolRegistry");
    }
    return registry;
}

/**
 * Get the tool definitions map from an AgentSession.
 *
 * Accesses `agentSession._toolDefinitions` — the internal Map<string, any>
 * used by `getAllTools()` / `getSessionAgentInfo()` to list available tools
 * with their sourceInfo metadata. We write to this map when registering
 * Vessel-specific tools so they appear in tool listings and the agent-info API.
 *
 * Runtime guard: throws if the property is undefined.
 */
export function getToolDefinitions(session: PiAgentSession): Map<string, ToolDefinitionRecord> {
    const definitions = (session as unknown as InternalAgentSession)._toolDefinitions;
    if (!definitions) {
        throw internalAccessError("agentSession", "_toolDefinitions");
    }
    return definitions;
}

/**
 * Get the base tool definitions map from an AgentSession.
 *
 * Accesses `agentSession._baseToolDefinitions` — the internal Map<string, any>
 * used by `_refreshToolRegistry()` to rebuild maps from scratch. We write to
 * this map when registering Vessel-specific tools so they survive
 * internal refresh cycles.
 *
 * Runtime guard: throws if the property is undefined.
 */
export function getBaseToolDefinitions(session: PiAgentSession): Map<string, AnyAgentTool> {
    const definitions = (session as unknown as InternalAgentSession)._baseToolDefinitions;
    if (!definitions) {
        throw internalAccessError("agentSession", "_baseToolDefinitions");
    }
    return definitions;
}

/**
 * Get the extension runner from an AgentSession.
 *
 * Accesses `agentSession.extensionRunner` — the internal extension system
 * runner that holds loaded extensions and their state. Used by
 * `getMcpServerStatus()` to inspect MCP adapter connection state.
 *
 * Unlike the tool map accessors, this does NOT throw on undefined —
 * callers handle the missing case gracefully (e.g., returning an empty
 * status array). Instead, it returns `undefined` if the property is missing,
 * and the caller checks the result.
 *
 * This is intentional: the extension runner is only needed for optional
 * MCP status reporting, not core functionality.
 */
export function getExtensionRunner(session: PiAgentSession): ExtensionRunner | undefined {
    const runner = (session as unknown as InternalAgentSession).extensionRunner;
    return runner;
}

// --- ResourceLoader internal accessors ---

/**
 * Typed adapter for ResourceLoader internal properties.
 *
 * The ResourceLoader has `systemPrompt` and `appendSystemPrompt` properties
 * that are not part of the public API but are the only way to inject
 * custom/append system prompts into the agent session. We set these to
 * apply user-configured system prompt overrides and the Vessel-specific
 * append prompt.
 */
export interface ResourceLoaderAdapter {
    systemPrompt: string | undefined;
    appendSystemPrompt: string[];
}

/**
 * Get a typed adapter for the ResourceLoader's internal prompt properties.
 *
 * Accesses `session.resourceLoader.systemPrompt` and
 * `session.resourceLoader.appendSystemPrompt`. These are set during
 * `getOrCreateSession()` and `updateSessionSystemPrompt()` to apply
 * custom and append system prompts.
 *
 * Runtime guard: throws if `resourceLoader` is undefined.
 */
export function getResourceLoaderAdapter(session: PiAgentSession): ResourceLoaderAdapter {
    const rl = session.resourceLoader as unknown as InternalResourceLoader;
    if (!("systemPrompt" in rl) || !("appendSystemPrompt" in rl)) {
        throw internalAccessError("agentSession", "resourceLoader");
    }
    return rl as unknown as ResourceLoaderAdapter;
}

// --- ModelRegistry internal accessors ---

/**
 * Get the internal model list from a ModelRegistry.
 *
 * Accesses `registry.models` — the internal array of model objects
 * that includes their provider field. We read this to filter models
 * down to only those whose provider exists in Vessel's DB, preventing
 * built-in models from pi-ai's hardcoded list from shadowing
 * user-configured models.
 *
 * Runtime guard: throws if the property is undefined (the ModelRegistry
 * should always have a models array after initialization).
 */
export function getModelList(registry: ModelRegistry): Array<{ provider: string }> {
    const models = (registry as unknown as InternalModelRegistry).models;
    if (!models) {
        throw internalAccessError("ModelRegistry", "models");
    }
    return models;
}

/**
 * Set the internal model list on a ModelRegistry.
 *
 * Writes to `registry.models` after filtering. Used by
 * `filterModelsToVesselProviders()` to remove models whose provider
 * doesn't exist in Vessel's DB.
 *
 * Runtime guard: throws if the property doesn't exist on the registry object.
 */
export function setModelList(registry: ModelRegistry, models: Array<{ provider: string }>): void {
    if (!("models" in (registry as unknown as InternalModelRegistry))) {
        throw internalAccessError("ModelRegistry", "models");
    }
    (registry as unknown as InternalModelRegistry).models = models;
}
