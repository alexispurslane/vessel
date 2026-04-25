<script lang="ts">
    import SvelteMarkdown from "@humanspeak/svelte-markdown";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import Brain from "@lucide/svelte/icons/brain";
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import Trash2 from "@lucide/svelte/icons/trash-2";
    import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
    import CodeBlock from "$lib/components/chat/code-block.svelte";
    import ToolCall from "$lib/components/chat/tool-call.svelte";
    import type { ThinkingGroup } from "$lib/types.js";

    interface Props {
        /** The thinking group to render */
        group: ThinkingGroup;
        /** Whether the thinking dropdown is open */
        thinkingIsOpen?: boolean;
        /** Callback when the thinking dropdown is toggled */
        onthinkingtoggle?: (open: boolean) => void;
        /** Callback to delete this group (navigate back to before the first message in the group) */
        ondelete?: (messageId: string, role: string) => void;
        /** Callback to regenerate this group (navigate back and re-send) */
        onregenerate?: (messageId: string, role: string) => void;
        /** Whether a navigation operation is in progress */
        navigating?: boolean;
    }

    let { group, thinkingIsOpen, onthinkingtoggle, ondelete, onregenerate, navigating = false }: Props = $props();

    /** Custom renderers for SvelteMarkdown */
    const renderers = {
        code: CodeBlock,
    };

    let thinkingEl: HTMLDivElement | undefined = $state();
    let confirmDelete = $state(false);
    let confirmDeleteTimer: ReturnType<typeof setTimeout> | undefined;

    // Auto-scroll thinking block to bottom as streaming tokens arrive
    $effect(() => {
        if (group.streaming && thinkingEl) {
            requestAnimationFrame(() => {
                if (thinkingEl) {
                    thinkingEl.scrollTop = thinkingEl.scrollHeight;
                }
            });
        }
    });

    function handleToggle(e: Event) {
        const el = e.currentTarget as HTMLDetailsElement;
        onthinkingtoggle?.(el.open);
    }

    function handleDelete() {
        if (confirmDelete) {
            // Second click — actually delete
            confirmDelete = false;
            if (confirmDeleteTimer) clearTimeout(confirmDeleteTimer);
            // Delete uses the first message ID in the group — navigating back
            // to before it removes the entire group from the branch
            const firstId = group.messageIds[0];
            if (firstId) ondelete?.(firstId, "assistant");
        } else {
            // First click — show confirmation
            confirmDelete = true;
            // Auto-cancel confirmation after 3 seconds
            confirmDeleteTimer = setTimeout(() => {
                confirmDelete = false;
            }, 3000);
        }
    }

    function handleRegenerate() {
        // Regenerate uses the first message ID in the group — navigating back
        // to before it and re-sending the preceding user message
        const firstId = group.messageIds[0];
        if (firstId) onregenerate?.(firstId, "assistant");
    }

    /** Count tool calls in the group */
    let toolCallCount = $derived(
        group.steps.filter((s) => s.type === "toolCall").length
    );

    /** Whether any thinking step is still streaming */
    let thinkingStreaming = $derived(
        group.steps.some((s) => s.type === "thinking" && s.streaming)
    );

    /** Whether to show the action bar */
    let showActions = $derived(
        !group.streaming && !navigating && (onregenerate || ondelete)
    );
</script>

<div class="flex flex-col gap-1.5 w-full font-sans group/tg">
    <details
        class="group rounded-lg border bg-background text-sm"
        open={thinkingIsOpen ?? group.streaming}
        ontoggle={handleToggle}
    >
        <summary
            class="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-muted/50 transition-colors rounded-lg text-xs text-muted-foreground"
        >
            {#if thinkingStreaming || group.streaming}
                <Spinner class="size-3" />
            {:else}
                <Brain class="size-3" />
            {/if}
            <span class="font-medium">
                {#if thinkingStreaming || group.streaming}
                    Thinking...
                {:else}
                    Thought
                {/if}
            </span>
            {#if toolCallCount > 0}
                <span class="text-muted-foreground/60">
                    &middot; {toolCallCount} {toolCallCount === 1 ? 'tool call' : 'tool calls'}
                </span>
            {/if}
            <ChevronDown
                class="size-3 ml-auto shrink-0 transition-transform group-open:rotate-180"
            />
        </summary>
        <div bind:this={thinkingEl} class="border-t px-3 py-2 text-xs text-muted-foreground max-h-96 overflow-auto">
            {#each group.steps as step, stepIdx (step.id)}
                {#if step.type === "thinking" && step.thinking}
                    <div class="markdown-prose markdown-thinking">
                        <SvelteMarkdown
                            source={step.thinking}
                            streaming={step.streaming}
                            codeStreaming={step.streaming ?? false}
                            {renderers}
                            options={{ gfm: true, breaks: true }}
                        />
                    </div>
                {:else if step.type === "toolCall" && step.toolCall}
                    <ToolCall toolCall={step.toolCall} compact={true} />
                {/if}
            {/each}
        </div>
    </details>

    <!-- Action bar at bottom, visible on hover -->
    {#if showActions}
        <div class="flex justify-end gap-1 opacity-0 group-hover/tg:opacity-100 transition-opacity">
            {#if onregenerate}
                <button
                    onclick={() => handleRegenerate()}
                    class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-muted"
                    aria-label="Regenerate response"
                    title="Regenerate response"
                >
                    <RotateCcw class="size-3" />
                </button>
            {/if}
            {#if ondelete}
                <button
                    onclick={() => handleDelete()}
                    class="inline-flex items-center gap-1 text-[11px] transition-colors cursor-pointer px-1.5 py-0.5 rounded {confirmDelete ? 'text-destructive bg-destructive/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
                    aria-label={confirmDelete ? 'Confirm delete' : 'Delete message'}
                    title={confirmDelete ? 'Click again to confirm deletion' : 'Delete message'}
                >
                    <Trash2 class="size-3" />
                    {#if confirmDelete}
                        <span class="text-[10px] font-medium">Confirm?</span>
                    {/if}
                </button>
            {/if}
        </div>
    {:else if navigating}
        <div class="flex justify-end gap-1 mt-0">
            <span class="inline-flex items-center gap-1 text-[11px] text-muted-foreground px-1.5 py-0.5">
                <Spinner class="size-3" />
                Updating...
            </span>
        </div>
    {/if}
</div>
