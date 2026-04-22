<script lang="ts">
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import { Tabs, TabsContent, TabsList, TabsTrigger } from "$lib/components/ui/tabs/index.js";
    import { getSessionAgentInfo, updateSessionSystemPrompt } from "$lib/api.js";
    import type { AgentInfo } from "$lib/api.js";
    import SystemPromptEditor from "$lib/components/conversation-settings/SystemPromptEditor.svelte";
    import FileText from "@lucide/svelte/icons/file-text";
    import Wrench from "@lucide/svelte/icons/wrench";
    import Sparkles from "@lucide/svelte/icons/sparkles";

    interface Props {
        conversationId: string;
    }

    let { conversationId }: Props = $props();

    let loading = $state(false);
    let error = $state<string | null>(null);
    let info = $state<AgentInfo | null>(null);
    let activeTab = $state("system-prompt");
    let saving = $state(false);
    let saveError = $state<string | null>(null);

    async function loadAgentInfo() {
        loading = true;
        error = null;
        try {
            info = await getSessionAgentInfo(conversationId);
            if (!info) {
                error = "No active session found for this conversation.";
            }
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to load agent info";
        } finally {
            loading = false;
        }
    }

    function getInstructions(): string[] {
        const raw = info?.appendSystemPrompt;
        if (!raw) return [];
        return Array.isArray(raw) ? raw : [raw];
    }

    // --- SystemPromptEditor callbacks (immediate mode: persist each change) ---

    async function handleAddInstruction(text: string) {
        saving = true;
        saveError = null;
        try {
            const updated = [...getInstructions(), text];
            const result = await updateSessionSystemPrompt(conversationId, {
                appendSystemPrompt: updated,
            });
            info = result.info;
        } catch (e) {
            saveError = e instanceof Error ? e.message : "Failed to save";
        } finally {
            saving = false;
        }
    }

    async function handleRemoveInstruction(index: number) {
        const updated = getInstructions().filter((_, i) => i !== index);
        saving = true;
        saveError = null;
        try {
            const result = await updateSessionSystemPrompt(conversationId, {
                appendSystemPrompt: updated.length > 0 ? updated : null,
            });
            info = result.info;
        } catch (e) {
            saveError = e instanceof Error ? e.message : "Failed to remove";
        } finally {
            saving = false;
        }
    }

    async function handleEditInstruction(index: number, newText: string) {
        const updated = [...getInstructions()];
        updated[index] = newText;
        saving = true;
        saveError = null;
        try {
            const result = await updateSessionSystemPrompt(conversationId, {
                appendSystemPrompt: updated,
            });
            info = result.info;
        } catch (e) {
            saveError = e instanceof Error ? e.message : "Failed to save";
        } finally {
            saving = false;
        }
    }

    async function handleReplaceChange(value: string) {
        saving = true;
        saveError = null;
        try {
            const result = await updateSessionSystemPrompt(conversationId, {
                customSystemPrompt: value || null,
            });
            info = result.info;
        } catch (e) {
            saveError = e instanceof Error ? e.message : "Failed to save";
        } finally {
            saving = false;
        }
    }

    async function handleReplaceClear() {
        saving = true;
        saveError = null;
        try {
            const result = await updateSessionSystemPrompt(conversationId, {
                customSystemPrompt: null,
            });
            info = result.info;
        } catch (e) {
            saveError = e instanceof Error ? e.message : "Failed to clear";
        } finally {
            saving = false;
        }
    }

    function scopeLabel(scope: string): string {
        switch (scope) {
            case "user": return "Global";
            case "project": return "Project";
            case "temporary": return "Temp";
            default: return scope;
        }
    }

    function scopeBadgeClass(scope: string): string {
        switch (scope) {
            case "user": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
            case "project": return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
            case "temporary": return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
            default: return "bg-muted text-muted-foreground";
        }
    }

    // Load on mount or when conversation changes
    $effect(() => {
        if (conversationId) {
            loadAgentInfo();
        }
    });
</script>

