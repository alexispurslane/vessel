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

export function useConversationSecuritySettings(conversationId: () => string): ConversationSecuritySettingsState {
    // --- UI state ---
    let loading = $state(false);
    let saving = $state(false);
    let saved = $state(false);
    let error = $state<string | null>(null);

    // Tri-state for sandbox enabled: null = inherit global, true = on, false = off
    let sandboxEnabledState: boolean | null = $state(null);
    // Tri-state for allowNet: null = inherit global, true = on, false = off
    let allowNetState: boolean | null = $state(null);
    // Tri-state for allowAllDomains: null = inherit global, true = all domains, false = specific domains only
    let allowAllDomainsState: boolean | null = $state(null);
    // deleteWorkspaceWithConversation: boolean
    let deleteWorkspaceWithConversation = $state(true);

    // Pill-based lists — null = inherit from global
    let useCustomReadPaths = $state(false);
    let readPaths = $state<Array<{ path: string; editing?: boolean }>>([]);

    let useCustomWritePaths = $state(false);
    let writePaths = $state<Array<{ path: string; editing?: boolean }>>([]);

    let useCustomDomains = $state(false);
    let allowedDomains = $state<PillItem[]>([]);

    let useCustomEnvVars = $state(false);
    let allowedEnvVars = $state<PillItem[]>([]);

    let useCustomSecrets = $state(false);
    let secrets = $state<KeyValueItem[]>([]);

    // Conversation mode: "agent" = all tools, "chat" = no tools, null = inherit global
    let agentMode: "agent" | "chat" | null = $state(null);

    // MCP server state — tri-state like sandbox/network:
    //   null  = Inherit (use per-server defaultEnabled from global settings)
    //   true  = On (custom selection of MCP servers, persisted as an explicit list)
    //   false = Off (no MCP servers at all, persisted as empty array)
    let mcpState: boolean | null = $state(null);
    const enabledMcpServers = new SvelteSet<string>();
    let availableMcpServers = $state<McpServerInfo[]>([]);
    let mcpServerStatuses = $state<McpServerStatus[]>([]);

    function toggleMcpServer(name: string) {
        if (enabledMcpServers.has(name)) {
            enabledMcpServers.delete(name);
        } else {
            enabledMcpServers.add(name);
        }
    }

    // --- Helpers ---
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

    function loadMcpServerState(
        enabledServers: string[] | null | undefined,
        servers: McpServerInfo[],
    ): void {
        if (enabledServers == null) {
            mcpState = null;
            enabledMcpServers.clear();
            for (const s of servers.filter((s) => s.config.defaultEnabled !== false)) {
                enabledMcpServers.add(s.name);
            }
        } else if (enabledServers.length === 0) {
            mcpState = false;
            enabledMcpServers.clear();
        } else {
            mcpState = true;
            enabledMcpServers.clear();
            for (const name of enabledServers) {
                enabledMcpServers.add(name);
            }
        }
    }

    function saveCustomArraySetting<U>(items: U[], mapFn: (item: U) => string): string[] {
        return items.map(mapFn).filter(Boolean);
    }

    function buildSecretsObject(): Record<string, { value: string; hosts: string[] }> | null {
        if (!useCustomSecrets) return null;
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

    // --- Load / Save ---
    async function loadSettings() {
        loading = true;
        error = null;
        try {
            const settings = await getConversationSettings(conversationId());

            sandboxEnabledState = settings.sandboxEnabled ?? null;
            allowNetState = settings.allowNet ?? null;
            allowAllDomainsState = settings.allowAllDomains ?? null;
            deleteWorkspaceWithConversation = settings.deleteWorkspaceWithConversation ?? true;

            loadArraySetting(
                settings.extraReadPaths,
                (v) => (useCustomReadPaths = v),
                (v) => (readPaths = v),
                (p: string) => ({ path: p, editing: false }),
            );

            loadArraySetting(
                settings.extraWritePaths,
                (v) => (useCustomWritePaths = v),
                (v) => (writePaths = v),
                (p: string) => ({ path: p, editing: false }),
            );

            loadArraySetting(
                settings.allowedNetDomains,
                (v) => (useCustomDomains = v),
                (v) => (allowedDomains = v),
                (d: string) => ({ domain: d, editing: false }),
            );

            loadArraySetting(
                settings.allowEnv,
                (v) => (useCustomEnvVars = v),
                (v) => (allowedEnvVars = v),
                (e: string) => ({ name: e, editing: false }),
            );

            loadRecordSetting<{ value: string; hosts: string[] }, KeyValueItem>(
                settings.secrets,
                (v) => (useCustomSecrets = v),
                (v) => (secrets = v),
                (entries) =>
                    entries.map(([key, config]) => ({
                        key,
                        value: config.value,
                        hosts: config.hosts.join(","),
                        editing: false,
                    })),
            );

            // Load agent mode
            agentMode = settings.agentMode ?? null;

            // Load MCP server state (tri-state: null=inherit, true=custom, false=off)
            try {
                availableMcpServers = await listMcpServers();
            } catch {
                availableMcpServers = [];
            }

            loadMcpServerState(settings.enabledMcpServers, availableMcpServers);

            // Load MCP server connection statuses from the active session
            try {
                mcpServerStatuses = await getMcpServerStatus(conversationId());
            } catch {
                mcpServerStatuses = [];
            }
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to load settings";
        } finally {
            loading = false;
        }
    }

    async function saveSettings() {
        saving = true;
        error = null;
        saved = false;
        try {
            const settings: ConversationSettings = {};

            settings.sandboxEnabled = sandboxEnabledState;
            settings.allowNet = allowNetState;
            settings.allowAllDomains = allowAllDomainsState;
            settings.deleteWorkspaceWithConversation = deleteWorkspaceWithConversation;

            settings.extraReadPaths = useCustomReadPaths
                ? saveCustomArraySetting(readPaths, (p) => p.path)
                : null;
            settings.extraWritePaths = useCustomWritePaths
                ? saveCustomArraySetting(writePaths, (p) => p.path)
                : null;
            settings.allowedNetDomains = useCustomDomains
                ? saveCustomArraySetting(allowedDomains, (d) => d["domain"] as string)
                : null;
            settings.allowEnv = useCustomEnvVars
                ? saveCustomArraySetting(allowedEnvVars, (e) => e["name"] as string)
                : null;
            settings.secrets = buildSecretsObject();

            // Save agent mode
            settings.agentMode = agentMode;

            // Save MCP server state (tri-state):
            //   null  → null (inherit global defaults)
            //   true  → explicit list of enabled server names
            //   false → [] (off — no MCP servers at all)
            settings.enabledMcpServers =
                mcpState === null ? null : mcpState ? Array.from(enabledMcpServers) : [];

            const result = await updateConversationSettings(conversationId(), settings);

            if (result.restarted) {
                reconnectStream();
            }

            saved = true;
            setTimeout(() => {
                saved = false;
            }, 2000);
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to save settings";
        } finally {
            saving = false;
        }
    }

    // Auto-load when conversationId changes
    $effect(() => {
        if (conversationId()) {
            void loadSettings();
        }
    });

    return {
        get loading() {
            return loading;
        },
        get saving() {
            return saving;
        },
        get saved() {
            return saved;
        },
        get error() {
            return error;
        },
        get sandboxEnabledState() {
            return sandboxEnabledState;
        },
        set sandboxEnabledState(v: boolean | null) {
            sandboxEnabledState = v;
        },
        get allowNetState() {
            return allowNetState;
        },
        set allowNetState(v: boolean | null) {
            allowNetState = v;
        },
        get allowAllDomainsState() {
            return allowAllDomainsState;
        },
        set allowAllDomainsState(v: boolean | null) {
            allowAllDomainsState = v;
        },
        get deleteWorkspaceWithConversation() {
            return deleteWorkspaceWithConversation;
        },
        set deleteWorkspaceWithConversation(v: boolean) {
            deleteWorkspaceWithConversation = v;
        },
        get useCustomReadPaths() {
            return useCustomReadPaths;
        },
        set useCustomReadPaths(v: boolean) {
            useCustomReadPaths = v;
        },
        get readPaths() {
            return readPaths;
        },
        set readPaths(v: Array<{ path: string; editing?: boolean }>) {
            readPaths = v;
        },
        get useCustomWritePaths() {
            return useCustomWritePaths;
        },
        set useCustomWritePaths(v: boolean) {
            useCustomWritePaths = v;
        },
        get writePaths() {
            return writePaths;
        },
        set writePaths(v: Array<{ path: string; editing?: boolean }>) {
            writePaths = v;
        },
        get useCustomDomains() {
            return useCustomDomains;
        },
        set useCustomDomains(v: boolean) {
            useCustomDomains = v;
        },
        get allowedDomains() {
            return allowedDomains;
        },
        set allowedDomains(v: PillItem[]) {
            allowedDomains = v;
        },
        get useCustomEnvVars() {
            return useCustomEnvVars;
        },
        set useCustomEnvVars(v: boolean) {
            useCustomEnvVars = v;
        },
        get allowedEnvVars() {
            return allowedEnvVars;
        },
        set allowedEnvVars(v: PillItem[]) {
            allowedEnvVars = v;
        },
        get useCustomSecrets() {
            return useCustomSecrets;
        },
        set useCustomSecrets(v: boolean) {
            useCustomSecrets = v;
        },
        get secrets() {
            return secrets;
        },
        set secrets(v: KeyValueItem[]) {
            secrets = v;
        },
        get agentMode() {
            return agentMode;
        },
        set agentMode(v: "agent" | "chat" | null) {
            agentMode = v;
        },
        get mcpState() {
            return mcpState;
        },
        set mcpState(v: boolean | null) {
            mcpState = v;
        },
        get enabledMcpServers() {
            return enabledMcpServers;
        },
        get availableMcpServers() {
            return availableMcpServers;
        },
        get mcpServerStatuses() {
            return mcpServerStatuses;
        },
        toggleMcpServer,
        loadSettings,
        saveSettings,
    };
}
