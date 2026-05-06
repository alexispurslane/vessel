<script lang="ts">
    /**
     * @file Standard page layout with optional back button and heading.
     */
    import { Button } from "$lib/components/ui/button/index.js";
    import ArrowLeft from "@lucide/svelte/icons/arrow-left";

    interface Props {
        /** The page heading (rendered as h1) */
        title?: string;
        /** Custom back handler. Defaults to window.history.back() */
        onback?: () => void;
        /** Whether to show the back button. Defaults to true */
        showBack?: boolean;
        /** Content for the heading area (use instead of title for custom markup) */
        heading?: import("svelte").Snippet;
        /** Main page content */
        children: import("svelte").Snippet;
    }

    let {
        title,
        onback = () => window.history.back(),
        showBack = true,
        heading,
        children,
    }: Props = $props();
</script>

<div class="mx-auto w-full max-w-4xl p-6">
    {#if showBack || title || heading}
        <div class="mb-6 flex items-center gap-4">
            {#if showBack}
                <Button variant="ghost" size="icon" onclick={onback} aria-label="Go back">
                    <ArrowLeft class="h-5 w-5" />
                </Button>
            {/if}
            {#if heading}
                {@render heading()}
            {:else if title}
                <h1 class="text-2xl font-bold">{title}</h1>
            {/if}
        </div>
    {/if}
    {@render children()}
</div>
