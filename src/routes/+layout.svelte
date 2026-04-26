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
    import { page } from "$app/stores";
    import { ModeWatcher } from "mode-watcher";
    import { getAuth, checkAuth, initAuth, doLogout } from "$lib/stores/auth.svelte.js";
    import {
        getConversations,
        loadConversations,
        setActiveConversation,
    } from "$lib/stores/conversations.svelte.js";
    import { disconnectStream, getChat } from "$lib/stores/chat.svelte.js";
    import { loadSettings } from "$lib/stores/settings.svelte.js";
    import { hashHue } from "$lib/utils.js";
    import AppSidebar from "$lib/components/sidebar/index.svelte";
    import type { AuthStatus } from "$lib/types.js";

    const auth = getAuth();
    const convs = getConversations();

    // Use SSR auth data for the initial render — avoids the loading spinner.
    // $page.data.auth comes from +layout.server.ts (server-side auth check).
    // Fall back to the auth store's value (which starts as unauthenticated).
    let ssrAuth: AuthStatus | undefined = $derived($page.data.auth);

    // Derived auth state: SSR data takes priority until the client-side
    // checkAuth() completes, then the store is the source of truth.
    // This ensures authenticated users see the app immediately (no spinner).
    let isAuthenticated = $derived(ssrAuth?.authenticated ?? auth.isAuthenticated);

    // Current route info
    let currentPath: string = $derived($page.url.pathname);

    // Check if we're on an auth page (no sidebar needed)
    let isAuthPage = $derived(currentPath === "/login" || currentPath === "/setup");

    // Active conversation ID from URL
    let activeConversationId = $derived(
        currentPath.startsWith("/chat/") ? currentPath.split("/chat/")[1] : null
    );

    // Initialize auth store from SSR data so client-side code sees
    // the correct state immediately (before checkAuth() completes).
    if (ssrAuth) {
        initAuth(ssrAuth);
    }

    // Load conversations and settings when authenticated
    $effect(() => {
        if (isAuthenticated) {
            loadConversations();
            loadSettings();
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
        // Revalidate auth on the client — this catches session expiry
        // that the server might not know about yet. The SSR data already
        // initialized the store, so the user sees content immediately.
        checkAuth();

        // When the user closes the tab or navigates away, release the
        // in-memory session on the server. We use sendBeacon because
        // fetch requests may not complete during page unload.
        function handleBeforeUnload() {
            const chat = getChat();
            const convId = chat.conversationId;
            if (convId) {
                // sendBeacon sends a POST with credentials (cookies) by default
                // for same-origin requests. We set Content-Type so SvelteKit
                // can parse the body if needed (our endpoint doesn't require one).
                navigator.sendBeacon(
                    `/api/sessions/${convId}/release`,
                    new Blob([], { type: "application/json" })
                );
            }
        }

        window.addEventListener("beforeunload", handleBeforeUnload);

        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
        };
    });

    let { children } = $props();
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

        <SidebarInset class="min-h-0 overflow-hidden">
            <header class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
                <SidebarTrigger />
                <Separator orientation="vertical" class="h-4" />
                <div class="flex items-center gap-2 min-w-0 flex-1">
                    <span class="text-sm text-muted-foreground truncate">
                        {convs.activeConversation?.title ?? "Vessel"}
                    </span>
                    {#if convs.activeConversation?.tags?.length}
                        <div class="flex items-center gap-1 shrink-0">
                            {#each convs.activeConversation.tags as tag}
                                <a
                                    href="/tags/{tag}"
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
    </SidebarProvider>
{/if}
