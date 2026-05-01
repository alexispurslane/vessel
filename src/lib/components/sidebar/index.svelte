<script lang="ts">
    import {
        Sidebar,
        SidebarContent,
        SidebarFooter,
        SidebarGroup,
        SidebarGroupContent,
        SidebarGroupLabel,
        SidebarHeader,
        SidebarMenu,
        SidebarMenuItem,
        SidebarMenuButton,
        SidebarRail,
    } from "$lib/components/ui/sidebar/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import MessageSquarePlus from "@lucide/svelte/icons/message-square-plus";
    import Settings from "@lucide/svelte/icons/settings";
    import LogOut from "@lucide/svelte/icons/log-out";
    import {
        Dialog,
        DialogContent,
        DialogHeader,
        DialogTitle,
        DialogFooter,
    } from "$lib/components/ui/dialog";
    import { Input } from "$lib/components/ui/input";
    import { goto } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { SvelteMap } from "svelte/reactivity";
    import { hashHue } from "$lib/utils.js";
    import {
        getConversations,
        deleteConversation,
        setActiveConversation,
        renameConversation,
        loadConversations,
    } from "$lib/stores/conversations.svelte.js";
    import { updateConversation as apiUpdateConversation, generateTitle } from "$lib/api.js";
    import {
        disconnectStream,
        switchConversation,
        clearMessages,
    } from "$lib/stores/chat.svelte.js";
    import { getAuth, doLogout } from "$lib/stores/auth.svelte.js";
    import ConversationItem from "./conversation-item.svelte";

    let { currentPath }: { currentPath: string } = $props();

    const _auth = getAuth();
    const convs = getConversations();

    let allTags = $derived.by(() => {
        const tagCounts = new SvelteMap<string, number>();
        for (const conv of convs.list) {
            for (const tag of conv.tags) {
                tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
            }
        }
        console.log([...tagCounts.entries()]);
        return [...tagCounts.entries()]
            .sort(([_1, aCount], [_2, bCount]) => bCount - aCount)
            .map(([tag, count]) => ({ tag, count }));
    });

    function handleNewChat() {
        setActiveConversation(null);
        clearMessages();
        disconnectStream();
        goto(resolve("/"));
    }

    async function handleDeleteConversation(id: string, e: MouseEvent) {
        e.stopPropagation();
        await deleteConversation(id);
        // If we deleted the active conversation, clear messages and go home
        if (id === convs.activeId) {
            clearMessages();
            disconnectStream();
            goto(resolve("/"));
        }
    }

    async function handleSelectConversation(id: string) {
        if (id === convs.activeId) return;
        switchConversation(id);
        goto(resolve(`/chat/${id}`));
    }

    async function handleLogout() {
        disconnectStream();
        await doLogout();
    }

    // --- Rename/Tag dialog state ---
    let renamingConvId = $state<string | null>(null);
    let renameValue = $state("");
    let taggingConvId = $state<string | null>(null);
    let tagValue = $state("");

    function handleRenameConversation(id: string) {
        const conv = convs.list.find((c) => c.id === id);
        if (!conv) return;
        renamingConvId = id;
        renameValue = conv.title;
    }

    async function commitRename() {
        if (!renamingConvId || !renameValue.trim()) return;
        await renameConversation(renamingConvId, renameValue.trim());
        renamingConvId = null;
        renameValue = "";
    }

    function handleTagConversation(id: string) {
        const conv = convs.list.find((c) => c.id === id);
        if (!conv) return;
        taggingConvId = id;
        tagValue = conv.tags.join(", ");
    }

    async function commitTag() {
        if (!taggingConvId) return;
        const tags = tagValue
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t.length > 0);
        await apiUpdateConversation(taggingConvId, { tags });
        // Refresh conversation list
        await loadConversations();
        taggingConvId = null;
        tagValue = "";
    }

    let generatingTitleForId = $state<string | null>(null);

    async function handleGenerateTitle(id: string) {
        generatingTitleForId = id;
        try {
            const result = await generateTitle(id, { force: true });
            if (result.generated) {
                await loadConversations();
            }
        } catch (err) {
            console.error("Failed to generate title:", err);
        } finally {
            generatingTitleForId = null;
        }
    }
</script>

