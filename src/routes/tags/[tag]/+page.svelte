<script lang="ts">
    import { page } from "$app/stores";
    import { goto } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { listConversationsByTag } from "$lib/api.js";
    import type { ConversationListItem } from "$lib/types.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import MessageSquare from "@lucide/svelte/icons/message-square";
    import { hashHue } from "$lib/utils.js";
    import PageLayout from "$lib/components/page-layout/index.svelte";

    const tag = $derived($page.params.tag!);

    // Start with SSR data — conversations are in the HTML before JS loads.
    // Then refresh client-side when the tag changes.
    let conversations = $state<ConversationListItem[]>($page.data.conversations ?? []);
    let refreshing = $state(false);
    let error = $state<string | null>(null);

    async function refreshConversations() {
        refreshing = true;
        error = null;
        try {
            const result = await listConversationsByTag(tag);
            conversations = result.conversations;
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to load conversations";
        } finally {
            refreshing = false;
        }
    }

    // Refresh when navigating to a different tag (client-side nav)
    $effect(() => {
        if (tag) {
            refreshConversations();
        }
    });

    function openConversation(id: string) {
        goto(resolve(`/chat/${id}`));
    }

    function formatDate(dateStr: string): string {
        try {
            return new Date(dateStr).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
            });
        } catch {
            return dateStr;
        }
    }
</script>

<PageLayout onback={() => window.history.back()}>
    {#snippet heading()}
        <h1 class="text-2xl font-bold">
            <span
                class="tag-pill-colors inline-flex items-center justify-center h-6 px-2 rounded-full text-xs font-medium mr-2 align-middle"
                style="--tag-hue: {hashHue(tag)}"
            >
                {tag}
            </span>
            Conversations
            {#if refreshing}
                <Spinner class="h-4 w-4 ml-2 inline-block" />
            {/if}
        </h1>
    {/snippet}

    {#if error}
        <p class="text-destructive text-sm">{error}</p>
    {:else if conversations.length === 0}
        <p class="text-muted-foreground text-sm">No conversations with this tag.</p>
    {:else}
        <div class="space-y-1">
            {#each conversations as conv (conv.id)}
                <Button
                    variant="ghost"
                    class="w-full justify-start gap-3 px-3 py-2 h-auto text-left"
                    onclick={() => openConversation(conv.id)}
                >
                    <MessageSquare class="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div class="flex-1 min-w-0">
                        <span class="truncate block">{conv.title}</span>
                        <span class="text-xs text-muted-foreground"
                            >{formatDate(conv.updatedAt)}</span
                        >
                    </div>
                    {#if conv.tags.length > 1}
                        <div class="flex items-center gap-1 shrink-0">
                            {#each conv.tags as t (t)}
                                {#if t !== tag}
                                    <a
                                        href={resolve(`/tags/${t}`)}
                                        class="tag-pill-colors inline-flex items-center justify-center h-4 px-1 rounded-full text-[9px] leading-none font-medium cursor-pointer hover:opacity-80 transition-opacity"
                                        style="--tag-hue: {hashHue(t)}"
                                    >
                                        {t}
                                    </a>
                                {/if}
                            {/each}
                        </div>
                    {/if}
                </Button>
            {/each}
        </div>
    {/if}
</PageLayout>
