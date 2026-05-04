<script lang="ts">
    import { Button } from "$lib/components/ui/button/index.js";
    import { Switch } from "$lib/components/ui/switch/index.js";
    import { Separator } from "$lib/components/ui/separator/index.js";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    import {
        PathAutocompletePillList,
        PillList,
        type PillItem,
        type KeyValueItem,
    } from "$lib/components/pill-list/index.js";
    import { TriStateToggle } from "$lib/components/ui/tri-state-toggle/index.js";
    import SettingCard from "./SettingCard.svelte";
    import SwitchSettingCard from "./SwitchSettingCard.svelte";
    import { McpServerList } from "./mcp-server-list/index.js";
    import { NetworkAccessCard } from "./network-access/index.js";
    import {
        useConversationSecuritySettings,
        type ConversationSecuritySettingsState,
    } from "./useConversationSecuritySettings.svelte.ts";
    import Shield from "@lucide/svelte/icons/shield";
    import Check from "@lucide/svelte/icons/check";

    interface Props {
        /** The conversation ID */
        conversationId: string;
    }

    let { conversationId }: Props = $props();

    const s: ConversationSecuritySettingsState = useConversationSecuritySettings(
        () => conversationId
    );
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
            {#if s.loading}
                <div class="flex items-center justify-center py-8">
                    <Spinner class="h-6 w-6" />
                </div>
            {:else}
                {#if s.error}
                    <p class="text-xs text-destructive">{s.error}</p>
                {/if}

                {#if s.saved}
                    <p class="text-xs text-green-600">
                        Settings saved{#if s.sandboxEnabledState !== null || s.allowNetState !== null || s.useCustomReadPaths || s.useCustomWritePaths || s.useCustomDomains || s.useCustomEnvVars || s.useCustomSecrets || s.agentMode !== null}.
                            Session will restart on next interaction.{/if}
                    </p>
                {/if}

                <!-- Sandbox Enabled -->
                <SettingCard
                    label="Sandbox"
                    description="Control whether this conversation uses a sandbox."
                >
                    <TriStateToggle
                        value={s.sandboxEnabledState}
                        options={[
                            { value: null, label: "Inherit" },
                            { value: true, label: "On" },
                            { value: false, label: "Off" },
                        ]}
                        onChange={(v) => (s.sandboxEnabledState = v as boolean | null)}
                    />
                </SettingCard>

                <!-- Agent Mode -->
                <SettingCard
                    label="Mode"
                    description="Agent mode enables all tools (read, write, bash, fetch, etc.). Chat mode disables tools for plain conversation."
                >
                    <TriStateToggle
                        value={s.agentMode}
                        options={[
                            { value: null, label: "Inherit" },
                            { value: "agent", label: "Agent" },
                            { value: "chat", label: "Chat" },
                        ]}
                        onChange={(v) => (s.agentMode = v as "agent" | "chat" | null)}
                    />
                </SettingCard>

                <!-- MCP Servers -->
                {#if s.availableMcpServers.length > 0}
                    <McpServerList
                        mcpState={s.mcpState}
                        enabledMcpServers={s.enabledMcpServers}
                        availableMcpServers={s.availableMcpServers}
                        mcpServerStatuses={s.mcpServerStatuses}
                        onMcpStateChange={(v: boolean | null) => (s.mcpState = v)}
                        onToggleServer={s.toggleMcpServer}
                    />
                {/if}

                {#if s.sandboxEnabledState !== false}
                    <!-- Extra Read Paths -->
                    <SwitchSettingCard
                        label="Read Paths"
                        enabled={s.useCustomReadPaths}
                        onToggle={(v: boolean) => (s.useCustomReadPaths = v)}
                        statusText={s.useCustomReadPaths ? "Custom paths" : "Inheriting global"}
                    >
                        <PathAutocompletePillList
                            items={s.readPaths}
                            onChange={(items: typeof s.readPaths) => (s.readPaths = items)}
                            addPlaceholder="/path"
                            addButtonLabel="Add"
                        />
                    </SwitchSettingCard>

                    <!-- Extra Write Paths -->
                    <SwitchSettingCard
                        label="Write Paths"
                        enabled={s.useCustomWritePaths}
                        onToggle={(v: boolean) => (s.useCustomWritePaths = v)}
                        statusText={s.useCustomWritePaths ? "Custom paths" : "Inheriting global"}
                    >
                        <PathAutocompletePillList
                            items={s.writePaths}
                            onChange={(items: typeof s.writePaths) => (s.writePaths = items)}
                            addPlaceholder="/path"
                            addButtonLabel="Add"
                        />
                    </SwitchSettingCard>

                    <Separator />

                    <!-- Network Access (domains + secrets) -->
                    <NetworkAccessCard
                        allowNetState={s.allowNetState}
                        allowAllDomainsState={s.allowAllDomainsState}
                        useCustomDomains={s.useCustomDomains}
                        allowedDomains={s.allowedDomains}
                        useCustomSecrets={s.useCustomSecrets}
                        secrets={s.secrets}
                        onAllowNetChange={(v: boolean | null) => (s.allowNetState = v)}
                        onAllowAllDomainsChange={(v: boolean | null) =>
                            (s.allowAllDomainsState = v)}
                        onUseCustomDomainsChange={(v: boolean) => (s.useCustomDomains = v)}
                        onAllowedDomainsChange={(items: PillItem[]) => (s.allowedDomains = items)}
                        onUseCustomSecretsChange={(v: boolean) => (s.useCustomSecrets = v)}
                        onSecretsChange={(items: KeyValueItem[]) => (s.secrets = items)}
                    />

                    <Separator />

                    <!-- Environment Variables -->
                    <SwitchSettingCard
                        label="Env Variables"
                        enabled={s.useCustomEnvVars}
                        onToggle={(v: boolean) => (s.useCustomEnvVars = v)}
                        statusText={s.useCustomEnvVars ? "Custom env vars" : "Inheriting global"}
                    >
                        <PillList
                            items={s.allowedEnvVars}
                            labelKey="name"
                            onChange={(items: PillItem[]) => (s.allowedEnvVars = items)}
                            addPlaceholder="VAR_NAME"
                            addButtonLabel="Add"
                            inputWidth="w-28"
                        />
                    </SwitchSettingCard>
                {/if}

                <Separator />

                <!-- Delete workspace with conversation -->
                <div class="flex items-center justify-between rounded-lg border p-3">
                    <div class="space-y-0.5">
                        <span class="text-sm font-medium">Delete workspace on trash</span>
                        <p class="text-xs text-muted-foreground">
                            Delete sandbox workspace when conversation is trashed.
                        </p>
                    </div>
                    <Switch bind:checked={s.deleteWorkspaceWithConversation} />
                </div>

                <!-- Save button -->
                <Button onclick={s.saveSettings} disabled={s.saving} class="w-full">
                    {#if s.saving}
                        <Spinner class="mr-1.5 h-4 w-4" />
                        Saving...
                    {:else if s.saved}
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