<div class="flex flex-col h-full">
    <!-- Panel header -->
    <div class="flex items-center gap-1.5 px-3 py-2 border-b text-muted-foreground">
        <FileText class="size-3.5" />
        <span class="font-medium text-xs">Agent Info</span>
    </div>

    <!-- Scrollable content -->
    <ScrollArea class="flex-1 min-h-0">
        <div class="p-3">
            {#if loading}
                <div class="flex items-center justify-center py-8">
                    <Spinner class="h-6 w-6" />
                </div>
            {:else if error}
                <p class="text-xs text-destructive">{error}</p>
            {:else if info}
                <Tabs bind:value={activeTab} class="w-full">
                    <TabsList class="w-full h-7">
                        <TabsTrigger value="system-prompt" class="text-[11px] flex-1 gap-1 px-2">
                            <FileText class="size-3" />
                            Prompt
                        </TabsTrigger>
                        <TabsTrigger value="tools" class="text-[11px] flex-1 gap-1 px-2">
                            <Wrench class="size-3" />
                            Tools
                            {#if info.tools.length > 0}
                                <span class="ml-0.5 text-muted-foreground">({info.tools.length})</span>
                            {/if}
                        </TabsTrigger>
                        <TabsTrigger value="skills" class="text-[11px] flex-1 gap-1 px-2">
                            <Sparkles class="size-3" />
                            Skills
                            {#if info.skills.length > 0}
                                <span class="ml-0.5 text-muted-foreground">({info.skills.length})</span>
                            {/if}
                        </TabsTrigger>
                    </TabsList>

                    <!-- System Prompt Tab -->
                    <TabsContent value="system-prompt" class="mt-2 space-y-3">
                        <SystemPromptEditor
                            instructions={getInstructions()}
                            customSystemPrompt={info.customSystemPrompt ?? ""}
                            effectiveSystemPrompt={info.systemPrompt}
                            {saving}
                            error={saveError}
                            mode="immediate"
                            onadd={handleAddInstruction}
                            onremove={handleRemoveInstruction}
                            onedit={handleEditInstruction}
                            onreplacechange={handleReplaceChange}
                            onreplaceclear={handleReplaceClear}
                        />
                    </TabsContent>

                    <!-- Tools Tab -->
                    <TabsContent value="tools" class="mt-2">
                        {#if info.tools.length === 0}
                            <p class="text-xs text-muted-foreground py-4 text-center">No tools configured</p>
                        {:else}
                            <div class="rounded-lg border overflow-hidden">
                                <table class="w-full text-[11px]">
                                    <thead>
                                        <tr class="border-b bg-muted/30">
                                            <th class="px-3 py-1.5 text-left font-medium text-muted-foreground">Name</th>
                                            <th class="px-3 py-1.5 text-left font-medium text-muted-foreground">Description</th>
                                            <th class="px-3 py-1.5 text-left font-medium text-muted-foreground">Scope</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each info.tools as tool, i}
                                            <tr class="{i < info.tools.length - 1 ? 'border-b' : ''}">
                                                <td class="px-3 py-1.5 font-mono font-medium whitespace-nowrap">{tool.name}</td>
                                                <td class="px-3 py-1.5 text-muted-foreground">{tool.description}</td>
                                                <td class="px-3 py-1.5">
                                                    <span class="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium {scopeBadgeClass(tool.scope)}">
                                                        {scopeLabel(tool.scope)}
                                                    </span>
                                                </td>
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            </div>
                        {/if}
                    </TabsContent>

                    <!-- Skills Tab -->
                    <TabsContent value="skills" class="mt-2">
                        {#if info.skills.length === 0}
                            <p class="text-xs text-muted-foreground py-4 text-center">No skills configured</p>
                        {:else}
                            <div class="rounded-lg border overflow-hidden">
                                <table class="w-full text-[11px]">
                                    <thead>
                                        <tr class="border-b bg-muted/30">
                                            <th class="px-3 py-1.5 text-left font-medium text-muted-foreground">Name</th>
                                            <th class="px-3 py-1.5 text-left font-medium text-muted-foreground">Description</th>
                                            <th class="px-3 py-1.5 text-left font-medium text-muted-foreground">Scope</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each info.skills as skill, i}
                                            <tr class="{i < info.skills.length - 1 ? 'border-b' : ''}">
                                                <td class="px-3 py-1.5 font-mono font-medium whitespace-nowrap">
                                                    {skill.name}
                                                    {#if skill.disableModelInvocation}
                                                        <span class="ml-1 text-[9px] text-amber-600 dark:text-amber-400" title="Model cannot invoke this skill automatically">manual</span>
                                                    {/if}
                                                </td>
                                                <td class="px-3 py-1.5 text-muted-foreground">{skill.description}</td>
                                                <td class="px-3 py-1.5">
                                                    <span class="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium {scopeBadgeClass(skill.scope)}">
                                                        {scopeLabel(skill.scope)}
                                                    </span>
                                                </td>
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            </div>
                        {/if}
                    </TabsContent>
                </Tabs>
            {/if}
        </div>
    </ScrollArea>
</div>
