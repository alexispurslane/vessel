<script lang="ts">
    import { onMount } from "svelte";
    import {
        Card,
        CardContent,
        CardDescription,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { Label } from "$lib/components/ui/label";
    import { Button } from "$lib/components/ui/button";
    import { Separator } from "$lib/components/ui/separator";
    import { Switch } from "$lib/components/ui/switch";
    import { Spinner } from "$lib/components/ui/spinner";
    import { getSettings, updateSettings, restartAllSessions } from "$lib/api.js";
    import Check from "@lucide/svelte/icons/check";
    import {
        PillList,
        PathAutocompletePillList,
        PillKeyValueList,
        type PillItem,
        type KeyValueItem,
    } from "$lib/components/pill-list/index.js";

    // --- Sandbox settings state ---
    let sandboxEnabled = $state(true);
    let sandboxSnapshotEnabled = $state(true);
    let sandboxAllowNet = $state(false);
    let sandboxAllowAllDomains = $state(false);
    let sandboxSettingsLoading = $state(true);
    let sandboxSettingsSaved = $state(false);
    let sandboxSettingsError = $state<string | null>(null);

    // Pill-based list states
    let readPaths = $state<Array<{ path: string; editing?: boolean }>>([]);
    let writePaths = $state<Array<{ path: string; editing?: boolean }>>([]);
    let allowedDomains = $state<PillItem[]>([]);
    let allowedEnvVars = $state<PillItem[]>([]);

    // Secrets state for custom pill UI
    let secrets = $state<KeyValueItem[]>([]);

    // Internal appSettings for loading initial values
    let appSettings = $state<Record<string, string>>({});

    function loadPillListsFromSettings() {
        readPaths = (JSON.parse(appSettings["sandbox.extraReadPaths"] || "[]") as string[]).map(
            (p) => ({ path: p, editing: false })
        );
        writePaths = (JSON.parse(appSettings["sandbox.extraWritePaths"] || "[]") as string[]).map(
            (p) => ({ path: p, editing: false })
        );
        allowedDomains = (
            JSON.parse(appSettings["sandbox.allowedNetDomains"] || "[]") as string[]
        ).map((d) => ({ domain: d, editing: false }));
        allowedEnvVars = (JSON.parse(appSettings["sandbox.allowEnv"] || "[]") as string[]).map(
            (e) => ({ name: e, editing: false })
        );
    }

    function savePillListsToSettings(): Record<string, string> {
        return {
            "sandbox.extraReadPaths": JSON.stringify(readPaths.map((p) => p.path).filter(Boolean)),
            "sandbox.extraWritePaths": JSON.stringify(
                writePaths.map((p) => p.path).filter(Boolean)
            ),
            "sandbox.allowedNetDomains": JSON.stringify(
                allowedDomains.map((d) => d["domain"] as string).filter(Boolean)
            ),
            "sandbox.allowEnv": JSON.stringify(
                allowedEnvVars.map((e) => e["name"] as string).filter(Boolean)
            ),
        };
    }

    function loadSecretsFromSettings() {
        const secretsObj = JSON.parse(appSettings["sandbox.secrets"] || "{}") as Record<
            string,
            { value: string; hosts: string[] }
        >;
        secrets = Object.entries(secretsObj).map(([key, config]) => ({
            key,
            value: config.value,
            hosts: config.hosts.join(","),
            editing: false,
        }));
    }

    function loadSandboxSettings() {
        sandboxSettingsLoading = true;
        try {
            sandboxEnabled = appSettings["sandbox.enabled"] !== "false";
            sandboxAllowNet = appSettings["sandbox.allowNet"] === "true";
            sandboxAllowAllDomains = appSettings["sandbox.allowAllDomains"] === "true";
            loadPillListsFromSettings();
            loadSecretsFromSettings();
            sandboxSnapshotEnabled = appSettings["sandbox.snapshotEnabled"] !== "false";
        } catch {
            // Use defaults on parse error
        } finally {
            sandboxSettingsLoading = false;
        }
    }

    async function saveSandboxSettings() {
        sandboxSettingsError = null;
        sandboxSettingsSaved = false;
        try {
            const pillLists = savePillListsToSettings();

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

            await updateSettings({
                "sandbox.enabled": sandboxEnabled ? "true" : "false",
                "sandbox.allowNet": sandboxAllowNet ? "true" : "false",
                "sandbox.allowAllDomains": sandboxAllowAllDomains ? "true" : "false",
                "sandbox.secrets": JSON.stringify(secretsObj),
                "sandbox.snapshotEnabled": sandboxSnapshotEnabled ? "true" : "false",
                ...pillLists,
            });

            // Restart all active sessions so they pick up the new sandbox policy
            await restartAllSessions();

            sandboxSettingsSaved = true;
            setTimeout(() => {
                sandboxSettingsSaved = false;
            }, 2000);
        } catch (e) {
            sandboxSettingsError =
                e instanceof Error ? e.message : "Failed to save sandbox settings";
        }
    }

    onMount(async () => {
        try {
            appSettings = await getSettings();
        } catch {
            // Use defaults
        }
        loadSandboxSettings();
    });
</script>

<Card>
    <CardHeader>
        <CardTitle>Sandbox</CardTitle>
        <CardDescription
            >Configure zerobox sandboxing for agent tool execution. Each conversation gets an
            isolated sandbox that restricts filesystem access, network, and environment variables.
            Settings apply immediately to all conversations — saving will restart any active
            sessions to pick up the new configuration.</CardDescription
        >
    </CardHeader>
    <CardContent>
        {#if sandboxSettingsLoading}
            <div class="flex items-center justify-center py-8">
                <Spinner class="h-6 w-6" />
            </div>
        {:else}
            <div class="space-y-6">
                {#if sandboxSettingsError}
                    <p class="text-sm text-destructive">{sandboxSettingsError}</p>
                {/if}
                {#if sandboxSettingsSaved}
                    <p class="text-sm text-green-600">Settings saved.</p>
                {/if}

                <!-- Enable/Disable -->
                <div class="flex items-center justify-between rounded-lg border p-4">
                    <div class="space-y-0.5">
                        <Label class="text-base font-medium">Enable Sandboxing</Label>
                        <p class="text-sm text-muted-foreground">
                            When disabled, agent tools run without any isolation. Enable for safer
                            execution of AI-generated commands and file operations.
                        </p>
                    </div>
                    <Switch bind:checked={sandboxEnabled} />
                </div>

                {#if sandboxEnabled}
                    <!-- Extra Read Paths -->
                    <div class="rounded-lg border p-4 space-y-3">
                        <div>
                            <Label class="text-base font-medium">Extra Readable Paths</Label>
                            <p class="text-sm text-muted-foreground mt-1">
                                Additional paths the agent can read from. The project directory and
                                session workspace are always readable.
                            </p>
                        </div>

                        <PathAutocompletePillList
                            items={readPaths}
                            onChange={(items: typeof readPaths) => (readPaths = items)}
                            addPlaceholder="/path/to/directory"
                            addButtonLabel="Add Path"
                        />
                    </div>

                    <!-- Extra Write Paths -->
                    <div class="rounded-lg border p-4 space-y-3">
                        <div>
                            <Label class="text-base font-medium">Extra Writable Paths</Label>
                            <p class="text-sm text-muted-foreground mt-1">
                                Additional paths the agent can write to. The session workspace is
                                always writable.
                            </p>
                        </div>

                        <PathAutocompletePillList
                            items={writePaths}
                            onChange={(items: typeof writePaths) => (writePaths = items)}
                            addPlaceholder="/path/to/directory"
                            addButtonLabel="Add Path"
                        />
                    </div>

                    <Separator />

                    <!-- Network Access -->
                    <div class="rounded-lg border p-4 space-y-3">
                        <div class="flex items-center justify-between">
                            <div class="space-y-0.5">
                                <Label class="text-base font-medium">Network Access</Label>
                                <p class="text-sm text-muted-foreground">
                                    When enabled, tools can make outbound network requests.
                                </p>
                            </div>
                            <Switch bind:checked={sandboxAllowNet} />
                        </div>

                        {#if sandboxAllowNet}
                            <Separator />

                            <div class="flex items-center justify-between">
                                <div class="space-y-0.5">
                                    <Label class="text-sm font-medium">Allow All Domains</Label>
                                    <p class="text-xs text-muted-foreground">
                                        When enabled, tools can access any domain. When disabled,
                                        only explicitly allowed domains are accessible.
                                    </p>
                                </div>
                                <Switch bind:checked={sandboxAllowAllDomains} />
                            </div>

                            {#if !sandboxAllowAllDomains}
                                <Separator />

                                <div class="space-y-3">
                                    <div>
                                        <Label class="text-sm font-medium">Allowed Domains</Label>
                                        <p class="text-xs text-muted-foreground mt-0.5">
                                            Only these domains will be accessible by sandboxed
                                            tools.
                                        </p>
                                    </div>

                                    <PillList
                                        items={allowedDomains}
                                        labelKey="domain"
                                        onChange={(items: PillItem[]) => (allowedDomains = items)}
                                        addPlaceholder="example.com"
                                        addButtonLabel="Add Domain"
                                        inputWidth="w-36"
                                    />
                                </div>
                            {/if}

                            <Separator />

                            <div class="space-y-3">
                                <div>
                                    <Label class="text-sm font-medium">Secrets</Label>
                                    <p class="text-xs text-muted-foreground mt-0.5">
                                        Credentials injected by the sandbox. The agent sees
                                        placeholders — the real value is only substituted for
                                        requests to the specified hosts.
                                    </p>
                                </div>

                                <PillKeyValueList
                                    items={secrets}
                                    fields={[
                                        {
                                            key: "key",
                                            placeholder: "KEY",
                                            width: "w-24",
                                            mono: true,
                                        },
                                        {
                                            key: "value",
                                            placeholder: "value",
                                            width: "w-28",
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
                                    onChange={(items: KeyValueItem[]) => (secrets = items)}
                                    addButtonLabel="Add Secret"
                                />
                            </div>
                        {/if}
                    </div>

                    <Separator />

                    <!-- Snapshot & Restore -->
                    <div class="flex items-center justify-between rounded-lg border p-4">
                        <div class="space-y-0.5">
                            <Label class="text-base font-medium">Snapshot Filesystem Changes</Label>
                            <p class="text-sm text-muted-foreground">
                                Record all filesystem changes made by the agent for audit and
                                potential undo.
                            </p>
                        </div>
                        <Switch bind:checked={sandboxSnapshotEnabled} />
                    </div>

                    <Separator />

                    <!-- Environment Variables -->
                    <div class="rounded-lg border p-4 space-y-3">
                        <div>
                            <Label class="text-base font-medium"
                                >Allowed Environment Variables</Label
                            >
                            <p class="text-sm text-muted-foreground mt-1">
                                Only these environment variables will be visible inside the sandbox.
                                PATH, HOME, USER, SHELL, TERM, LANG, and NODE_ENV are always
                                included. All others are stripped unless added here.
                            </p>
                        </div>

                        <PillList
                            items={allowedEnvVars}
                            labelKey="name"
                            onChange={(items: PillItem[]) => (allowedEnvVars = items)}
                            addPlaceholder="VAR_NAME"
                            addButtonLabel="Add Variable"
                            inputWidth="w-28"
                        />
                    </div>
                {/if}

                <!-- Save Button -->
                <div class="flex justify-end pt-2">
                    <Button onclick={saveSandboxSettings}>
                        {#if sandboxSettingsSaved}
                            <Check class="mr-1.5 h-4 w-4" /> Saved
                        {:else}
                            Save Sandbox Settings
                        {/if}
                    </Button>
                </div>
            </div>
        {/if}
    </CardContent>
</Card>
