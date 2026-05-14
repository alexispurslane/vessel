<script lang="ts">
    /**
     * @file Fork-here indicator shown when hovering between messages.
     *
     * Renders a thin hit area that expands on hover to show a dotted line
     * crossing the message view with a fork icon and "Fork conversation here"
     * label. Clicking calls the onfork callback to create a branched conversation.
     */
    import GitFork from "@lucide/svelte/icons/git-fork";
    import { Spinner } from "$lib/components/ui/spinner/index.js";

    interface Props {
        /** The entry ID of the next message (fork includes everything before this entry) */
        entryId: string;
        /** Callback when the user clicks to fork */
        onfork: (beforeEntryId: string) => void;
        /** Whether a fork operation is in progress */
        forking?: boolean;
    }

    let { entryId, onfork, forking = false }: Props = $props();
    let hovered = $state(false);

    function handleClick() {
        if (forking) return;
        onfork(entryId);
    }

    function handleKeydown(e: KeyboardEvent) {
        if ((e.key === "Enter" || e.key === " ") && !forking) {
            e.preventDefault();
            onfork(entryId);
        }
    }
</script>

<div
    class="fork-here-zone"
    class:fork-here-active={hovered}
    onmouseenter={() => (hovered = true)}
    onmouseleave={() => (hovered = false)}
    role="button"
    tabindex={hovered ? 0 : -1}
    onclick={handleClick}
    onkeydown={handleKeydown}
    aria-label="Fork conversation here"
    data-testid="fork-here-zone"
    data-active={hovered}
>
    <div class="fork-here-line">
        <div class="fork-here-dot-line"></div>
        <div class="fork-here-label">
            {#if forking}
                <Spinner class="size-3" />
                <span class="fork-here-text">Forking...</span>
            {:else}
                <GitFork class="size-3.5" />
                <span class="fork-here-text">Fork conversation here</span>
            {/if}
        </div>
        <div class="fork-here-dot-line"></div>
    </div>
</div>

<style>
    .fork-here-zone {
        /* Thin hit area when idle, expands on hover */
        height: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        position: relative;
        z-index: 1;
        transition: height 0.15s ease;
        margin: -3px 0;
        padding: 3px 0;
    }

    .fork-here-active {
        height: 28px;
    }

    .fork-here-line {
        display: flex;
        align-items: center;
        gap: 0;
        width: 100%;
        opacity: 0;
        transition: opacity 0.15s ease;
    }

    .fork-here-active .fork-here-line {
        opacity: 1;
    }

    .fork-here-dot-line {
        flex: 1;
        height: 0;
        border-top: 2px dotted var(--border);
        min-width: 8px;
        transition: border-color 0.15s ease;
    }

    .fork-here-active .fork-here-dot-line {
        border-top-color: var(--primary);
    }

    .fork-here-label {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 10px;
        border-radius: 9999px;
        background: var(--muted);
        color: var(--muted-foreground);
        font-size: 11px;
        font-weight: 500;
        white-space: nowrap;
        border: 1px solid var(--border);
        transition:
            background 0.15s ease,
            color 0.15s ease,
            border-color 0.15s ease;
        flex-shrink: 0;
    }

    .fork-here-active .fork-here-label {
        background: color-mix(in oklch, var(--primary) 12%, transparent);
        color: var(--primary);
        border-color: color-mix(in oklch, var(--primary) 40%, transparent);
    }

    .fork-here-text {
        line-height: 1;
    }
</style>
