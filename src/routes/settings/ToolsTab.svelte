<script lang="ts">
    import { onMount } from "svelte";
    import {
        Card,
        CardContent,
        CardDescription,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { Button } from "$lib/components/ui/button";
    import { Separator } from "$lib/components/ui/separator";
    import { Badge } from "$lib/components/ui/badge";
    import { Switch } from "$lib/components/ui/switch";
    import { Spinner } from "$lib/components/ui/spinner";
    import {
        getSettings,
        updateSettings,
        restartAllSessions,
        listMcpServers,
        upsertMcpServer,
        deleteMcpServer,
        type McpServerEntry,
        type McpServerInfo,
    } from "$lib/api.js";
    import Plus from "@lucide/svelte/icons/plus";
    import Trash2 from "@lucide/svelte/icons/trash-2";
    import Check from "@lucide/svelte/icons/check";
    import Pencil from "@lucide/svelte/icons/pencil";

    // --- Default Agent Mode state ---
    let defaultAgentMode = $state<"agent" | "chat">("agent");

    // --- MCP Servers state ---
    let mcpServers = $state<McpServerInfo[]>([]);
    let mcpLoading = $state(true);
    let mcpError = $state<string | null>(null);
    let showAddMcp = $state(false);
    let editingMcpName = $state<string | null>(null);
    let mcpName = $state("");
    let mcpConfigJson = $state("");
    let mcpSaving = $state(false);

    async function loadMcpServers() {
        mcpLoading = true;
        mcpError = null;
        try {
            mcpServers = await listMcpServers();
        } catch (e) {
            mcpError = e instanceof Error ? e.message : "Failed to load MCP servers";
        } finally {
            mcpLoading = false;
        }
    }

    function resetMcpForm() {
        mcpName = "";
        mcpConfigJson = "";
        showAddMcp = false;
        editingMcpName = null;
    }

    async function saveMcpServer() {
        mcpError = null;
        const name = mcpName.trim();
        if (!name) {
            mcpError = "Server name is required";
            return;
        }

        let config: McpServerEntry;
        try {
            config = JSON.parse(mcpConfigJson);
        } catch {
            mcpError = "Invalid JSON configuration";
            return;
        }

        if (!config.command && !config.url) {
            mcpError = "Config must have either 'command' (stdio) or 'url' (HTTP)";
            return;
        }

        mcpSaving = true;
        try {
            await upsertMcpServer(name, config);
            await loadMcpServers();
            resetMcpForm();
        } catch (e) {
            mcpError = e instanceof Error ? e.message : "Failed to save MCP server";
        } finally {
            mcpSaving = false;
        }
    }

    const mcpConfigExample =
        '{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"] }';

    async function removeMcpServer(name: string) {
        try {
            await deleteMcpServer(name);
            await loadMcpServers();
        } catch (e) {
            mcpError = e instanceof Error ? e.message : "Failed to delete MCP server";
        }
    }

    function editMcpServer(server: McpServerInfo) {
        mcpName = server.name;
        mcpConfigJson = JSON.stringify(server.config, null, 2);
        editingMcpName = server.name;
        showAddMcp = true;
    }

    // --- Search Grounding settings state ---
    let searchBaseUrl = $state("");
    let searchApiKey = $state("");
    let searchSettingsLoading = $state(true);
    let searchSettingsSaved = $state(false);
    let searchSettingsError = $state<string | null>(null);

    // Internal appSettings for loading initial values
    let appSettings = $state<Record<string, string>>({});

    function loadSearchSettings() {
        searchSettingsLoading = true;
        try {
            searchBaseUrl = appSettings["search.baseUrl"] || "";
            searchApiKey = appSettings["search.apiKey"] || "";
        } catch {
            // Use defaults on parse error
        } finally {
            searchSettingsLoading = false;
        }
    }

    async function saveSearchSettings() {
        searchSettingsError = null;
        searchSettingsSaved = false;
        try {
            await updateSettings({
                "search.baseUrl": searchBaseUrl,
                "search.apiKey": searchApiKey,
            });

            // Restart all active sessions so they pick up the new search settings
            await restartAllSessions();

            searchSettingsSaved = true;
            setTimeout(() => {
                searchSettingsSaved = false;
            }, 2000);
        } catch (e) {
            searchSettingsError = e instanceof Error ? e.message : "Failed to save search settings";
        }
    }

    onMount(async () => {
        try {
            appSettings = await getSettings();
            defaultAgentMode =
                (appSettings["sandbox.defaultAgentMode"] as "agent" | "chat") || "agent";
        } catch {
            // Use defaults
        }
        loadSearchSettings();
        loadMcpServers();
    });
</script>

<Card>
    <CardHeader>
        <CardTitle>Tools</CardTitle>
        <CardDescription
            >Configure the agent's default mode and external tools: MCP servers for custom
            integrations, and web search for grounding responses in real-time information.</CardDescription
        >
    </CardHeader>
    <CardContent>
        <div class="space-y-8">
            <!-- Default Mode Section -->
            <div class="rounded-lg border p-4">
                <div class="space-y-3">
                    <div>
                        <Label class="text-base font-medium">Default Mode</Label>
                        <p class="text-sm text-muted-foreground mt-1">
                            Agent mode enables all tools by default. Chat mode disables tools for
                            plain conversation. Individual conversations can override this.
                        </p>
                    </div>
                    <div class="flex items-center gap-2">
                        <div class="flex gap-2">
                            <button
                                class="px-3 py-1.5 text-sm rounded-md border transition-colors {defaultAgentMode ===
                                'agent'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted'}"
                                onclick={async () => {
                                    defaultAgentMode = "agent";
                                    await updateSettings({
                                        "sandbox.defaultAgentMode": "agent",
                                    });
                                    await restartAllSessions();
                                }}
                            >
                                Agent
                            </button>
                            <button
                                class="px-3 py-1.5 text-sm rounded-md border transition-colors {defaultAgentMode ===
                                'chat'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted'}"
                                onclick={async () => {
                                    defaultAgentMode = "chat";
                                    await updateSettings({
                                        "sandbox.defaultAgentMode": "chat",
                                    });
                                    await restartAllSessions();
                                }}
                            >
                                Chat
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <Separator />

            <!-- MCP Servers Section -->
            {#if mcpLoading}
                <div class="flex items-center justify-center py-8">
                    <Spinner class="h-6 w-6" />
                </div>
            {:else}
                {#if mcpServers.length > 0}
                    <div class="mb-6 space-y-3">
                        {#each mcpServers as server (server.name)}
                            <div class="rounded-lg border p-3">
                                <div class="flex items-center justify-between">
                                    <div class="flex items-center gap-3">
                                        <span class="font-medium">{server.name}</span>
                                        {#if server.config.command}
                                            <Badge variant="outline" class="text-xs">stdio</Badge>
                                        {:else if server.config.url}
                                            <Badge variant="outline" class="text-xs">http</Badge>
                                        {/if}
                                        <div
                                            class="flex items-center gap-1.5 text-xs text-muted-foreground"
                                        >
                                            <Switch
                                                checked={server.config.defaultEnabled !== false}
                                                onCheckedChange={(checked: boolean) => {
                                                    server.config.defaultEnabled = checked;
                                                    upsertMcpServer(server.name, server.config);
                                                }}
                                            />
                                            <span
                                                >{server.config.defaultEnabled !== false
                                                    ? "On by default"
                                                    : "Off by default"}</span
                                            >
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onclick={() => editMcpServer(server)}
                                        >
                                            <Pencil class="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onclick={() => removeMcpServer(server.name)}
                                        >
                                            <Trash2 class="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                {#if server.config.command}
                                    <p class="mt-1 text-sm text-muted-foreground">
                                        <code class="text-xs"
                                            >{server.config.command}{#if server.config.args?.length}
                                                {server.config.args.join(" ")}{/if}</code
                                        >
                                    </p>
                                {:else if server.config.url}
                                    <p class="mt-1 text-sm text-muted-foreground">
                                        <code class="text-xs">{server.config.url}</code>
                                    </p>
                                {/if}
                            </div>
                        {/each}
                    </div>
                    <Separator class="my-4" />
                {:else}
                    <p class="mb-4 text-center text-muted-foreground">
                        No MCP servers configured yet.
                    </p>
                {/if}

                {#if mcpError}
                    <p class="mb-4 text-sm text-destructive">{mcpError}</p>
                {/if}

                {#if showAddMcp}
                    <div class="space-y-4 rounded-lg border p-4">
                        <p class="font-medium">
                            {editingMcpName ? "Edit" : "Add"} MCP Server
                        </p>
                        <div>
                            <Label for="mcp-name" class="mb-1">Name</Label>
                            <Input
                                id="mcp-name"
                                placeholder="e.g. filesystem, github"
                                bind:value={mcpName}
                                disabled={!!editingMcpName}
                            />
                        </div>
                        <div>
                            <Label for="mcp-config" class="mb-1">Configuration (JSON)</Label>
                            <p class="text-xs text-muted-foreground mb-1">
                                Standard MCP server config: <code class="text-xs"
                                    >{mcpConfigExample}</code
                                >
                            </p>
                            <textarea
                                id="mcp-config"
                                class="flex min-h-30 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                placeholder={mcpConfigExample}
                                bind:value={mcpConfigJson}
                            ></textarea>
                        </div>
                        <div class="flex gap-2">
                            <Button onclick={saveMcpServer} disabled={mcpSaving}>
                                {#if mcpSaving}
                                    <Spinner class="mr-1.5 h-4 w-4" />
                                {:else if editingMcpName}
                                    <Check class="mr-1.5 h-4 w-4" />
                                {:else}
                                    <Plus class="mr-1.5 h-4 w-4" />
                                {/if}
                                {editingMcpName ? "Update" : "Add"} Server
                            </Button>
                            <Button variant="outline" onclick={resetMcpForm}>Cancel</Button>
                        </div>
                    </div>
                {:else}
                    <Button variant="outline" onclick={() => (showAddMcp = true)}>
                        <Plus class="mr-1.5 h-4 w-4" /> Add MCP Server
                    </Button>
                {/if}
            {/if}

            <Separator />

            <!-- Search Grounding Section -->
            {#if searchSettingsLoading}
                <div class="flex items-center justify-center py-8">
                    <Spinner class="h-6 w-6" />
                </div>
            {:else}
                <div class="space-y-6">
                    {#if searchSettingsError}
                        <p class="text-sm text-destructive">{searchSettingsError}</p>
                    {/if}
                    {#if searchSettingsSaved}
                        <p class="text-sm text-green-600">Settings saved.</p>
                    {/if}
                    <div class="space-y-3">
                        <div class="space-y-2">
                            <Label for="search-base-url" class="text-sm font-medium"
                                >Search API Base URL</Label
                            >
                            <p class="text-xs text-muted-foreground">
                                The search API endpoint. Defaults to <code class="text-xs"
                                    >https://api.exa.ai/search</code
                                >
                                if left empty. For testing with Synthetic, use
                                <code class="text-xs">https://api.synthetic.new/v2/search</code>.
                            </p>
                            <Input
                                id="search-base-url"
                                type="url"
                                placeholder="https://api.exa.ai/search"
                                bind:value={searchBaseUrl}
                            />
                        </div>
                        <div class="space-y-2">
                            <Label for="search-api-key" class="text-sm font-medium"
                                >Search API Key</Label
                            >
                            <p class="text-xs text-muted-foreground">
                                Your search API key. Required for the web search tool to work.
                            </p>
                            <Input
                                id="search-api-key"
                                type="password"
                                placeholder="Enter your API key"
                                bind:value={searchApiKey}
                            />
                        </div>
                    </div>
                    <div class="flex justify-end pt-2">
                        <Button onclick={saveSearchSettings}>
                            {#if searchSettingsSaved}
                                <Check class="mr-1.5 h-4 w-4" /> Saved
                            {:else}
                                Save
                            {/if}
                        </Button>
                    </div>
                </div>
            {/if}
        </div>
    </CardContent>
</Card>
