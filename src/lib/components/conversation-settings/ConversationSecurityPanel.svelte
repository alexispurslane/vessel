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
    } from "$lib/components/pill-list/index.js";
    import {
        getConversationSettings,
        updateConversationSettings,
    } from "$lib/api.js";
    import type { ConversationSettings } from "$lib/types.js";
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
    // deleteWorkspaceWithConversation: boolean
    let deleteWorkspaceWithConversation = $state(true);

    // Pill-based lists — null = inherit from global
    let useCustomReadPaths = $state(false);
    let readPaths = $state<Array<{ path: string; editing?: boolean }>>([]);

    let useCustomWritePaths = $state(false);
    let writePaths = $state<Array<{ path: string; editing?: boolean }>>([]);

    let useCustomDomains = $state(false);
    let allowedDomains = $state<Array<{ domain: string; editing?: boolean }>>([]);

    let useCustomEnvVars = $state(false);
    let allowedEnvVars = $state<Array<{ name: string; editing?: boolean }>>([]);

    let useCustomSecrets = $state(false);
    let secrets = $state<Array<{ key: string; value: string; hosts: string; editing?: boolean }>>([]);

    // --- Load / Save ---
    async function loadSettings() {
        loading = true;
        error = null;
        try {
            const settings = await getConversationSettings(conversationId);

            sandboxEnabledState = settings.sandboxEnabled ?? null;
            allowNetState = settings.allowNet ?? null;
            deleteWorkspaceWithConversation = settings.deleteWorkspaceWithConversation ?? true;

            if (settings.extraReadPaths !== null && settings.extraReadPaths !== undefined) {
                useCustomReadPaths = true;
                readPaths = settings.extraReadPaths.map((p: string) => ({ path: p, editing: false }));
            } else {
                useCustomReadPaths = false;
                readPaths = [];
            }

            if (settings.extraWritePaths !== null && settings.extraWritePaths !== undefined) {
                useCustomWritePaths = true;
                writePaths = settings.extraWritePaths.map((p: string) => ({ path: p, editing: false }));
            } else {
                useCustomWritePaths = false;
                writePaths = [];
            }

            if (settings.allowedNetDomains !== null && settings.allowedNetDomains !== undefined) {
                useCustomDomains = true;
                allowedDomains = settings.allowedNetDomains.map((d: string) => ({ domain: d, editing: false }));
            } else {
                useCustomDomains = false;
                allowedDomains = [];
            }

            if (settings.allowEnv !== null && settings.allowEnv !== undefined) {
                useCustomEnvVars = true;
                allowedEnvVars = settings.allowEnv.map((e: string) => ({ name: e, editing: false }));
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
            settings.deleteWorkspaceWithConversation = deleteWorkspaceWithConversation;

            settings.extraReadPaths = useCustomReadPaths
                ? readPaths.map((p) => p.path).filter(Boolean)
                : null;

            settings.extraWritePaths = useCustomWritePaths
                ? writePaths.map((p) => p.path).filter(Boolean)
                : null;

            settings.allowedNetDomains = useCustomDomains
                ? allowedDomains.map((d) => d.domain).filter(Boolean)
                : null;

            settings.allowEnv = useCustomEnvVars
                ? allowedEnvVars.map((e) => e.name).filter(Boolean)
                : null;

            if (useCustomSecrets) {
                const secretsObj: Record<string, { value: string; hosts: string[] }> = {};
                for (const s of secrets) {
                    if (s.key.trim()) {
                        secretsObj[s.key.trim()] = {
                            value: s.value,
                            hosts: s.hosts.split(",").map((h: string) => h.trim()).filter(Boolean),
                        };
                    }
                }
                settings.secrets = secretsObj;
            } else {
                settings.secrets = null;
            }

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
                    <p class="text-xs text-green-600">Settings saved{#if sandboxEnabledState !== null || allowNetState !== null || useCustomReadPaths || useCustomWritePaths || useCustomDomains || useCustomEnvVars || useCustomSecrets}. Session will restart on next interaction.{/if}</p>
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
                                class="px-2.5 py-1 text-xs rounded-md border transition-colors {sandboxEnabledState === null ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}"
                                onclick={() => (sandboxEnabledState = null)}
                            >
                                Inherit
                            </button>
                            <button
                                class="px-2.5 py-1 text-xs rounded-md border transition-colors {sandboxEnabledState === true ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}"
                                onclick={() => (sandboxEnabledState = true)}
                            >
                                On
                            </button>
                            <button
                                class="px-2.5 py-1 text-xs rounded-md border transition-colors {sandboxEnabledState === false ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}"
                                onclick={() => (sandboxEnabledState = false)}
                            >
                                Off
                            </button>
                        </div>
                    </div>
                </div>

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
                                    {allowNetState === null ? "Inheriting global" : allowNetState ? "Allowed" : "Denied"}
                                </p>
                            </div>
                            <div class="flex gap-1.5">
                                <button
                                    class="px-2.5 py-1 text-xs rounded-md border transition-colors {allowNetState === null ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}"
                                    onclick={() => (allowNetState = null)}
                                >
                                    Inherit
                                </button>
                                <button
                                    class="px-2.5 py-1 text-xs rounded-md border transition-colors {allowNetState === true ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}"
                                    onclick={() => (allowNetState = true)}
                                >
                                    Allow
                                </button>
                                <button
                                    class="px-2.5 py-1 text-xs rounded-md border transition-colors {allowNetState === false ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}"
                                    onclick={() => (allowNetState = false)}
                                >
                                    Deny
                                </button>
                            </div>
                        </div>

                        {#if allowNetState === true}
                            <div class="mt-3 space-y-2">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <Label class="text-xs font-medium">Allowed Domains</Label>
                                        <p class="text-xs text-muted-foreground mt-0.5">
                                            {useCustomDomains ? "Custom domains" : "Inheriting global"}
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

                            <Separator class="my-3" />

                            <div class="space-y-2">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <Label class="text-xs font-medium">Secrets</Label>
                                        <p class="text-xs text-muted-foreground mt-0.5">
                                            {useCustomSecrets ? "Custom secrets" : "Inheriting global"}
                                        </p>
                                    </div>
                                    <Switch bind:checked={useCustomSecrets} />
                                </div>
                                {#if useCustomSecrets}
                                    <PillKeyValueList
                                        items={secrets}
                                        fields={[
                                            { key: "key", placeholder: "KEY", width: "w-20", mono: true },
                                            { key: "value", placeholder: "value", width: "w-20", type: "password", viewDisplay: "mask" },
                                            { key: "hosts", placeholder: "hosts", width: "w-20", showInView: false },
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
