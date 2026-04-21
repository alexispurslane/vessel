<script lang="ts">
    import SvelteMarkdown from "@humanspeak/svelte-markdown";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import Wrench from "@lucide/svelte/icons/wrench";
    import Check from "@lucide/svelte/icons/check";
    import X from "@lucide/svelte/icons/x";
    import Brain from "@lucide/svelte/icons/brain";
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import CodeBlock from "$lib/components/chat/code-block.svelte";
    import type { ThinkingGroup } from "$lib/types.js";

    interface Props {
        /** The thinking group to render */
        group: ThinkingGroup;
        /** Whether the thinking dropdown is open */
        thinkingIsOpen?: boolean;
        /** Callback when the thinking dropdown is toggled */
        onthinkingtoggle?: (open: boolean) => void;
    }

    let { group, thinkingIsOpen, onthinkingtoggle }: Props = $props();

    /** Custom renderers for SvelteMarkdown */
    const renderers = {
        code: CodeBlock,
    };

    let thinkingEl: HTMLDivElement | undefined = $state();

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

    /** Count tool calls in the group */
    let toolCallCount = $derived(
        group.steps.filter((s) => s.type === "toolCall").length
    );

    /** Whether any thinking step is still streaming */
    let thinkingStreaming = $derived(
        group.steps.some((s) => s.type === "thinking" && s.streaming)
    );
</script>

<div class="flex flex-col gap-1.5 w-full font-sans">
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
                            {renderers}
                            options={{ gfm: true, breaks: true }}
                        />
                    </div>
                {:else if step.type === "toolCall" && step.toolCall}
                    {@const tc = step.toolCall}
                    <details class="group/tc rounded border bg-muted/30 text-xs my-1">
                        <summary
                            class="flex items-center gap-2 px-2 py-1 cursor-pointer select-none hover:bg-muted/50 transition-colors rounded text-xs"
                        >
                            <Wrench class="size-3 text-muted-foreground shrink-0" />
                            <span class="font-medium truncate">{tc.toolName}</span>
                            <span class="ml-auto shrink-0 flex items-center">
                                {#if tc.status === "running"}
                                    <Spinner class="size-3" />
                                {:else if tc.status === "completed"}
                                    <Check class="size-3.5 text-green-600 dark:text-green-400" />
                                {:else if tc.status === "error"}
                                    <X class="size-3.5 text-destructive" />
                                {/if}
                            </span>
                        </summary>
                        {#if tc.output}
                            <div
                                class="border-t px-2 py-1 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all max-h-48 overflow-auto"
                            >
                                {tc.output}
                            </div>
                        {/if}
                    </details>
                {/if}
            {/each}
        </div>
    </details>
</div>
