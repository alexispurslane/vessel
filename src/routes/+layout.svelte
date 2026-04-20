<script lang="ts">
    import "../app.css";
    import {
        Sidebar,
        SidebarContent,
        SidebarFooter,
        SidebarGroup,
        SidebarGroupContent,
        SidebarGroupLabel,
        SidebarHeader,
        SidebarInset,
        SidebarMenu,
        SidebarMenuItem,
        SidebarMenuButton,
        SidebarProvider,
        SidebarTrigger,
        SidebarRail,
    } from "$lib/components/ui/sidebar/index.js";
    import { Separator } from "$lib/components/ui/separator/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import MessageSquarePlus from "@lucide/svelte/icons/message-square-plus";
    import Settings from "@lucide/svelte/icons/settings";
    import LogOut from "@lucide/svelte/icons/log-out";
    import Trash2 from "@lucide/svelte/icons/trash-2";
    import MessageSquare from "@lucide/svelte/icons/message-square";
    import Pencil from "@lucide/svelte/icons/pencil";
    import Tag from "@lucide/svelte/icons/tag";
    import Copy from "@lucide/svelte/icons/copy";
    import Sparkles from "@lucide/svelte/icons/sparkles";
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import { page } from "$app/stores";
    import { ModeWatcher } from "mode-watcher";
    import {
        ContextMenu,
        ContextMenuContent,
        ContextMenuItem,
        ContextMenuTrigger,
        ContextMenuSeparator,
    } from "$lib/components/ui/context-menu";
    import {
        Dialog,
        DialogContent,
        DialogHeader,
        DialogTitle,
        DialogFooter,
    } from "$lib/components/ui/dialog";
    import { Input } from "$lib/components/ui/input";
    import { getAuth, checkAuth, doLogout } from "$lib/stores/auth.svelte.js";
    import {
        getConversations,
        loadConversations,
        deleteConversation,
        setActiveConversation,
        renameConversation,
    } from "$lib/stores/conversations.svelte.js";
    import { updateConversation as apiUpdateConversation, generateTitle } from "$lib/api.js";
    import {
        disconnectStream,
        switchConversation,
        clearMessages,
    } from "$lib/stores/chat.svelte.js";
    import { loadSettings } from "$lib/stores/settings.svelte.js";
    import { hashHue } from "$lib/utils.js";

    const auth = getAuth();
    const convs = getConversations();

    // Current route info
    let currentPath: string = $derived($page.url.pathname);

    // Check if we're on an auth page (no sidebar needed)
    let isAuthPage = $derived(currentPath === "/login" || currentPath === "/setup");

    // Active conversation ID from URL
    let activeConversationId = $derived(
        currentPath.startsWith("/chat/") ? currentPath.split("/chat/")[1] : null
    );

    // Load conversations and settings when authenticated
    $effect(() => {
        if (auth.isAuthenticated) {
            loadConversations();
            loadSettings();
        }
    });

    // Sync active conversation with URL
    $effect(() => {
        if (activeConversationId && activeConversationId !== convs.activeId) {
            setActiveConversation(activeConversationId);
        }
    });

    onMount(() => {
        checkAuth();
    });

    function handleNewChat() {
        goto("/");
    }

    async function handleDeleteConversation(id: string, e: MouseEvent) {
        e.stopPropagation();
        await deleteConversation(id);
        // If we deleted the active conversation, clear messages and go home
        if (id === convs.activeId) {
            clearMessages();
            disconnectStream();
            goto("/");
        }
    }

    async function handleSelectConversation(id: string) {
        if (id === convs.activeId) return;
        switchConversation(id);
        goto(`/chat/${id}`);
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

    async function copyConversationTitle(id: string) {
        const conv = convs.list.find((c) => c.id === id);
        if (conv?.title) {
            await navigator.clipboard.writeText(conv.title);
        }
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

    let { children } = $props();
</script>

<svelte:head>
    <title>TalkAI</title>
</svelte:head>

<ModeWatcher />

{#if isAuthPage}
    <!-- Auth pages get no sidebar layout -->
    {@render children()}
{:else if !auth.isAuthenticated}
    <!-- Loading state while checking auth -->
    <div class="flex min-h-svh items-center justify-center">
        <Spinner class="h-8 w-8" />
    </div>
{:else}
    <SidebarProvider class="h-svh overflow-hidden">
        <Sidebar>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" class="font-semibold">
                            TalkAI
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Conversations</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            <SidebarMenuItem>
                                <SidebarMenuButton onclick={handleNewChat}>
                                    <MessageSquarePlus />
                                    New Chat
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>

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
                                        <SidebarMenuItem>
                                            <ContextMenu>
                                                <ContextMenuTrigger>
                                                    <SidebarMenuButton
                                                        isActive={conv.id === convs.activeId}
                                                        onclick={() =>
                                                            handleSelectConversation(conv.id)}
                                                        class="group"
                                                    >
                                                        <MessageSquare class="shrink-0" />
                                                        <span class="truncate">{conv.title}</span>
                                                        <button
                                                            class="ml-auto opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:text-destructive"
                                                            onclick={(e) =>
                                                                handleDeleteConversation(
                                                                    conv.id,
                                                                    e
                                                                )}
                                                            aria-label="Delete conversation"
                                                        >
                                                            <Trash2 class="h-3.5 w-3.5" />
                                                        </button>
                                                    </SidebarMenuButton>
                                                </ContextMenuTrigger>
                                                <ContextMenuContent>
                                                    <ContextMenuItem
                                                        onclick={() =>
                                                            handleRenameConversation(conv.id)}
                                                    >
                                                        <Pencil class="mr-2 h-4 w-4" />
                                                        Rename
                                                    </ContextMenuItem>
                                                    <ContextMenuItem
                                                        onclick={() =>
                                                            handleTagConversation(conv.id)}
                                                    >
                                                        <Tag class="mr-2 h-4 w-4" />
                                                        Edit Tags
                                                    </ContextMenuItem>
                                                    <ContextMenuItem
                                                        onclick={() =>
                                                            handleGenerateTitle(conv.id)}
                                                        disabled={generatingTitleForId === conv.id}
                                                    >
                                                        <Sparkles class="mr-2 h-4 w-4" />
                                                        {generatingTitleForId === conv.id ? 'Generating...' : 'Generate New Title'}
                                                    </ContextMenuItem>
                                                    <ContextMenuSeparator />
                                                    <ContextMenuItem
                                                        onclick={() =>
                                                            handleDeleteConversation(
                                                                conv.id,
                                                                new MouseEvent("click")
                                                            )}
                                                        class="text-destructive focus:text-destructive"
                                                    >
                                                        <Trash2 class="mr-2 h-4 w-4" />
                                                        Delete
                                                    </ContextMenuItem>
                                                </ContextMenuContent>
                                            </ContextMenu>
                                        </SidebarMenuItem>
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
                            onclick={() => goto("/settings")}
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

        <SidebarInset class="min-h-0 overflow-hidden">
            <header class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
                <SidebarTrigger />
                <Separator orientation="vertical" class="h-4" />
                <div class="flex items-center gap-2 min-w-0">
                    <span class="text-sm text-muted-foreground truncate">
                        {convs.activeConversation?.title ?? "TalkAI"}
                    </span>
                    {#if convs.activeConversation?.tags?.length}
                        <div class="flex items-center gap-1 shrink-0">
                            {#each convs.activeConversation.tags as tag}
                                <span
                                    class="tag-pill-colors inline-flex items-center justify-center h-5 px-1.5 rounded-full text-[10px] leading-none font-medium whitespace-nowrap"
                                    style="--tag-hue: {hashHue(tag)}"
                                >
                                    {tag}
                                </span>
                            {/each}
                        </div>
                    {/if}
                </div>
            </header>

            <main class="flex flex-1 flex-col min-h-0 overflow-hidden">
                {@render children()}
            </main>
        </SidebarInset>
    </SidebarProvider>

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
{/if}
