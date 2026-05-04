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
    import Search from "@lucide/svelte/icons/search";
    import MessageSquare from "@lucide/svelte/icons/message-square";
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
    import {
        updateConversation as apiUpdateConversation,
        generateTitle,
        searchConversations,
        type ConversationSearchResult,
    } from "$lib/api.js";
    import {
        disconnectStream,
        switchConversation,
        clearMessages,
    } from "$lib/stores/chat.svelte.js";
    import { getAuth, doLogout } from "$lib/stores/auth.svelte.js";
    import ConversationItem from "./conversation-item.svelte";
    import { onMount } from "svelte";

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
        void goto(resolve("/"));
    }

    async function handleDeleteConversation(id: string, e: MouseEvent) {
        e.stopPropagation();
        await deleteConversation(id);
        // If we deleted the active conversation, clear messages and go home
        if (id === convs.activeId) {
            clearMessages();
            disconnectStream();
            void goto(resolve("/"));
        }
    }

    function handleSelectConversation(id: string) {
        if (id === convs.activeId) return;
        switchConversation(id);
        void goto(resolve(`/chat/${id}`));
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

    // --- Search state ---
    let searchQuery = $state("");
    let searchResults = $state<ConversationSearchResult[]>([]);
    let searching = $state(false);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let searchInputRef: HTMLInputElement | null = $state(null);

    let isSearching = $derived(searchQuery.trim().length > 0);

    async function doSearch() {
        if (!searchQuery.trim()) {
            searchResults = [];
            return;
        }
        searching = true;
        try {
            searchResults = await searchConversations(searchQuery, 15);
        } catch {
            searchResults = [];
        } finally {
            searching = false;
        }
    }

    function handleSearchInput() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => void doSearch(), 200);
    }

    function handleSearchSelect(id: string, messageId: string | null) {
        searchQuery = "";
        searchResults = [];
        if (debounceTimer) clearTimeout(debounceTimer);

        // Navigate to conversation — if we have a message ID, anchor to that message
        const hash = messageId ? `#msg-${messageId}` : "";
        if (id !== convs.activeId) {
            switchConversation(id);
            void goto(resolve(`/chat/${id}${hash}`));
        } else {
            // Already on this conversation — just scroll to the message
            if (messageId) {
                const el = document.getElementById(`msg-${messageId}`);
                if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "center" });
                    el.classList.add(
                        "ring-2",
                        "ring-ring",
                        "ring-offset-2",
                        "ring-offset-background"
                    );
                    setTimeout(() => {
                        el.classList.remove(
                            "ring-2",
                            "ring-ring",
                            "ring-offset-2",
                            "ring-offset-background"
                        );
                    }, 2000);
                }
            }
        }
    }

    // Cmd/Ctrl+F focuses the sidebar search input
    onMount(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key === "f") {
                const tag = (e.target as HTMLElement | null)?.tagName;
                if (tag === "INPUT" || tag === "TEXTAREA") return;
                e.preventDefault();
                searchInputRef?.focus();
            }
        }
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    });

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
            <SidebarMenuItem class="min-w-0">
                <div
                    class="flex items-center gap-2 w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-muted-foreground overflow-hidden"
                >
                    <Search class="size-4 shrink-0 opacity-50" />
                    <input
                        bind:this={searchInputRef}
                        bind:value={searchQuery}
                        type="text"
                        placeholder="Search conversations..."
                        class="flex-1 min-w-0 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-sm"
                        oninput={handleSearchInput}
                    />
                    {#if searching}
                        <Spinner class="h-3.5 w-3.5 shrink-0" />
                    {/if}
                    {#if !searchQuery.trim()}
                        <kbd
                            class="pointer-events-none inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground"
                        >
                            ⌘F
                        </kbd>
                    {/if}
                </div>
            </SidebarMenuItem>
        </SidebarMenu>
    </SidebarHeader>

    <SidebarContent>
        {#if isSearching}
            <!-- Search results replace the normal sidebar content -->
            <SidebarGroup class="flex-1 min-h-0">
                <SidebarGroupLabel>Search Results</SidebarGroupLabel>
                <SidebarGroupContent>
                    <ScrollArea class="h-full">
                        <SidebarMenu>
                            {#if searching}
                                <div class="flex items-center justify-center py-4">
                                    <Spinner class="h-4 w-4" />
                                </div>
                            {:else if searchResults.length === 0}
                                <p class="px-2 py-4 text-xs text-muted-foreground text-center">
                                    No results found
                                </p>
                            {:else}
                                {#each searchResults as result (result.id)}
                                    {@const firstMessageId =
                                        result.snippets.find((s) => s.messageId)?.messageId ?? null}
                                    <SidebarMenuItem>
                                        <SidebarMenuButton
                                            isActive={result.id === convs.activeId}
                                            onclick={() =>
                                                handleSearchSelect(result.id, firstMessageId)}
                                            class="group h-auto py-2"
                                        >
                                            <MessageSquare class="shrink-0" />
                                            <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                                                <span class="truncate">{result.title}</span>
                                                {#if result.snippets.length > 0}
                                                    {#each result.snippets as snippet (snippet.messageId ?? snippet.text)}
                                                        <p
                                                            class="text-[11px] text-muted-foreground line-clamp-1"
                                                        >
                                                            {snippet.text}
                                                        </p>
                                                    {/each}
                                                {/if}
                                                {#if result.tags.length > 0}
                                                    <div class="flex gap-1 mt-0.5">
                                                        {#each result.tags as tag (tag)}
                                                            <span
                                                                class="tag-pill-colors inline-flex items-center justify-center h-3.5 px-1 rounded-full text-[8px] leading-none font-medium whitespace-nowrap"
                                                                style="--tag-hue: {hashHue(tag)}"
                                                            >
                                                                {tag}
                                                            </span>
                                                        {/each}
                                                    </div>
                                                {/if}
                                            </div>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                {/each}
                            {/if}
                        </SidebarMenu>
                    </ScrollArea>
                </SidebarGroupContent>
            </SidebarGroup>
        {:else}
            <!-- Normal sidebar content -->
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
        {/if}

        {#if convs.error}
            <p class="px-2 text-xs text-destructive">{convs.error}</p>
        {/if}
    </SidebarContent>

    <SidebarFooter>
        <SidebarMenu>
            <SidebarMenuItem>
                <SidebarMenuButton
                    isActive={currentPath === "/settings"}
                    onclick={() => void goto(resolve("/settings"))}
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
            onkeydown={(e: KeyboardEvent) => {
                if (e.key === "Enter") void commitRename();
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
            <Button onclick={() => void commitRename()}>Save</Button>
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
            onkeydown={(e: KeyboardEvent) => {
                if (e.key === "Enter") void commitTag();
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
            <Button onclick={() => void commitTag()}>Save</Button>
        </DialogFooter>
    </DialogContent>
</Dialog>