<Sidebar>
    <SidebarHeader>
        <SidebarMenu>
            <SidebarMenuItem>
                <SidebarMenuButton
                    size="lg"
                    class="font-semibold flex flex-row justify-between"
                    onclick={handleNewChat}
                >
                    <img src="/vessel.png" alt="Vessel" class="size-6 rounded" />
                    Vessel
                    <MessageSquarePlus />
                </SidebarMenuButton>
            </SidebarMenuItem>
        </SidebarMenu>
    </SidebarHeader>

    <SidebarContent>
        {#if allTags.length > 0}
            <SidebarGroup>
                <SidebarGroupLabel>Tags</SidebarGroupLabel>
                <SidebarGroupContent>
                    <div class="flex flex-wrap gap-1 px-2">
                        {#each allTags as { tag, count } (tag)}
                            <a
                                href={resolve(`/tags/${tag}`)}
                                class="tag-pill-colors inline-flex items-center justify-center h-5 px-1.5 rounded-full text-[10px] leading-none font-medium whitespace-nowrap cursor-pointer hover:opacity-80 transition-opacity"
                                style="--tag-hue: {hashHue(tag)}"
                            >
                                {tag} ({count})
                            </a>
                        {/each}
                    </div>
                </SidebarGroupContent>
            </SidebarGroup>
        {/if}

        <SidebarGroup class="flex-1 min-h-0">
            <SidebarGroupLabel>Recent</SidebarGroupLabel>
            <SidebarGroupContent>
                <ScrollArea class="h-full">
                    <SidebarMenu>
                        {#if convs.loading}
                            <div class="flex items-center justify-center py-4">
                                <Spinner class="h-4 w-4" />
                            </div>
                        {:else if convs.list.length === 0}
                            <p class="px-2 py-4 text-xs text-muted-foreground text-center">
                                No conversations yet
                            </p>
                        {:else}
                            {#each convs.list as conv (conv.id)}
                                <ConversationItem
                                    {conv}
                                    isActive={conv.id === convs.activeId}
                                    generatingTitle={generatingTitleForId === conv.id}
                                    onSelect={handleSelectConversation}
                                    onDelete={handleDeleteConversation}
                                    onRename={handleRenameConversation}
                                    onTag={handleTagConversation}
                                    onGenerateTitle={handleGenerateTitle}
                                />
                            {/each}
                        {/if}
                    </SidebarMenu>
                </ScrollArea>
            </SidebarGroupContent>
        </SidebarGroup>

        {#if convs.error}
            <p class="px-2 text-xs text-destructive">{convs.error}</p>
        {/if}
    </SidebarContent>

    <SidebarFooter>
        <SidebarMenu>
            <SidebarMenuItem>
                <SidebarMenuButton
                    isActive={currentPath === "/settings"}
                    onclick={() => goto(resolve("/settings"))}
                >
                    <Settings />
                    Settings
                </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
                <SidebarMenuButton onclick={handleLogout}>
                    <LogOut />
                    Sign Out
                </SidebarMenuButton>
            </SidebarMenuItem>
        </SidebarMenu>
    </SidebarFooter>

    <SidebarRail />
</Sidebar>

<!-- Rename Dialog -->
<Dialog
    open={!!renamingConvId}
    onOpenChange={(open) => {
        if (!open) {
            renamingConvId = null;
            renameValue = "";
        }
    }}
>
    <DialogContent>
        <DialogHeader>
            <DialogTitle>Rename Conversation</DialogTitle>
        </DialogHeader>
        <Input
            bind:value={renameValue}
            placeholder="Conversation title"
            onkeydown={(e) => {
                if (e.key === "Enter") commitRename();
            }}
        />
        <DialogFooter>
            <Button
                variant="outline"
                onclick={() => {
                    renamingConvId = null;
                    renameValue = "";
                }}>Cancel</Button
            >
            <Button onclick={commitRename}>Save</Button>
        </DialogFooter>
    </DialogContent>
</Dialog>

<!-- Tag Dialog -->
<Dialog
    open={!!taggingConvId}
    onOpenChange={(open) => {
        if (!open) {
            taggingConvId = null;
            tagValue = "";
        }
    }}
>
    <DialogContent>
        <DialogHeader>
            <DialogTitle>Edit Tags</DialogTitle>
        </DialogHeader>
        <Input
            bind:value={tagValue}
            placeholder="tag1, tag2, tag3"
            onkeydown={(e) => {
                if (e.key === "Enter") commitTag();
            }}
        />
        <DialogFooter>
            <Button
                variant="outline"
                onclick={() => {
                    taggingConvId = null;
                    tagValue = "";
                }}>Cancel</Button
            >
            <Button onclick={commitTag}>Save</Button>
        </DialogFooter>
    </DialogContent>
</Dialog>
