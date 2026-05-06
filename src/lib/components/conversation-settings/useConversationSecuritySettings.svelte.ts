/**
 * @file Reactive store for per-conversation security and sandbox settings.
 */
import { SvelteSet } from "svelte/reactivity";
import {
    getConversationSettings,
    updateConversationSettings,
    listMcpServers,
    getMcpServerStatus,
    type McpServerInfo,
    type McpServerStatus,
} from "$lib/api.js";
import type { ConversationSettings } from "$lib/types.js";
import type { PillItem, KeyValueItem } from "$lib/components/pill-list/index.js";
import { reconnectStream } from "$lib/stores/chat.svelte.js";

export type TriState = boolean | null;
export type AgentMode = "agent" | "chat" | null;

export interface ConversationSecuritySettingsState {
    loading: boolean;
    saving: boolean;
    saved: boolean;
    error: string | null;
    sandboxEnabledState: TriState;
    allowNetState: TriState;
    allowAllDomainsState: TriState;
    deleteWorkspaceWithConversation: boolean;
    useCustomReadPaths: boolean;
    readPaths: Array<{ path: string; editing?: boolean }>;
    useCustomWritePaths: boolean;
    writePaths: Array<{ path: string; editing?: boolean }>;
    useCustomDomains: boolean;
    allowedDomains: PillItem[];
    useCustomEnvVars: boolean;
    allowedEnvVars: PillItem[];
    useCustomSecrets: boolean;
    secrets: KeyValueItem[];
    agentMode: AgentMode;
    mcpState: TriState;
    enabledMcpServers: InstanceType<typeof SvelteSet<string>>;
    availableMcpServers: McpServerInfo[];
    mcpServerStatuses: McpServerStatus[];
    toggleMcpServer: (name: string) => void;
    loadSettings: () => Promise<void>;
    saveSettings: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Module-level helpers (pure or near-pure – no closure over state)
// ---------------------------------------------------------------------------

/**
 * Populates a flag/items pair from a nullable array setting.
 *
 * @param value   The raw array from the server (null = inherit global)
 * @param setFlag Callback to set the "use custom" flag
 * @param setItems Callback to set the mapped items
 * @param mapFn  Transform each raw element into a UI item
 */
function loadArraySetting<T, U>(
    value: T[] | null | undefined,
    setFlag: (v: boolean) => void,
    setItems: (v: U[]) => void,
    mapFn: (item: T) => U,
): void {
    if (value != null) {
        setFlag(true);
        setItems(value.map(mapFn));
    } else {
        setFlag(false);
        setItems([]);
    }
}

/**
 * Populates a flag/items pair from a nullable record setting.
 *
 * @param value   The raw record from the server (null = inherit global)
 * @param setFlag Callback to set the "use custom" flag
 * @param setItems Callback to set the mapped items
 * @param mapFn  Transform the entries array into UI items
 */
function loadRecordSetting<V, U>(
    value: Record<string, V> | null | undefined,
    setFlag: (v: boolean) => void,
    setItems: (v: U[]) => void,
    mapFn: (entries: [string, V][]) => U[],
): void {
    if (value != null) {
        setFlag(true);
        setItems(mapFn(Object.entries(value)));
    } else {
        setFlag(false);
        setItems([]);
    }
}

/**
 * Applies MCP server tri-state logic to the enabled set.
 *
 * @param enabledServers The persisted list (null = inherit, [] = off, else custom)
 * @param servers        All available MCP servers
 * @param mcpSet         The SvelteSet to mutate
 * @returns The resolved tri-state value
 */
function loadMcpServerState(
    enabledServers: string[] | null | undefined,
    servers: McpServerInfo[],
    mcpSet: SvelteSet<string>,
): boolean | null {
    if (enabledServers == null) {
        mcpSet.clear();
        for (const s of servers.filter((s) => s.config.defaultEnabled !== false)) {
            mcpSet.add(s.name);
        }
        return null;
    }
    if (enabledServers.length === 0) {
        mcpSet.clear();
        return false;
    }
    mcpSet.clear();
    for (const name of enabledServers) {
        mcpSet.add(name);
    }
    return true;
}

/**
 * Maps UI items back to a plain string array for persistence.
 *
 * @param items The UI items
 * @param mapFn Extracts the string value from each item
 * @returns A filtered string array
 */
function saveCustomArraySetting<U>(items: U[], mapFn: (item: U) => string): string[] {
    return items.map(mapFn).filter(Boolean);
}

/**
 * Builds a secrets record from UI items for persistence.
 *
 * @param useCustom Whether custom secrets are enabled
 * @param secrets   The UI secret items
 * @returns A record keyed by secret name, or null when inheriting
 */
function buildSecretsObject(
    useCustom: boolean,
    secrets: KeyValueItem[],
): Record<string, { value: string; hosts: string[] }> | null {
    if (!useCustom) return null;
    const secretsObj: Record<string, { value: string; hosts: string[] }> = {};
    for (const s of secrets) {
        const key = s["key"] as string;
        const value = s["value"] as string;
        const hosts = s["hosts"] as string;
        if (key.trim()) {
            secretsObj[key.trim()] = {
                value,
                hosts: hosts
                    .split(",")
                    .map((h: string) => h.trim())
                    .filter(Boolean),
            };
        }
    }
    return secretsObj;
}

// ---------------------------------------------------------------------------
// Factory — creates a fresh state object wrapped in $state
// ---------------------------------------------------------------------------

/**
 * Creates a new ConversationSecuritySettingsState with default values.
 * The returned object is wrapped in `$state` so Svelte proxies handle
 * reactivity — consumers can read/write properties directly.
 *
 * @returns A reactive settings state object
 */
export function createConversationSecuritySettings(): ConversationSecuritySettingsState {
    const enabledMcpServers = new SvelteSet<string>();

    return $state({
        loading: false,
        saving: false,
        saved: false,
        error: null as string | null,
        sandboxEnabledState: null as TriState,
        allowNetState: null as TriState,
        allowAllDomainsState: null as TriState,
        deleteWorkspaceWithConversation: true,
        useCustomReadPaths: false,
        readPaths: [] as Array<{ path: string; editing?: boolean }>,
        useCustomWritePaths: false,
        writePaths: [] as Array<{ path: string; editing?: boolean }>,
        useCustomDomains: false,
        allowedDomains: [] as PillItem[],
        useCustomEnvVars: false,
        allowedEnvVars: [] as PillItem[],
        useCustomSecrets: false,
        secrets: [] as KeyValueItem[],
        agentMode: null as AgentMode,
        mcpState: null as TriState,
        enabledMcpServers,
        availableMcpServers: [] as McpServerInfo[],
        mcpServerStatuses: [] as McpServerStatus[],
        toggleMcpServer(name: string) {
            if (enabledMcpServers.has(name)) {
                // SvelteSet.delete(), not a route handler
                // oxlint-disable-next-line secure-coding/no-missing-authentication
                enabledMcpServers.delete(name);
            } else {
                enabledMcpServers.add(name);
            }
        },
        async loadSettings() {
            throw new Error("loadSettings not bound — use useConversationSecuritySettings");
        },
        async saveSettings() {
            throw new Error("saveSettings not bound — use useConversationSecuritySettings");
        },
    });
}

// ---------------------------------------------------------------------------
// Module-level load / save (state + ID passed in — no closure needed)
// ---------------------------------------------------------------------------

/**
 * Applies the scalar and array-based settings from the server response
 * onto the reactive state object.
 *
 * @param s       The reactive state object
 * @param settings The raw settings from the server
 */
function populateSettings(
    s: ConversationSecuritySettingsState,
    settings: ConversationSettings,
): void {
    s.sandboxEnabledState = settings.sandboxEnabled ?? null;
    s.allowNetState = settings.allowNet ?? null;
    s.allowAllDomainsState = settings.allowAllDomains ?? null;
    s.deleteWorkspaceWithConversation =
        settings.deleteWorkspaceWithConversation ?? true;

    loadArraySetting(
        settings.extraReadPaths,
        (v) => (s.useCustomReadPaths = v),
        (v) => (s.readPaths = v),
        (p: string) => ({ path: p, editing: false }),
    );

    loadArraySetting(
        settings.extraWritePaths,
        (v) => (s.useCustomWritePaths = v),
        (v) => (s.writePaths = v),
        (p: string) => ({ path: p, editing: false }),
    );

    loadArraySetting(
        settings.allowedNetDomains,
        (v) => (s.useCustomDomains = v),
        (v) => (s.allowedDomains = v),
        (d: string) => ({ domain: d, editing: false }),
    );

    loadArraySetting(
        settings.allowEnv,
        (v) => (s.useCustomEnvVars = v),
        (v) => (s.allowedEnvVars = v),
        (e: string) => ({ name: e, editing: false }),
    );

    loadRecordSetting<{ value: string; hosts: string[] }, KeyValueItem>(
        settings.secrets,
        (v) => (s.useCustomSecrets = v),
        (v) => (s.secrets = v),
        (entries) =>
            entries.map(([key, config]) => ({
                key,
                value: config.value,
                hosts: config.hosts.join(","),
                editing: false,
            })),
    );

    s.agentMode = settings.agentMode ?? null;
}

/**
 * Fetches conversation settings from the server and populates the state.
 *
 * @param s              The reactive state object
 * @param conversationId A function returning the current conversation ID
 */
async function loadSettingsInto(
    s: ConversationSecuritySettingsState,
    conversationId: () => string,
): Promise<void> {
    s.loading = true;
    s.error = null;
    try {
        const settings = await getConversationSettings(conversationId());

        populateSettings(s, settings);

        try {
            s.availableMcpServers = await listMcpServers();
        } catch {
            s.availableMcpServers = [];
        }

        s.mcpState = loadMcpServerState(
            settings.enabledMcpServers,
            s.availableMcpServers,
            s.enabledMcpServers,
        );

        try {
            s.mcpServerStatuses = await getMcpServerStatus(conversationId());
        } catch {
            s.mcpServerStatuses = [];
        }
    } catch (e) {
        s.error = e instanceof Error ? e.message : "Failed to load settings";
    } finally {
        s.loading = false;
    }
}

/**
 * Reads current state and persists it to the server.
 *
 * @param s              The reactive state object
 * @param conversationId A function returning the current conversation ID
 */
async function saveSettingsFrom(
    s: ConversationSecuritySettingsState,
    conversationId: () => string,
): Promise<void> {
    s.saving = true;
    s.error = null;
    s.saved = false;
    try {
        const settings: ConversationSettings = {};

        settings.sandboxEnabled = s.sandboxEnabledState;
        settings.allowNet = s.allowNetState;
        settings.allowAllDomains = s.allowAllDomainsState;
        settings.deleteWorkspaceWithConversation =
            s.deleteWorkspaceWithConversation;

        settings.extraReadPaths = s.useCustomReadPaths
            ? saveCustomArraySetting(s.readPaths, (p) => p.path)
            : null;
        settings.extraWritePaths = s.useCustomWritePaths
            ? saveCustomArraySetting(s.writePaths, (p) => p.path)
            : null;
        settings.allowedNetDomains = s.useCustomDomains
            ? saveCustomArraySetting(s.allowedDomains, (d) => d["domain"] as string)
            : null;
        settings.allowEnv = s.useCustomEnvVars
            ? saveCustomArraySetting(s.allowedEnvVars, (e) => e["name"] as string)
            : null;
        settings.secrets = buildSecretsObject(s.useCustomSecrets, s.secrets);

        settings.agentMode = s.agentMode;

        // MCP tri-state: null→inherit, true→explicit list, false→off
        settings.enabledMcpServers =
            s.mcpState === null ? null : s.mcpState ? Array.from(s.enabledMcpServers) : [];

        const result = await updateConversationSettings(
            conversationId(),
            settings,
        );

        if (result.restarted) {
            reconnectStream();
        }

        s.saved = true;
        setTimeout(() => {
            s.saved = false;
        }, 2000);
    } catch (e) {
        s.error = e instanceof Error ? e.message : "Failed to save settings";
    } finally {
        s.saving = false;
    }
}

// ---------------------------------------------------------------------------
// Hook — wires load/save to a specific conversation and auto-loads
// ---------------------------------------------------------------------------

/**
 * Reactive store for per-conversation security and sandbox settings.
 * Loads settings from the server and provides save/reload functions.
 *
 * @param conversationId - A function returning the current conversation ID
 * @returns The conversation security settings state
 */
export function useConversationSecuritySettings(
    conversationId: () => string,
): ConversationSecuritySettingsState {
    const s = createConversationSecuritySettings();

    s.loadSettings = () => loadSettingsInto(s, conversationId);
    s.saveSettings = () => saveSettingsFrom(s, conversationId);

    // Auto-load when conversationId changes
    $effect(() => {
        if (conversationId()) {
            void s.loadSettings();
        }
    });

    return s;
}
