<script lang="ts">
    /**
     * @file Tool call display component with a11y support.
     */
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import Wrench from "@lucide/svelte/icons/wrench";
    import Check from "@lucide/svelte/icons/check";
    import X from "@lucide/svelte/icons/x";
    import Clipboard from "@lucide/svelte/icons/clipboard";

    import type { ToolCallInfo } from "$lib/types.js";
    import { formatArgValue } from "$lib/utils.js";

    interface Props {
        /** The tool call data to render */
        toolCall: ToolCallInfo;
        /** Compact variant (used inside thinking groups) */
        compact?: boolean;
    }

    let { toolCall, compact = false }: Props = $props();

    let copiedOutput = $state(false);

    /** Accessible status label for screen readers */
    let statusLabel = $derived(
        toolCall.status === "running"
            ? "Running"
            : toolCall.status === "completed"
              ? "Completed"
              : "Error"
    );

    /**
     * Copy the tool call output to the clipboard.
     */
    async function handleCopyOutput() {
        if (!toolCall.output) return;
        try {
            await navigator.clipboard.writeText(toolCall.output);
            copiedOutput = true;
            setTimeout(() => (copiedOutput = false), 2000);
        } catch {
            // Clipboard API not available (e.g. non-HTTPS context)
        }
    }
</script>

<details
    class={compact
        ? "group/tc rounded border bg-muted/30 text-xs my-1"
        : "group rounded-lg border bg-background text-sm"}
    data-testid="tool-call"
    data-tool-name={toolCall.toolName}
>
    <summary
        class={compact
            ? "flex items-center gap-2 px-2 py-1 cursor-pointer select-none hover:bg-muted/50 transition-colors rounded text-xs"
            : "flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-muted/50 transition-colors rounded-lg text-xs"}
        aria-label="{toolCall.toolName} tool call, {statusLabel}"
        data-status={toolCall.status}
    >
        <Wrench class="size-3 text-muted-foreground shrink-0" aria-hidden="true" />
        <span class="font-medium shrink-0">{toolCall.toolName}</span>
        {#if toolCall.arguments && Object.keys(toolCall.arguments).length > 0}
            <span class="text-muted-foreground/70 truncate min-w-0">
                {#each Object.entries(toolCall.arguments) as [key, value], i (key)}
                    {#if i > 0}<span class="text-muted-foreground/40 mx-0.5">·</span>{/if}
                    {@const displayValue = formatArgValue(value)}
                    {@const fullValue =
                        typeof value === "string" ? value : JSON.stringify(value, null, 2)}
                    <span class="font-mono" title={fullValue}
                        >{key} <span class="text-muted-foreground/40">·</span> {displayValue}</span
                    >
                {/each}
            </span>
        {/if}
        <span class="ml-auto shrink-0 flex items-center" aria-label={statusLabel}>
            {#if toolCall.status === "running"}
                <Spinner class="size-3" aria-hidden="true" />
            {:else if toolCall.status === "completed"}
                <Check class="size-3.5 text-green-600 dark:text-green-400" aria-hidden="true" />
            {:else if toolCall.status === "error"}
                <X class="size-3.5 text-destructive" aria-hidden="true" />
            {/if}
        </span>
    </summary>

    {#if toolCall.output}
        <div
            class={compact
                ? "group/output relative border-t px-2 py-1 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all max-h-48 overflow-auto"
                : "group/output relative border-t px-3 py-2 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all max-h-48 overflow-auto"}
            role="region"
            aria-label="Tool call output"
        >
            {toolCall.output}
            <button
                onclick={handleCopyOutput}
                class={compact
                    ? "absolute top-1 right-1 opacity-0 group-hover/output:opacity-100 transition-opacity inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground bg-muted/80 rounded px-1 py-0.5 cursor-pointer"
                    : "absolute top-2 right-2 opacity-0 group-hover/output:opacity-100 transition-opacity inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground bg-muted/80 rounded px-1.5 py-0.5 cursor-pointer"}
                aria-label="Copy output"
            >
                {#if copiedOutput}
                    <Check class="size-3" aria-hidden="true" />
                {:else}
                    <Clipboard class="size-3" aria-hidden="true" />
                {/if}
            </button>
        </div>
    {:else if toolCall.status !== "running"}
        <div
            class={compact
                ? "border-t px-2 py-1 text-xs text-muted-foreground/60 italic"
                : "border-t px-3 py-2 text-xs text-muted-foreground/60 italic"}
        >
            No output
        </div>
    {/if}
</details>
