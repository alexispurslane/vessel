<script lang="ts">
    /**
     * @file Main sidebar with search, pinned/recent conversations, and navigation.
     */
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
        useSidebar,
    } from "$lib/components/ui/sidebar/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import MessageSquarePlus from "@lucide/svelte/icons/message-square-plus";
    import Settings from "@lucide/svelte/icons/settings";
    import LogOut from "@lucide/svelte/icons/log-out";
    import Search from "@lucide/svelte/icons/search";
    import Archive from "@lucide/svelte/icons/archive";
    import ArchiveRestore from "@lucide/svelte/icons/archive-restore";
    import Trash2 from "@lucide/svelte/icons/trash-2";
    import TagIcon from "@lucide/svelte/icons/tag";
    import X from "@lucide/svelte/icons/x";
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
    import { hashHue, getDraftConversationIds } from "$lib/utils.js";
    import {
        getConversations,
        deleteConversation,
        setActiveConversation,
        renameConversation,
        loadConversations,
        pinConversation,
        archiveConversation,
        unarchiveConversation,
        bulkAction,
        toggleSelection,
        selectAllActive,
        selectAllArchived,
        clearSelection,
    } from "$lib/stores/conversations.svelte.js";
    import type { BulkAction } from "$lib/api.js";
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
    import { onMount, onDestroy } from "svelte";
    import { SHORTCUT_EVENT_TYPE, type ShortcutEventDetail } from "$lib/utils/keyboard.js";

    let { currentPath }: { currentPath: string } = $props();

    const _auth = getAuth();
    const convs = getConversations();
    const sidebar = useSidebar();

    // Track which conversations have unsent drafts (client-side only)
    let draftIds = $state<Set<string>>(new Set());
    let draftPollInterval: ReturnType<typeof setInterval> | undefined;

    function refreshDraftIds() {
        draftIds = getDraftConversationIds();
    }

    onMount(() => {
        refreshDraftIds();
        // Poll sessionStorage for draft changes every 2 seconds.
        // This catches drafts saved from the chat page and browser-tab crashes.
        draftPollInterval = setInterval(refreshDraftIds, 2000);
    });

    onDestroy(() => {
        if (draftPollInterval !== undefined) clearInterval(draftPollInterval);
    });

    let allTags = $derived.by(() => {
        const tagCounts = new SvelteMap<string, number>();
        for (const conv of convs.activeConvs) {
            for (const tag of conv.tags) {
                tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
            }
        }
        console.log([...tagCounts.entries()]);
        return [...tagCounts.entries()]
            .sort(([_1, aCount], [_2, bCount]) => bCount - aCount)
            .map(([tag, count]) => ({ tag, count }));
    });

    let pinnedConvs = $derived(convs.activeConvs.filter((c) => c.pinned));
    let recentConvs = $derived(convs.activeConvs.filter((c) => !c.pinned));
    let archivedConvs = $derived(convs.archivedConvs);

    // --- Arrow-key navigation state ---
    let focusedConvId: string | null = $state(null);

    /** Combined list of navigable conversation IDs (matches visual order: pinned → recent → archived). */
    let navigableIds = $derived.by(() => {
        const ids: string[] = [];
        for (const c of pinnedConvs) ids.push(c.id);
        for (const c of recentConvs) ids.push(c.id);
        for (const c of archivedConvs) ids.push(c.id);
        return ids;
    });

    /**
     * Move the focused conversation index in the given direction.
     * @param direction - 1 for down, -1 for up
     */
    function moveFocus(direction: 1 | -1) {
        if (navigableIds.length === 0) return;
        if (!focusedConvId) {
            focusedConvId =
                direction === 1 ? navigableIds[0]! : navigableIds[navigableIds.length - 1]!;
            return;
        }
        const idx = navigableIds.indexOf(focusedConvId);
        if (idx === -1) {
            focusedConvId = navigableIds[0]!;
            return;
        }
        const next = idx + direction;
        if (next >= 0 && next < navigableIds.length) {
            focusedConvId = navigableIds[next]!;
        }
    }

    /** Scroll the currently focused sidebar conversation into view. */
    function scrollFocusedIntoView() {
        if (!focusedConvId) return;
        requestAnimationFrame(() => {
            document
                .getElementById(`sidebar-conv-${focusedConvId}`)
                ?.scrollIntoView({ block: "nearest" });
        });
    }

    function handleSidebarKeydown(e: KeyboardEvent) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            moveFocus(1);
            scrollFocusedIntoView();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            moveFocus(-1);
            scrollFocusedIntoView();
        } else if (e.key === "Enter" && focusedConvId) {
            e.preventDefault();
            e.stopPropagation();
            handleSelectConversation(focusedConvId);
            focusedConvId = null;
        } else if (e.key === "Escape" && focusedConvId) {
            e.stopPropagation();
            focusedConvId = null;
        }
    }

    // Clear focus when conversation list changes significantly
    $effect(() => {
        // Re-read navigableIds to establish dependency
        void navigableIds.length;
        // Don't clear if the focused ID is still in the list
        if (focusedConvId && !navigableIds.includes(focusedConvId)) {
            focusedConvId = null;
        }
    });

    // --- Bulk-select mode state ---
    let selectMode = $state(false);
    let bulkTagValue = $state("");
    let showBulkTagDialog = $state(false);

    function enterSelectMode(initialId: string) {
        selectMode = true;
        toggleSelection(initialId);
    }

    function exitSelectMode() {
        selectMode = false;
        clearSelection();
    }

    async function handleBulkAction(action: BulkAction) {
        if (action === "tag") {
            showBulkTagDialog = true;
            return;
        }
        await bulkAction(action);
        exitSelectMode();
    }

    async function commitBulkTag() {
        const tags = bulkTagValue
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t.length > 0);
        if (tags.length > 0) {
            await bulkAction("tag", tags);
        }
        showBulkTagDialog = false;
        bulkTagValue = "";
        exitSelectMode();
    }

    function handleArchiveConversation(id: string, archived: boolean) {
        if (archived) {
            void archiveConversation(id);
        } else {
            void unarchiveConversation(id);
        }
    }

    function handleNewChat() {
        setActiveConversation(null);
        clearMessages();
        disconnectStream();
        if (sidebar.isMobile) sidebar.setOpenMobile(false);
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
        if (sidebar.isMobile) sidebar.setOpenMobile(false);
        void goto(resolve(`/chat/${id}`));
    }

    function handlePinConversation(id: string, pinned: boolean) {
        void pinConversation(id, pinned);
    }

    async function handleLogout() {
        disconnectStream();
        if (sidebar.isMobile) sidebar.setOpenMobile(false);
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
            if (sidebar.isMobile) sidebar.setOpenMobile(false);
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

    // ⌘F focuses the sidebar search input directly;
    // ⌘P goes through the shortcut event system (search-conversations action)
    onMount(() => {
        function focusSearch() {
            searchInputRef?.focus();
        }

        function handleKeyDown(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key === "f") {
                const tag = (e.target as HTMLElement | null)?.tagName;
                if (tag === "INPUT" || tag === "TEXTAREA") return;
                e.preventDefault();
                focusSearch();
            }
        }

        function handleShortcut(e: CustomEvent<ShortcutEventDetail>) {
            if (e.detail.action === "search-conversations") {
                focusSearch();
            }
        }

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener(SHORTCUT_EVENT_TYPE, handleShortcut as EventListener);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener(SHORTCUT_EVENT_TYPE, handleShortcut as EventListener);
        };
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

<Sidebar onkeydown={handleSidebarKeydown}>
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
                        aria-label="Search conversations"
                    />
                    {#if searching}
                        <Spinner class="h-3.5 w-3.5 shrink-0" />
                    {/if}
                    {#if !searchQuery.trim()}
                        <kbd
                            class="pointer-events-none inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground"
                        >
                            ⌘P
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
                                                <div class="flex items-center gap-1.5 min-w-0">
                                                    <span class="truncate">{result.title}</span>
                                                    {#if draftIds.has(result.id)}
                                                        <Badge
                                                            variant="outline"
                                                            class="shrink-0 text-[9px] h-4 px-1 leading-none gap-0.5"
                                                            >Draft</Badge
                                                        >
                                                    {/if}
                                                </div>
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
                                    onclick={() => {
                                        if (sidebar.isMobile) sidebar.setOpenMobile(false);
                                    }}
                                >
                                    {tag} ({count})
                                </a>
                            {/each}
                        </div>
                    </SidebarGroupContent>
                </SidebarGroup>
            {/if}

            {#if !convs.loading && pinnedConvs.length > 0}
                <SidebarGroup>
                    <SidebarGroupLabel>Pinned</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {#each pinnedConvs as conv (conv.id)}
                                <ConversationItem
                                    {conv}
                                    isActive={conv.id === convs.activeId}
                                    isFocused={conv.id === focusedConvId}
                                    generatingTitle={generatingTitleForId === conv.id}
                                    hasDraft={draftIds.has(conv.id)}
                                    {selectMode}
                                    isSelected={convs.selectedIds.has(conv.id)}
                                    onSelect={handleSelectConversation}
                                    onDelete={handleDeleteConversation}
                                    onRename={handleRenameConversation}
                                    onTag={handleTagConversation}
                                    onGenerateTitle={handleGenerateTitle}
                                    onPin={handlePinConversation}
                                    onArchive={handleArchiveConversation}
                                    onToggleSelect={toggleSelection}
                                    onEnterSelectMode={enterSelectMode}
                                />
                            {/each}
                        </SidebarMenu>
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
                            {:else if recentConvs.length === 0}
                                <p class="px-2 py-4 text-xs text-muted-foreground text-center">
                                    No conversations yet
                                </p>
                            {:else}
                                {#each recentConvs as conv (conv.id)}
                                    <ConversationItem
                                        {conv}
                                        isActive={conv.id === convs.activeId}
                                        isFocused={conv.id === focusedConvId}
                                        generatingTitle={generatingTitleForId === conv.id}
                                        hasDraft={draftIds.has(conv.id)}
                                        {selectMode}
                                        isSelected={convs.selectedIds.has(conv.id)}
                                        onSelect={handleSelectConversation}
                                        onDelete={handleDeleteConversation}
                                        onRename={handleRenameConversation}
                                        onTag={handleTagConversation}
                                        onGenerateTitle={handleGenerateTitle}
                                        onPin={handlePinConversation}
                                        onArchive={handleArchiveConversation}
                                        onToggleSelect={toggleSelection}
                                        onEnterSelectMode={enterSelectMode}
                                    />
                                {/each}
                            {/if}
                        </SidebarMenu>
                    </ScrollArea>
                </SidebarGroupContent>
            </SidebarGroup>

            {#if !convs.loading && archivedConvs.length > 0}
                <SidebarGroup>
                    <SidebarGroupLabel>Archived</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {#each archivedConvs as conv (conv.id)}
                                <ConversationItem
                                    {conv}
                                    isActive={conv.id === convs.activeId}
                                    isFocused={conv.id === focusedConvId}
                                    generatingTitle={generatingTitleForId === conv.id}
                                    hasDraft={draftIds.has(conv.id)}
                                    {selectMode}
                                    isSelected={convs.selectedIds.has(conv.id)}
                                    onSelect={handleSelectConversation}
                                    onDelete={handleDeleteConversation}
                                    onRename={handleRenameConversation}
                                    onTag={handleTagConversation}
                                    onGenerateTitle={handleGenerateTitle}
                                    onPin={handlePinConversation}
                                    onArchive={handleArchiveConversation}
                                    onToggleSelect={toggleSelection}
                                    onEnterSelectMode={enterSelectMode}
                                />
                            {/each}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            {/if}
        {/if}

        {#if convs.error}
            <p class="px-2 text-xs text-destructive">{convs.error}</p>
        {/if}
    </SidebarContent>

    {#if selectMode}
        <div class="border-t p-2 flex flex-col gap-2">
            <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span>{String(convs.selectedIds.size)} selected</span>
                <div class="flex gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        class="h-6 px-2 text-xs"
                        onclick={() => {
                            if (
                                archivedConvs.length > 0 &&
                                recentConvs.length === 0 &&
                                pinnedConvs.length === 0
                            ) {
                                selectAllArchived();
                            } else {
                                selectAllActive();
                            }
                        }}
                    >
                        Select all
                    </Button>
                </div>
            </div>
            <div class="flex flex-wrap gap-1">
                {#if archivedConvs.length > 0 && [...convs.selectedIds].some( (id) => archivedConvs.some((c) => c.id === id) )}
                    <Button
                        variant="outline"
                        size="sm"
                        class="h-7 px-2 text-xs"
                        onclick={() => void handleBulkAction("unarchive")}
                        disabled={convs.selectedIds.size === 0}
                    >
                        <ArchiveRestore class="h-3.5 w-3.5 mr-1" />
                        Unarchive
                    </Button>
                {:else}
                    <Button
                        variant="outline"
                        size="sm"
                        class="h-7 px-2 text-xs"
                        onclick={() => void handleBulkAction("archive")}
                        disabled={convs.selectedIds.size === 0}
                    >
                        <Archive class="h-3.5 w-3.5 mr-1" />
                        Archive
                    </Button>
                {/if}
                <Button
                    variant="outline"
                    size="sm"
                    class="h-7 px-2 text-xs"
                    onclick={() => void handleBulkAction("tag")}
                    disabled={convs.selectedIds.size === 0}
                >
                    <TagIcon class="h-3.5 w-3.5 mr-1" />
                    Tag
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    class="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    onclick={() => void handleBulkAction("delete")}
                    disabled={convs.selectedIds.size === 0}
                >
                    <Trash2 class="h-3.5 w-3.5 mr-1" />
                    Delete
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 px-2 text-xs ml-auto"
                    onclick={exitSelectMode}
                >
                    <X class="h-3.5 w-3.5 mr-1" />
                    Cancel
                </Button>
            </div>
        </div>
    {/if}

    <SidebarFooter>
        <SidebarMenu>
            <SidebarMenuItem>
                <SidebarMenuButton
                    isActive={currentPath === "/settings"}
                    onclick={() => {
                        if (sidebar.isMobile) sidebar.setOpenMobile(false);
                        void goto(resolve("/settings"));
                    }}
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

<!-- Bulk Tag Dialog -->
<Dialog
    open={showBulkTagDialog}
    onOpenChange={(open) => {
        if (!open) {
            showBulkTagDialog = false;
            bulkTagValue = "";
        }
    }}
>
    <DialogContent>
        <DialogHeader>
            <DialogTitle>Add Tags to {String(convs.selectedIds.size)} Conversations</DialogTitle>
        </DialogHeader>
        <Input
            bind:value={bulkTagValue}
            placeholder="tag1, tag2, tag3"
            onkeydown={(e: KeyboardEvent) => {
                if (e.key === "Enter") void commitBulkTag();
            }}
        />
        <DialogFooter>
            <Button
                variant="outline"
                onclick={() => {
                    showBulkTagDialog = false;
                    bulkTagValue = "";
                }}>Cancel</Button
            >
            <Button onclick={() => void commitBulkTag()}>Add Tags</Button>
        </DialogFooter>
    </DialogContent>
</Dialog>
