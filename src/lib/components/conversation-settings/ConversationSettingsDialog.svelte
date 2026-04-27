<script lang="ts">
    import {
        Dialog,
        DialogContent,
        DialogHeader,
        DialogTitle,
        DialogFooter,
    } from "$lib/components/ui/dialog/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Switch } from "$lib/components/ui/switch/index.js";
    import { Label } from "$lib/components/ui/label/index.js";
    import { Separator } from "$lib/components/ui/separator/index.js";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import {
        PillList,
        PathAutocompletePillList,
        PillKeyValueList,
        type PillItem,
        type KeyValueItem,
    } from "$lib/components/pill-list/index.js";
    import { getConversationSettings, updateConversationSettings } from "$lib/api.js";
    import type { ConversationSettings } from "$lib/types.js";
    import { reconnectStream } from "$lib/stores/chat.svelte.js";
    import Shield from "@lucide/svelte/icons/shield";
    import Check from "@lucide/svelte/icons/check";

    interface Props {
        /** The conversation ID */
        conversationId: string;
        /** Whether the dialog is open */
        open: boolean;
        /** Callback when the dialog should close */
        onOpenChange: (open: boolean) => void;
    }

    let { conversationId, open, onOpenChange }: Props = $props();

    // Internal open state synced with prop, so bind:open works inside
    let internalOpen = $state(open);

    // Sync prop -> internal state
    $effect(() => {
        internalOpen = open;
    });

    // When internal state changes, notify parent
    function handleOpenChange(value: boolean) {
        internalOpen = value;
        onOpenChange(value);
    }

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

    // Load settings when dialog opens
    $effect(() => {
        if (open && conversationId) {
            loadSettings();
        }
    });
</script>

