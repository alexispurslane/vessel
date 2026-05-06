<script lang="ts">
    /**
     * @file MCP server list configuration component.
     */
    import { Switch } from "$lib/components/ui/switch/index.js";
    import { Label } from "$lib/components/ui/label/index.js";
    import { TriStateToggle } from "$lib/components/ui/tri-state-toggle/index.js";
    import { SvelteSet } from "svelte/reactivity";
    import type { McpServerInfo, McpServerStatus } from "$lib/api.js";

    interface Props {
        mcpState: boolean | null;
        enabledMcpServers: SvelteSet<string>;
        availableMcpServers: McpServerInfo[];
        mcpServerStatuses: McpServerStatus[];
        onMcpStateChange: (value: boolean | null) => void;
        onToggleServer: (name: string) => void;
    }

    let {
        mcpState,
        enabledMcpServers,
        availableMcpServers,
        mcpServerStatuses,
        onMcpStateChange,
        onToggleServer,
    }: Props = $props();
</script>

<div class="rounded-lg border p-3">
    <div class="space-y-2">
        <div>
            <Label class="text-sm font-medium">MCP Servers</Label>
            <p class="text-xs text-muted-foreground mt-0.5">
                Control whether this conversation can use MCP servers.
            </p>
        </div>
        <TriStateToggle
            value={mcpState}
            options={[
                { value: null, label: "Inherit" },
                { value: true, label: "On" },
                { value: false, label: "Off" },
            ]}
            onChange={(v) => onMcpStateChange(v as boolean | null)}
        />
        {#if mcpState === true}
            <div class="space-y-1.5 pt-1">
                {#each availableMcpServers as server (server.name)}
                    {@const serverStatus = mcpServerStatuses.find((s) => s.name === server.name)}
                    <div class="flex items-center justify-between py-0.5">
                        <div class="space-y-0.5">
                            <div class="flex items-center gap-1.5">
                                <Label class="text-xs font-medium">{server.name}</Label>
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
                                    {server.config.command}{#if server.config.args?.length}
                                        {server.config.args.join(" ")}
                                    {/if}
                                {:else if server.config.url}
                                    {server.config.url}
                                {/if}
                            </p>
                        </div>
                        <Switch
                            checked={enabledMcpServers.has(server.name)}
                            onCheckedChange={() => onToggleServer(server.name)}
                        />
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>
