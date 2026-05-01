<script lang="ts">
    import { Button } from "$lib/components/ui/button/index.js";
    import { Switch } from "$lib/components/ui/switch/index.js";
    import { Label } from "$lib/components/ui/label/index.js";
    import { Separator } from "$lib/components/ui/separator/index.js";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    import {
        PillList,
        PathAutocompletePillList,
        PillKeyValueList,
        type PillItem,
        type KeyValueItem,
    } from "$lib/components/pill-list/index.js";
    import {
        getConversationSettings,
        updateConversationSettings,
        listMcpServers,
        type McpServerInfo,
        getMcpServerStatus,
        type McpServerStatus,
    } from "$lib/api.js";
    import type { ConversationSettings } from "$lib/types.js";
    import { SvelteSet } from "svelte/reactivity";
    import { reconnectStream } from "$lib/stores/chat.svelte.js";
    import Shield from "@lucide/svelte/icons/shield";
    import Check from "@lucide/svelte/icons/check";

    interface Props {
        /** The conversation ID */
        conversationId: string;
    }

    let { conversationId }: Props = $props();

    // --- State ---
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
    let enabledMcpServers = new SvelteSet<string>();
    let availableMcpServers = $state<McpServerInfo[]>([]);
    let mcpServerStatuses = $state<McpServerStatus[]>([]);

    // --- Load / Save ---
    async function loadSettings() {
        loading = true;
        error = null;
        try {
            const settings = await getConversationSettings(conversationId);

            sandboxEnabledState = settings.sandboxEnabled ?? null;
            allowNetState = settings.allowNet ?? null;
            allowAllDomainsState = settings.allowAllDomains ?? null;
            deleteWorkspaceWithConversation = settings.deleteWorkspaceWithConversation ?? true;

            if (settings.extraReadPaths !== null && settings.extraReadPaths !== undefined) {
                useCustomReadPaths = true;
                readPaths = settings.extraReadPaths.map((p: string) => ({
                    path: p,
                    editing: false,
                }));
            } else {
                useCustomReadPaths = false;
                readPaths = [];
            }

            if (settings.extraWritePaths !== null && settings.extraWritePaths !== undefined) {
                useCustomWritePaths = true;
                writePaths = settings.extraWritePaths.map((p: string) => ({
                    path: p,
                    editing: false,
                }));
            } else {
                useCustomWritePaths = false;
                writePaths = [];
            }

            if (settings.allowedNetDomains !== null && settings.allowedNetDomains !== undefined) {
                useCustomDomains = true;
                allowedDomains = settings.allowedNetDomains.map((d: string) => ({
                    domain: d,
                    editing: false,
                }));
            } else {
                useCustomDomains = false;
                allowedDomains = [];
            }

            if (settings.allowEnv !== null && settings.allowEnv !== undefined) {
                useCustomEnvVars = true;
                allowedEnvVars = settings.allowEnv.map((e: string) => ({
                    name: e,
                    editing: false,
                }));
            } else {
                useCustomEnvVars = false;
                allowedEnvVars = [];
            }

            if (settings.secrets !== null && settings.secrets !== undefined) {
                useCustomSecrets = true;
                secrets = Object.entries(settings.secrets).map(([key, config]) => ({
                    key,
                    value: config.value,
                    hosts: config.hosts.join(","),
                    editing: false,
                }));
            } else {
                useCustomSecrets = false;
                secrets = [];
            }

            // Load agent mode
            agentMode = settings.agentMode ?? null;

            // Load MCP server state (tri-state: null=inherit, true=custom, false=off)
            try {
                availableMcpServers = await listMcpServers();
            } catch {
                availableMcpServers = [];
            }

            if (settings.enabledMcpServers === null || settings.enabledMcpServers === undefined) {
                // No per-conversation override — inherit global defaults
                mcpState = null;
                // Pre-populate from global defaults so toggles are ready if user switches to On
                enabledMcpServers.clear();
                for (const s of availableMcpServers.filter(
                    (s) => s.config.defaultEnabled !== false
                )) {
                    enabledMcpServers.add(s.name);
                }
            } else if (settings.enabledMcpServers.length === 0) {
                // Explicitly off — no MCP servers
                mcpState = false;
                enabledMcpServers.clear();
            } else {
                // Explicit custom list
                mcpState = true;
                enabledMcpServers.clear();
                for (const name of settings.enabledMcpServers) {
                    enabledMcpServers.add(name);
                }
            }

            // Load MCP server connection statuses from the active session
            try {
                mcpServerStatuses = await getMcpServerStatus(conversationId);
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
                ? readPaths.map((p) => p.path).filter(Boolean)
                : null;

            settings.extraWritePaths = useCustomWritePaths
                ? writePaths.map((p) => p.path).filter(Boolean)
                : null;

            settings.allowedNetDomains = useCustomDomains
                ? allowedDomains.map((d) => d["domain"] as string).filter(Boolean)
                : null;

            settings.allowEnv = useCustomEnvVars
                ? allowedEnvVars.map((e) => e["name"] as string).filter(Boolean)
                : null;

            if (useCustomSecrets) {
                const secretsObj: Record<string, { value: string; hosts: string[] }> = {};
                for (const s of secrets) {
                    const key = (s["key"] as string) ?? "";
                    const value = (s["value"] as string) ?? "";
                    const hosts = (s["hosts"] as string) ?? "";
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
                settings.secrets = secretsObj;
            } else {
                settings.secrets = null;
            }

            // Save agent mode
            settings.agentMode = agentMode;

            // Save MCP server state (tri-state):
            //   null  → null (inherit global defaults)
            //   true  → explicit list of enabled server names
            //   false → [] (off — no MCP servers at all)
            settings.enabledMcpServers =
                mcpState === null ? null : mcpState === true ? Array.from(enabledMcpServers) : [];

            const result = await updateConversationSettings(conversationId, settings);

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

    // Load settings when the panel's conversation changes
    $effect(() => {
        if (conversationId) {
            loadSettings();
        }
    });
</script>

<div class="flex flex-col h-full">
    <!-- Panel header -->
    <div class="flex items-center gap-1.5 px-3 py-2 border-b text-muted-foreground">
        <Shield class="size-3.5" />
        <span class="font-medium text-xs">Security</span>
    </div>

    <!-- Scrollable content -->
    <ScrollArea class="flex-1 min-h-0">
        <div class="p-4 space-y-4">
            {#if loading}
                <div class="flex items-center justify-center py-8">
                    <Spinner class="h-6 w-6" />
                </div>
            {:else}
                {#if error}
                    <p class="text-xs text-destructive">{error}</p>
                {/if}

                {#if saved}
                    <p class="text-xs text-green-600">
                        Settings saved{#if sandboxEnabledState !== null || allowNetState !== null || useCustomReadPaths || useCustomWritePaths || useCustomDomains || useCustomEnvVars || useCustomSecrets || agentMode !== null}.
                            Session will restart on next interaction.{/if}
                    </p>
                {/if}

                <!-- Sandbox Enabled -->
                <div class="rounded-lg border p-3">
                    <div class="space-y-2">
                        <div>
                            <Label class="text-sm font-medium">Sandbox</Label>
                            <p class="text-xs text-muted-foreground mt-0.5">
                                Control whether this conversation uses a sandbox.
                            </p>
                        </div>
                        <div class="flex gap-1.5">
                            <button
                                class="px-2.5 py-1 text-xs rounded-md border transition-colors {sandboxEnabledState ===
                                null
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted'}"
                                onclick={() => (sandboxEnabledState = null)}
                            >
                                Inherit
                            </button>
                            <button
                                class="px-2.5 py-1 text-xs rounded-md border transition-colors {sandboxEnabledState ===
                                true
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted'}"
                                onclick={() => (sandboxEnabledState = true)}
                            >
                                On
                            </button>
                            <button
                                class="px-2.5 py-1 text-xs rounded-md border transition-colors {sandboxEnabledState ===
                                false
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted'}"
                                onclick={() => (sandboxEnabledState = false)}
                            >
                                Off
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Agent Mode -->
                <div class="rounded-lg border p-3">
                    <div class="space-y-2">
                        <div>
                            <Label class="text-sm font-medium">Mode</Label>
                            <p class="text-xs text-muted-foreground mt-0.5">
                                Agent mode enables all tools (read, write, bash, fetch, etc.). Chat
                                mode disables tools for plain conversation.
                            </p>
                        </div>
                        <div class="flex gap-1.5">
                            <button
                                class="px-2.5 py-1 text-xs rounded-md border transition-colors {agentMode ===
                                null
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted'}"
                                onclick={() => (agentMode = null)}
                            >
                                Inherit
                            </button>
                            <button
                                class="px-2.5 py-1 text-xs rounded-md border transition-colors {agentMode ===
                                'agent'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted'}"
                                onclick={() => (agentMode = "agent")}
                            >
                                Agent
                            </button>
                            <button
                                class="px-2.5 py-1 text-xs rounded-md border transition-colors {agentMode ===
                                'chat'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted'}"
                                onclick={() => (agentMode = "chat")}
                            >
                                Chat
                            </button>
                        </div>
                    </div>
                </div>

                <!-- MCP Servers -->
                {#if availableMcpServers.length > 0}
                    <div class="rounded-lg border p-3">
                        <div class="space-y-2">
                            <div>
                                <Label class="text-sm font-medium">MCP Servers</Label>
                                <p class="text-xs text-muted-foreground mt-0.5">
                                    Control whether this conversation can use MCP servers.
                                </p>
                            </div>
                            <div class="flex gap-1.5">
                                <button
                                    class="px-2.5 py-1 text-xs rounded-md border transition-colors {mcpState ===
                                    null
                                        ? 'bg-primary text-primary-foreground'
                                        : 'hover:bg-muted'}"
                                    onclick={() => (mcpState = null)}
                                >
                                    Inherit
                                </button>
                                <button
                                    class="px-2.5 py-1 text-xs rounded-md border transition-colors {mcpState ===
                                    true
                                        ? 'bg-primary text-primary-foreground'
                                        : 'hover:bg-muted'}"
                                    onclick={() => (mcpState = true)}
                                >
                                    On
                                </button>
                                <button
                                    class="px-2.5 py-1 text-xs rounded-md border transition-colors {mcpState ===
                                    false
                                        ? 'bg-primary text-primary-foreground'
                                        : 'hover:bg-muted'}"
                                    onclick={() => (mcpState = false)}
                                >
                                    Off
                                </button>
                            </div>
                            {#if mcpState === true}
                                <div class="space-y-1.5 pt-1">
                                    {#each availableMcpServers as server (server.name)}
                                        {@const serverStatus = mcpServerStatuses.find(
                                            (s) => s.name === server.name
                                        )}
                                        <div class="flex items-center justify-between py-0.5">
                                            <div class="space-y-0.5">
                                                <div class="flex items-center gap-1.5">
                                                    <Label class="text-xs font-medium"
                                                        >{server.name}</Label
                                                    >
                                                    {#if serverStatus}
                                                        {#if serverStatus.status === "connected"}
                                                            <span
                                                                class="inline-block h-1.5 w-1.5 rounded-full bg-green-500"
                                                                title="Connected"
                                                            ></span>
                                                        {:else if serverStatus.status === "needs-auth"}
                                                            <span
                                                                class="inline-block h-1.5 w-1.5 rounded-full bg-yellow-500"
                                                                title="Needs authentication"
                                                            ></span>
                                                        {:else if serverStatus.status === "closed"}
                                                            <span
                                                                class="inline-block h-1.5 w-1.5 rounded-full bg-red-500"
                                                                title="Disconnected"
                                                            ></span>
                                                        {:else}
                                                            <span
                                                                class="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground"
                                                                title="Unknown"
                                                            ></span>
                                                        {/if}
                                                    {/if}
                                                </div>
                                                <p class="text-[10px] text-muted-foreground">
                                                    {#if server.config.command}
                                                        {server.config
                                                            .command}{#if server.config.args?.length}
                                                            {server.config.args.join(" ")}{/if}
                                                    {:else if server.config.url}
                                                        {server.config.url}
                                                    {/if}
                                                </p>
                                            </div>
                                            <Switch
                                                checked={enabledMcpServers.has(server.name)}
                                                onCheckedChange={(checked: boolean) => {
                                                    if (checked) {
                                                        enabledMcpServers.add(server.name);
                                                    } else {
                                                        enabledMcpServers.delete(server.name);
                                                    }
                                                }}
                                            />
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    </div>
                {/if}

                {#if sandboxEnabledState !== false}
                    <!-- Extra Read Paths -->
                    <div class="rounded-lg border p-3 space-y-2">
                        <div class="flex items-center justify-between">
                            <div>
                                <Label class="text-sm font-medium">Read Paths</Label>
                                <p class="text-xs text-muted-foreground mt-0.5">
                                    {useCustomReadPaths ? "Custom paths" : "Inheriting global"}
                                </p>
                            </div>
                            <Switch bind:checked={useCustomReadPaths} />
                        </div>
                        {#if useCustomReadPaths}
                            <PathAutocompletePillList
                                items={readPaths}
                                onChange={(items) => (readPaths = items)}
                                addPlaceholder="/path"
                                addButtonLabel="Add"
                            />
                        {/if}
                    </div>

                    <!-- Extra Write Paths -->
                    <div class="rounded-lg border p-3 space-y-2">
                        <div class="flex items-center justify-between">
                            <div>
                                <Label class="text-sm font-medium">Write Paths</Label>
                                <p class="text-xs text-muted-foreground mt-0.5">
                                    {useCustomWritePaths ? "Custom paths" : "Inheriting global"}
                                </p>
                            </div>
                            <Switch bind:checked={useCustomWritePaths} />
                        </div>
                        {#if useCustomWritePaths}
                            <PathAutocompletePillList
                                items={writePaths}
                                onChange={(items) => (writePaths = items)}
                                addPlaceholder="/path"
                                addButtonLabel="Add"
                            />
                        {/if}
                    </div>

                    <Separator />

                    <!-- Network Access -->
                    <div class="rounded-lg border p-3">
                        <div class="space-y-2">
                            <div>
                                <Label class="text-sm font-medium">Network Access</Label>
                                <p class="text-xs text-muted-foreground mt-0.5">
                                    {allowNetState === null
                                        ? "Inheriting global"
                                        : allowNetState
                                          ? "Allowed"
                                          : "Denied"}
                                </p>
                            </div>
                            <div class="flex gap-1.5">
                                <button
                                    class="px-2.5 py-1 text-xs rounded-md border transition-colors {allowNetState ===
                                    null
                                        ? 'bg-primary text-primary-foreground'
                                        : 'hover:bg-muted'}"
                                    onclick={() => (allowNetState = null)}
                                >
                                    Inherit
                                </button>
                                <button
                                    class="px-2.5 py-1 text-xs rounded-md border transition-colors {allowNetState ===
                                    true
                                        ? 'bg-primary text-primary-foreground'
                                        : 'hover:bg-muted'}"
                                    onclick={() => (allowNetState = true)}
                                >
                                    Allow
                                </button>
                                <button
                                    class="px-2.5 py-1 text-xs rounded-md border transition-colors {allowNetState ===
                                    false
                                        ? 'bg-primary text-primary-foreground'
                                        : 'hover:bg-muted'}"
                                    onclick={() => (allowNetState = false)}
                                >
                                    Deny
                                </button>
                            </div>
                        </div>

                        {#if allowNetState === true}
                            <Separator class="my-2" />

                            <div class="space-y-2">
                                <div>
                                    <Label class="text-xs font-medium">Domain Access</Label>
                                    <p class="text-xs text-muted-foreground mt-0.5">
                                        {allowAllDomainsState === null
                                            ? "Inheriting global"
                                            : allowAllDomainsState
                                              ? "All domains"
                                              : "Specific domains only"}
                                    </p>
                                </div>
                                <div class="flex gap-1.5">
                                    <button
                                        class="px-2.5 py-1 text-xs rounded-md border transition-colors {allowAllDomainsState ===
                                        null
                                            ? 'bg-primary text-primary-foreground'
                                            : 'hover:bg-muted'}"
                                        onclick={() => (allowAllDomainsState = null)}
                                    >
                                        Inherit
                                    </button>
                                    <button
                                        class="px-2.5 py-1 text-xs rounded-md border transition-colors {allowAllDomainsState ===
                                        true
                                            ? 'bg-primary text-primary-foreground'
                                            : 'hover:bg-muted'}"
                                        onclick={() => (allowAllDomainsState = true)}
                                    >
                                        All Domains
                                    </button>
                                    <button
                                        class="px-2.5 py-1 text-xs rounded-md border transition-colors {allowAllDomainsState ===
                                        false
                                            ? 'bg-primary text-primary-foreground'
                                            : 'hover:bg-muted'}"
                                        onclick={() => (allowAllDomainsState = false)}
                                    >
                                        Specific
                                    </button>
                                </div>
                            </div>

                            {#if allowAllDomainsState === false}
                                <div class="mt-2 space-y-2">
                                    <div class="flex items-center justify-between">
                                        <div>
                                            <Label class="text-xs font-medium"
                                                >Allowed Domains</Label
                                            >
                                            <p class="text-xs text-muted-foreground mt-0.5">
                                                {useCustomDomains
                                                    ? "Custom domains"
                                                    : "Inheriting global"}
                                            </p>
                                        </div>
                                        <Switch bind:checked={useCustomDomains} />
                                    </div>
                                    {#if useCustomDomains}
                                        <PillList
                                            items={allowedDomains}
                                            labelKey="domain"
                                            onChange={(items) => (allowedDomains = items)}
                                            addPlaceholder="example.com"
                                            addButtonLabel="Add"
                                            inputWidth="w-36"
                                        />
                                    {/if}
                                </div>
                            {/if}

                            <Separator class="my-3" />

                            <div class="space-y-2">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <Label class="text-xs font-medium">Secrets</Label>
                                        <p class="text-xs text-muted-foreground mt-0.5">
                                            {useCustomSecrets
                                                ? "Custom secrets"
                                                : "Inheriting global"}
                                        </p>
                                    </div>
                                    <Switch bind:checked={useCustomSecrets} />
                                </div>
                                {#if useCustomSecrets}
                                    <PillKeyValueList
                                        items={secrets}
                                        fields={[
                                            {
                                                key: "key",
                                                placeholder: "KEY",
                                                width: "w-20",
                                                mono: true,
                                            },
                                            {
                                                key: "value",
                                                placeholder: "value",
                                                width: "w-20",
                                                type: "password",
                                                viewDisplay: "mask",
                                            },
                                            {
                                                key: "hosts",
                                                placeholder: "hosts",
                                                width: "w-20",
                                                showInView: false,
                                            },
                                        ]}
                                        onChange={(items) => (secrets = items)}
                                        addButtonLabel="Add Secret"
                                    />
                                {/if}
                            </div>
                        {/if}
                    </div>

                    <Separator />

                    <!-- Environment Variables -->
                    <div class="rounded-lg border p-3 space-y-2">
                        <div class="flex items-center justify-between">
                            <div>
                                <Label class="text-sm font-medium">Env Variables</Label>
                                <p class="text-xs text-muted-foreground mt-0.5">
                                    {useCustomEnvVars ? "Custom env vars" : "Inheriting global"}
                                </p>
                            </div>
                            <Switch bind:checked={useCustomEnvVars} />
                        </div>
                        {#if useCustomEnvVars}
                            <PillList
                                items={allowedEnvVars}
                                labelKey="name"
                                onChange={(items) => (allowedEnvVars = items)}
                                addPlaceholder="VAR_NAME"
                                addButtonLabel="Add"
                                inputWidth="w-28"
                            />
                        {/if}
                    </div>
                {/if}

                <Separator />

                <!-- Delete workspace with conversation -->
                <div class="flex items-center justify-between rounded-lg border p-3">
                    <div class="space-y-0.5">
                        <Label class="text-sm font-medium">Delete workspace on trash</Label>
                        <p class="text-xs text-muted-foreground">
                            Delete sandbox workspace when conversation is trashed.
                        </p>
                    </div>
                    <Switch bind:checked={deleteWorkspaceWithConversation} />
                </div>

                <!-- Save button -->
                <Button onclick={saveSettings} disabled={saving} class="w-full">
                    {#if saving}
                        <Spinner class="mr-1.5 h-4 w-4" />
                        Saving...
                    {:else if saved}
                        <Check class="mr-1.5 h-4 w-4" />
                        Saved
                    {:else}
                        Save Changes
                    {/if}
                </Button>
            {/if}
        </div>
    </ScrollArea>
</div>