<Dialog bind:open={internalOpen} onOpenChange={handleOpenChange}>
    <DialogContent class="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
                <Shield class="h-5 w-5" />
                Conversation Settings
            </DialogTitle>
        </DialogHeader>

        {#if loading}
            <div class="flex items-center justify-center py-8">
                <Spinner class="h-6 w-6" />
            </div>
        {:else}
            <div class="space-y-6">
                {#if error}
                    <p class="text-sm text-destructive">{error}</p>
                {/if}

                {#if saved}
                    <p class="text-sm text-green-600">
                        Settings saved{#if sandboxEnabledState !== null || allowNetState !== null || useCustomReadPaths || useCustomWritePaths || useCustomDomains || useCustomEnvVars || useCustomSecrets || agentMode !== null}.
                            Session will restart on next interaction.{/if}
                    </p>
                {/if}

                <!-- Sandbox Enabled -->
                <div class="rounded-lg border p-4">
                    <div class="space-y-3">
                        <div>
                            <Label class="text-base font-medium">Sandbox</Label>
                            <p class="text-sm text-muted-foreground mt-1">
                                Control whether this conversation uses a sandbox. When "Inherit" is
                                selected, the global sandbox setting applies.
                            </p>
                        </div>
                        <div class="flex gap-2">
                            <button
                                class="px-3 py-1.5 text-sm rounded-md border transition-colors {sandboxEnabledState ===
                                null
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted'}"
                                onclick={() => (sandboxEnabledState = null)}
                            >
                                Inherit
                            </button>
                            <button
                                class="px-3 py-1.5 text-sm rounded-md border transition-colors {sandboxEnabledState ===
                                true
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted'}"
                                onclick={() => (sandboxEnabledState = true)}
                            >
                                On
                            </button>
                            <button
                                class="px-3 py-1.5 text-sm rounded-md border transition-colors {sandboxEnabledState ===
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
                <div class="rounded-lg border p-4">
                    <div class="space-y-3">
                        <div>
                            <Label class="text-base font-medium">Mode</Label>
                            <p class="text-sm text-muted-foreground mt-1">
                                Agent mode enables all tools (read, write, bash, fetch, etc.). Chat
                                mode disables tools for plain conversation.
                            </p>
                        </div>
                        <div class="flex gap-2">
                            <button
                                class="px-3 py-1.5 text-sm rounded-md border transition-colors {agentMode ===
                                null
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted'}"
                                onclick={() => (agentMode = null)}
                            >
                                Inherit
                            </button>
                            <button
                                class="px-3 py-1.5 text-sm rounded-md border transition-colors {agentMode ===
                                'agent'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted'}"
                                onclick={() => (agentMode = "agent")}
                            >
                                Agent
                            </button>
                            <button
                                class="px-3 py-1.5 text-sm rounded-md border transition-colors {agentMode ===
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

                {#if sandboxEnabledState !== false}
                    <!-- Extra Read Paths -->
                    <div class="rounded-lg border p-4 space-y-3">
                        <div class="flex items-center justify-between">
                            <div>
                                <Label class="text-base font-medium">Extra Read Paths</Label>
                                <p class="text-sm text-muted-foreground mt-1">
                                    {useCustomReadPaths
                                        ? "Custom paths for this conversation"
                                        : "Using global settings"}
                                </p>
                            </div>
                            <Switch bind:checked={useCustomReadPaths} />
                        </div>
                        {#if useCustomReadPaths}
                            <PathAutocompletePillList
                                items={readPaths}
                                onChange={(items) => (readPaths = items)}
                                addPlaceholder="/path/to/directory"
                                addButtonLabel="Add Path"
                            />
                        {/if}
                    </div>

                    <!-- Extra Write Paths -->
                    <div class="rounded-lg border p-4 space-y-3">
                        <div class="flex items-center justify-between">
                            <div>
                                <Label class="text-base font-medium">Extra Write Paths</Label>
                                <p class="text-sm text-muted-foreground mt-1">
                                    {useCustomWritePaths
                                        ? "Custom paths for this conversation"
                                        : "Using global settings"}
                                </p>
                            </div>
                            <Switch bind:checked={useCustomWritePaths} />
                        </div>
                        {#if useCustomWritePaths}
                            <PathAutocompletePillList
                                items={writePaths}
                                onChange={(items) => (writePaths = items)}
                                addPlaceholder="/path/to/directory"
                                addButtonLabel="Add Path"
                            />
                        {/if}
                    </div>

                    <Separator />

                    <!-- Network Access -->
                    <div class="rounded-lg border p-4">
                        <div class="space-y-3">
                            <div>
                                <Label class="text-base font-medium">Network Access</Label>
                                <p class="text-sm text-muted-foreground mt-1">
                                    {allowNetState === null
                                        ? "Using global settings"
                                        : allowNetState
                                          ? "Network access allowed"
                                          : "Network access denied"}
                                </p>
                            </div>
                            <div class="flex gap-2">
                                <button
                                    class="px-3 py-1.5 text-sm rounded-md border transition-colors {allowNetState ===
                                    null
                                        ? 'bg-primary text-primary-foreground'
                                        : 'hover:bg-muted'}"
                                    onclick={() => (allowNetState = null)}
                                >
                                    Inherit
                                </button>
                                <button
                                    class="px-3 py-1.5 text-sm rounded-md border transition-colors {allowNetState ===
                                    true
                                        ? 'bg-primary text-primary-foreground'
                                        : 'hover:bg-muted'}"
                                    onclick={() => (allowNetState = true)}
                                >
                                    Allow
                                </button>
                                <button
                                    class="px-3 py-1.5 text-sm rounded-md border transition-colors {allowNetState ===
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
                            <div class="mt-4 space-y-3 mb-4">
                                <div>
                                    <Label class="text-sm font-medium">Domain Access</Label>
                                    <p class="text-xs text-muted-foreground mt-0.5">
                                        {allowAllDomainsState === null
                                            ? "Using global settings"
                                            : allowAllDomainsState
                                              ? "All domains allowed"
                                              : "Specific domains only"}
                                    </p>
                                </div>
                                <div class="flex gap-2">
                                    <button
                                        class="px-3 py-1.5 text-sm rounded-md border transition-colors {allowAllDomainsState ===
                                        null
                                            ? 'bg-primary text-primary-foreground'
                                            : 'hover:bg-muted'}"
                                        onclick={() => (allowAllDomainsState = null)}
                                    >
                                        Inherit
                                    </button>
                                    <button
                                        class="px-3 py-1.5 text-sm rounded-md border transition-colors {allowAllDomainsState ===
                                        true
                                            ? 'bg-primary text-primary-foreground'
                                            : 'hover:bg-muted'}"
                                        onclick={() => (allowAllDomainsState = true)}
                                    >
                                        All Domains
                                    </button>
                                    <button
                                        class="px-3 py-1.5 text-sm rounded-md border transition-colors {allowAllDomainsState ===
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
                                <div class="mt-2 space-y-3 mb-4">
                                    <div class="flex items-center justify-between">
                                        <div>
                                            <Label class="text-sm font-medium"
                                                >Allowed Domains</Label
                                            >
                                            <p class="text-xs text-muted-foreground mt-0.5">
                                                {useCustomDomains
                                                    ? "Custom domains for this conversation"
                                                    : "Using global settings"}
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
                                            addButtonLabel="Add Domain"
                                            inputWidth="w-36"
                                        />
                                    {/if}
                                </div>
                            {/if}

                            <Separator />

                            <div class="mt-4 space-y-3">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <Label class="text-sm font-medium">Secrets</Label>
                                        <p class="text-xs text-muted-foreground mt-0.5">
                                            {useCustomSecrets
                                                ? "Custom secrets for this conversation"
                                                : "Using global settings"}
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
                    <div class="rounded-lg border p-4 space-y-3">
                        <div class="flex items-center justify-between">
                            <div>
                                <Label class="text-base font-medium"
                                    >Allowed Environment Variables</Label
                                >
                                <p class="text-sm text-muted-foreground mt-1">
                                    {useCustomEnvVars
                                        ? "Custom env vars for this conversation"
                                        : "Using global settings"}
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
                                addButtonLabel="Add Variable"
                                inputWidth="w-28"
                            />
                        {/if}
                    </div>
                {/if}

                <Separator />

                <!-- Delete workspace with conversation -->
                <div class="flex items-center justify-between rounded-lg border p-4">
                    <div class="space-y-0.5">
                        <Label class="text-base font-medium">Delete workspace on trash</Label>
                        <p class="text-sm text-muted-foreground">
                            When enabled, the sandbox workspace is permanently deleted when you
                            trash this conversation.
                        </p>
                    </div>
                    <Switch bind:checked={deleteWorkspaceWithConversation} />
                </div>
            </div>
        {/if}

        <DialogFooter>
            <Button variant="outline" onclick={() => handleOpenChange(false)}>Cancel</Button>
            <Button onclick={saveSettings} disabled={saving}>
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
        </DialogFooter>
    </DialogContent>
</Dialog>
