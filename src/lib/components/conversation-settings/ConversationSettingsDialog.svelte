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
    } from "$lib/components/pill-list/index.js";
    import {
        getConversationSettings,
        updateConversationSettings,
    } from "$lib/api.js";
    import type { ConversationSettings } from "$lib/types.js";
    import { reconnectStream } from "$lib/stores/chat.svelte.js";
    import Shield from "@lucide/svelte/icons/shield";

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

    // Secret add/edit state
    let showNewSecretForm = $state(false);
    let newSecretKey = $state("");
    let newSecretValue = $state("");
    let newSecretHosts = $state("");
    // Track edit values locally to avoid focus-stealing
    let secretEditValues = $state<Record<number, { key: string; value: string; hosts: string }>>({});

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

    // --- Secret helpers ---
    function addNewSecret() {
        if (!newSecretKey.trim() || !newSecretValue.trim()) return;
        secrets = [...secrets, {
            key: newSecretKey.trim(),
            value: newSecretValue,
            hosts: newSecretHosts.trim(),
            editing: false,
        }];
        newSecretKey = "";
        newSecretValue = "";
        newSecretHosts = "";
        showNewSecretForm = false;
    }

    function startEditingSecret(index: number) {
        secrets = secrets.map((s, i) => ({ ...s, editing: i === index }));
        secretEditValues[index] = { key: secrets[index].key, value: secrets[index].value, hosts: secrets[index].hosts };
    }

    function saveSecretEdit(index: number) {
        const editVal = secretEditValues[index];
        if (editVal) {
            secrets = secrets.map((s, i) => i === index ? { ...editVal, editing: false } : { ...s, editing: false });
        }
        delete secretEditValues[index];
    }

    function deleteSecret(index: number) {
        secrets = secrets.filter((_, i) => i !== index);
        delete secretEditValues[index];
    }

    function cancelNewSecret() {
        showNewSecretForm = false;
        newSecretKey = "";
        newSecretValue = "";
        newSecretHosts = "";
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
                    <p class="text-sm text-green-600">Settings saved{#if sandboxEnabledState !== null || allowNetState !== null || useCustomReadPaths || useCustomWritePaths || useCustomDomains || useCustomEnvVars || useCustomSecrets}. Session will restart on next interaction.{/if}</p>
                {/if}

                <!-- Sandbox Enabled -->
                <div class="rounded-lg border p-4">
                    <div class="space-y-3">
                        <div>
                            <Label class="text-base font-medium">Sandbox</Label>
                            <p class="text-sm text-muted-foreground mt-1">
                                Control whether this conversation uses a sandbox. When "Inherit" is selected, the global sandbox setting applies.
                            </p>
                        </div>
                        <div class="flex gap-2">
                            <button
                                class="px-3 py-1.5 text-sm rounded-md border transition-colors {sandboxEnabledState === null ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}"
                                onclick={() => (sandboxEnabledState = null)}
                            >
                                Inherit
                            </button>
                            <button
                                class="px-3 py-1.5 text-sm rounded-md border transition-colors {sandboxEnabledState === true ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}"
                                onclick={() => (sandboxEnabledState = true)}
                            >
                                On
                            </button>
                            <button
                                class="px-3 py-1.5 text-sm rounded-md border transition-colors {sandboxEnabledState === false ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}"
                                onclick={() => (sandboxEnabledState = false)}
                            >
                                Off
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
                                    {useCustomReadPaths ? "Custom paths for this conversation" : "Using global settings"}
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
                                    {useCustomWritePaths ? "Custom paths for this conversation" : "Using global settings"}
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
                                    {allowNetState === null ? "Using global settings" : allowNetState ? "Network access allowed" : "Network access denied"}
                                </p>
                            </div>
                            <div class="flex gap-2">
                                <button
                                    class="px-3 py-1.5 text-sm rounded-md border transition-colors {allowNetState === null ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}"
                                    onclick={() => (allowNetState = null)}
                                >
                                    Inherit
                                </button>
                                <button
                                    class="px-3 py-1.5 text-sm rounded-md border transition-colors {allowNetState === true ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}"
                                    onclick={() => (allowNetState = true)}
                                >
                                    Allow
                                </button>
                                <button
                                    class="px-3 py-1.5 text-sm rounded-md border transition-colors {allowNetState === false ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}"
                                    onclick={() => (allowNetState = false)}
                                >
                                    Deny
                                </button>
                            </div>
                        </div>

                        {#if allowNetState === true}
                            <div class="mt-4 space-y-3">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <Label class="text-sm font-medium">Allowed Domains</Label>
                                        <p class="text-xs text-muted-foreground mt-0.5">
                                            {useCustomDomains ? "Custom domains for this conversation" : "Using global settings"}
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
                    </div>

                    <Separator />

                    <!-- Secrets -->
                    <div class="rounded-lg border p-4 space-y-3">
                        <div class="flex items-center justify-between">
                            <div>
                                <Label class="text-base font-medium">Secrets</Label>
                                <p class="text-sm text-muted-foreground mt-1">
                                    {useCustomSecrets ? "Custom secrets for this conversation" : "Using global settings"}
                                </p>
                            </div>
                            <Switch bind:checked={useCustomSecrets} />
                        </div>
                        {#if useCustomSecrets}
                            <div class="flex flex-wrap gap-2">
                                {#each secrets as secret, index (secret.key + '-' + index)}
                                    {#if secret.editing}
                                        <div class="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-sm">
                                            <input
                                                type="text"
                                                class="bg-transparent outline-none w-20 text-xs font-mono"
                                                placeholder="KEY"
                                                value={secretEditValues[index]?.key ?? secret.key}
                                                oninput={(e) => {
                                                    if (!secretEditValues[index]) secretEditValues[index] = { key: secret.key, value: secret.value, hosts: secret.hosts };
                                                    secretEditValues[index].key = e.currentTarget.value;
                                                }}
                                            />
                                            <input
                                                type="text"
                                                class="bg-transparent outline-none w-20 text-xs"
                                                placeholder="value"
                                                value={secretEditValues[index]?.value ?? secret.value}
                                                oninput={(e) => {
                                                    if (!secretEditValues[index]) secretEditValues[index] = { key: secret.key, value: secret.value, hosts: secret.hosts };
                                                    secretEditValues[index].value = e.currentTarget.value;
                                                }}
                                            />
                                            <input
                                                type="text"
                                                class="bg-transparent outline-none w-20 text-xs"
                                                placeholder="hosts"
                                                value={secretEditValues[index]?.hosts ?? secret.hosts}
                                                oninput={(e) => {
                                                    if (!secretEditValues[index]) secretEditValues[index] = { key: secret.key, value: secret.value, hosts: secret.hosts };
                                                    secretEditValues[index].hosts = e.currentTarget.value;
                                                }}
                                                onkeydown={(e) => {
                                                    if (e.key === "Enter") {
                                                        e.preventDefault();
                                                        saveSecretEdit(index);
                                                    } else if (e.key === "Escape") {
                                                        secrets = secrets.map((s, i) => ({ ...s, editing: false }));
                                                        delete secretEditValues[index];
                                                    }
                                                }}
                                            />
                                            <Button variant="ghost" size="icon" class="h-5 w-5"
                                                onclick={() => saveSecretEdit(index)}
                                            >
                                                <Check class="h-3 w-3" />
                                            </Button>
                                        </div>
                                    {:else}
                                        <div class="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-sm">
                                            <span class="font-mono font-medium text-xs">{secret.key}</span>
                                            <span class="text-muted-foreground">=</span>
                                            <span class="font-mono text-muted-foreground text-xs">•••</span>
                                            {#if secret.hosts}
                                                <span class="text-xs text-muted-foreground">({secret.hosts})</span>
                                            {/if}
                                            <Button variant="ghost" size="icon" class="h-5 w-5"
                                                onclick={() => startEditingSecret(index)}
                                            >
                                                <Pencil class="h-3 w-3" />
                                            </Button>
                                            <Button variant="ghost" size="icon" class="h-5 w-5"
                                                onclick={() => deleteSecret(index)}
                                            >
                                                <Trash2 class="h-3 w-3" />
                                            </Button>
                                        </div>
                                    {/if}
                                {/each}
                                {#if showNewSecretForm}
                                    <div class="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-sm">
                                        <input
                                            type="text"
                                            class="bg-transparent outline-none w-20 text-xs font-mono"
                                            placeholder="KEY"
                                            bind:value={newSecretKey}
                                        />
                                        <input
                                            type="text"
                                            class="bg-transparent outline-none w-20 text-xs"
                                            placeholder="value"
                                            bind:value={newSecretValue}
                                        />
                                        <input
                                            type="text"
                                            class="bg-transparent outline-none w-20 text-xs"
                                            placeholder="hosts"
                                            bind:value={newSecretHosts}
                                            onkeydown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    addNewSecret();
                                                } else if (e.key === "Escape") {
                                                    cancelNewSecret();
                                                }
                                            }}
                                        />
                                        <Button variant="ghost" size="icon" class="h-5 w-5"
                                            onclick={addNewSecret}
                                        >
                                            <Check class="h-3 w-3" />
                                        </Button>
                                        <Button variant="ghost" size="icon" class="h-5 w-5"
                                            onclick={cancelNewSecret}
                                        >
                                            <X class="h-3 w-3" />
                                        </Button>
                                    </div>
                                {:else}
                                    <Button variant="outline" size="sm" class="h-7 rounded-full"
                                        onclick={() => (showNewSecretForm = true)}
                                    >
                                        <Plus class="h-3.5 w-3.5 mr-1" />
                                        Add Secret
                                    </Button>
                                {/if}
                            </div>
                        {/if}
                    </div>

                    <Separator />

                    <!-- Environment Variables -->
                    <div class="rounded-lg border p-4 space-y-3">
                        <div class="flex items-center justify-between">
                            <div>
                                <Label class="text-base font-medium">Allowed Environment Variables</Label>
                                <p class="text-sm text-muted-foreground mt-1">
                                    {useCustomEnvVars ? "Custom env vars for this conversation" : "Using global settings"}
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
                            When enabled, the sandbox workspace is permanently deleted when you trash this conversation.
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
