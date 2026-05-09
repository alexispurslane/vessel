<script lang="ts">
    import "../app.css";
    import {
        SidebarProvider,
        SidebarInset,
        SidebarTrigger,
    } from "$lib/components/ui/sidebar/index.js";
    import { Separator } from "$lib/components/ui/separator/index.js";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import { onMount } from "svelte";
    import { page } from "$app/state";
    import { ModeWatcher } from "mode-watcher";
    import { getAuth, checkAuth, initAuth } from "$lib/stores/auth.svelte.js";
    import {
        getConversations,
        loadConversations,
        setActiveConversation,
    } from "$lib/stores/conversations.svelte.js";
    import { getChat } from "$lib/stores/chat.svelte.js";
    import { loadSettings } from "$lib/stores/settings.svelte.js";
    import {
        syncNotificationSettings,
        clearTabTitleNotification,
    } from "$lib/stores/notifications.svelte.js";
    import { hashHue } from "$lib/utils.js";
    import { resolve } from "$app/paths";
    import AppSidebar from "$lib/components/sidebar/index.svelte";
    import SwipeToOpen from "$lib/components/sidebar/swipe-to-open.svelte";
    import ShortcutsHelp from "$lib/components/shortcuts-help/ShortcutsHelp.svelte";
    import {
        handleGlobalKeydown,
        SHORTCUT_EVENT_TYPE,
        type ShortcutEventDetail,
    } from "$lib/utils/keyboard.js";
    import { abort, clearMessages, disconnectStream } from "$lib/stores/chat.svelte.js";
    import { exportConversation } from "$lib/api.js";
    import { goto } from "$app/navigation";
    import type { AuthStatus } from "$lib/types.js";
    const auth = getAuth();
    const convs = getConversations();

    // Use SSR auth data for the initial render — avoids the loading spinner.
    // page.data.auth comes from +layout.server.ts (server-side auth check).
    // Fall back to the auth store's value (which starts as unauthenticated).
    let ssrAuth: AuthStatus | undefined = $derived(page.data.auth);

    // Derived auth state: either source saying "authenticated" wins.
    // - SSR data (`ssrAuth`) is authoritative for the initial page load.
    // - Client-side store (`auth.isAuthenticated`) is more up-to-date after
    //   login (before invalidated SSR data arrives).
    // We use || instead of ?? because `ssrAuth?.authenticated` can be `false`
    // (stale SSR data from before login), and `false ?? true` returns `false`
    // which incorrectly hides the app behind the loading spinner.
    let isAuthenticated = $derived(ssrAuth?.authenticated || auth.isAuthenticated);

    // Current route info
    let currentPath: string = $derived(page.url.pathname);

    // Check if we're on an auth page (no sidebar needed)
    let isAuthPage = $derived(currentPath === "/login" || currentPath === "/setup");

    // Active conversation ID from URL
    let activeConversationId = $derived(
        currentPath.startsWith("/chat/") ? currentPath.split("/chat/")[1] : null
    );

    // Initialize auth store from SSR data so client-side code sees
    // the correct state immediately (before checkAuth() completes).
    const initialAuth = page.data.auth;
    if (initialAuth) {
        initAuth(initialAuth);
    }

    // Load conversations and settings when authenticated
    $effect(() => {
        if (isAuthenticated) {
            void loadConversations();
            void loadSettings().then(() => {
                syncNotificationSettings();
            });
        }
    });

    // Sync active conversation with URL
    $effect(() => {
        if (activeConversationId && activeConversationId !== convs.activeId) {
            setActiveConversation(activeConversationId);
        } else if (!activeConversationId && convs.activeId) {
            // Navigated away from a chat page — clear the active conversation
            setActiveConversation(null);
        }
    });

    onMount(() => {
        // Revalidate auth on the client — catches session expiry the
        // server might not know about. SSR data already initialized the store.
        void checkAuth();

        // When the user returns to the tab, clear any tab title notification
        function handleVisibilityChange() {
            if (document.visibilityState === "visible") {
                clearTabTitleNotification();
            }
        }
        document.addEventListener("visibilitychange", handleVisibilityChange);

        // When the user closes the tab or navigates away, release the
        // in-memory session. Use sendBeacon (fetch may not complete on unload).
        function handleBeforeUnload() {
            const chat = getChat();
            const convId = chat.conversationId;
            if (convId) {
                // sendBeacon sends a POST with credentials by default for
                // same-origin. Set Content-Type so SvelteKit can parse the body.
                navigator.sendBeacon(
                    `/api/sessions/${convId}/release`,
                    new Blob([], { type: "application/json" })
                );
            }
        }

        window.addEventListener("beforeunload", handleBeforeUnload);

        // Global keyboard shortcuts
        window.addEventListener("keydown", handleGlobalKeydown);

        function handleShortcut(e: CustomEvent<ShortcutEventDetail>) {
            const chat = getChat();
            switch (e.detail.action) {
                case "new-chat": {
                    setActiveConversation(null);
                    clearMessages();
                    disconnectStream();
                    void goto(resolve("/"));
                    break;
                }
                case "copy-conversation": {
                    const convId = chat.conversationId;
                    if (convId) {
                        exportConversation(convId, "markdown");
                    }
                    break;
                }
                case "abort": {
                    // Only abort if we're actually generating
                    if (chat.generating) {
                        void abort();
                    }
                    break;
                }
            }
        }
        window.addEventListener(SHORTCUT_EVENT_TYPE, handleShortcut as EventListener);

        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("keydown", handleGlobalKeydown);
            window.removeEventListener(SHORTCUT_EVENT_TYPE, handleShortcut as EventListener);
        };
    });

    let { children } = $props<{ children: import("svelte").Snippet }>();
</script>

<svelte:head>
    <title>Vessel</title>
</svelte:head>

<ModeWatcher />

{#if isAuthPage}
    <!-- Auth pages get no sidebar layout -->
    {@render children()}
{:else if !isAuthenticated}
    <!-- Loading state while checking auth -->
    <div class="flex min-h-svh items-center justify-center">
        <Spinner class="h-8 w-8" />
    </div>
{:else}
    <SidebarProvider class="h-svh overflow-hidden">
        <AppSidebar {currentPath} />

        <ShortcutsHelp />

        <SwipeToOpen>
            <SidebarInset class="min-h-0 overflow-hidden">
                <header class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
                    <SidebarTrigger />
                    <Separator orientation="vertical" class="h-4" />
                    <div class="flex items-center gap-2 min-w-0 flex-1">
                        <span class="text-sm text-muted-foreground truncate">
                            {convs.activeConversation?.title ?? "Vessel"}
                        </span>
                        {#if convs.activeConversation?.tags.length}
                            <div class="flex items-center gap-1 shrink-0">
                                {#each convs.activeConversation.tags as tag (tag)}
                                    <a
                                        href={resolve(`/tags/${tag}`)}
                                        class="tag-pill-colors inline-flex items-center justify-center h-5 px-1.5 rounded-full text-[10px] leading-none font-medium whitespace-nowrap cursor-pointer hover:opacity-80 transition-opacity"
                                        style="--tag-hue: {hashHue(tag)}"
                                    >
                                        {tag}
                                    </a>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </header>

                <main class="flex flex-1 flex-col min-h-0 overflow-auto">
                    {@render children()}
                </main>
            </SidebarInset>
        </SwipeToOpen>
    </SidebarProvider>
{/if}
