<script lang="ts">
    import { Button } from "$lib/components/ui/button/index.js";
    import { Textarea } from "$lib/components/ui/textarea/index.js";
    import {
        DropdownMenu,
        DropdownMenuContent,
        DropdownMenuGroup,
        DropdownMenuItem,
        DropdownMenuLabel,
        DropdownMenuTrigger,
    } from "$lib/components/ui/dropdown-menu/index.js";
    import {
        ContextMenu,
        ContextMenuContent,
        ContextMenuItem,
        ContextMenuTrigger,
        ContextMenuSeparator,
    } from "$lib/components/ui/context-menu/index.js";
    import {
        Tooltip,
        TooltipContent,
        TooltipProvider,
        TooltipTrigger,
    } from "$lib/components/ui/tooltip/index.js";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import Send from "@lucide/svelte/icons/send";
    import StopCircle from "@lucide/svelte/icons/stop-circle";
    import Cpu from "@lucide/svelte/icons/cpu";
    import Scissors from "@lucide/svelte/icons/scissors";
    import Clipboard from "@lucide/svelte/icons/clipboard";
    import ClipboardPaste from "@lucide/svelte/icons/clipboard-paste";
    import Eraser from "@lucide/svelte/icons/eraser";
    import Check from "@lucide/svelte/icons/check";
    import type { ModelInfo } from "$lib/types.js";

    interface Props {
        /** The text value of the input (two-way bindable) */
        value: string;
        /** Placeholder text when input is empty */
        placeholder?: string;
        /** Whether the input is disabled */
        disabled?: boolean;
        /** Whether the AI is currently generating (shows abort button) */
        generating?: boolean;
        /** Whether connected to the server (affects send button state) */
        connected?: boolean;
        /** Available models for the model selector dropdown */
        models?: ModelInfo[];
        /** The currently selected model ID (two-way bindable) */
        selectedModelId?: string;
        /** The user's default model ID — a dot is shown on the selector when a non-default model is picked */
        defaultModelId?: string;
        /** Callback when send button is clicked */
        onsend?: () => void;
        /** Callback when abort button is clicked */
        onabort?: () => void;
    }

    let {
        value = $bindable(""),
        placeholder = "Type a message...",
        disabled = false,
        generating = false,
        connected = true,
        models = [],
        selectedModelId = $bindable(""),
        defaultModelId = "",
        onsend,
        onabort,
    }: Props = $props();

    let textareaRef: HTMLTextAreaElement | null = $state(null);

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }

    function handleSend() {
        if (!value.trim() || !connected || generating || disabled) return;
        onsend?.();
    }

    function handleAbort() {
        onabort?.();
    }

    async function handleCut() {
        const sel = window.getSelection();
        if (sel?.toString()) {
            await navigator.clipboard.writeText(sel.toString());
            document.execCommand("cut");
        }
    }

    async function handleCopy() {
        const sel = window.getSelection();
        if (sel?.toString()) {
            await navigator.clipboard.writeText(sel.toString());
        }
    }

    async function handlePaste() {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                document.execCommand("insertText", false, text);
            }
        } catch {
            // Clipboard read failed (e.g. permissions denied)
        }
    }

    function handleClear() {
        value = "";
        textareaRef?.focus();
        adjustTextareaHeight();
    }

    // Auto-resize textarea based on content
    function adjustTextareaHeight() {
        if (!textareaRef) return;
        // Reset to auto to get the correct scrollHeight
        textareaRef.style.height = "auto";
        // Set to scrollHeight (capped at max-height via CSS)
        textareaRef.style.height = `${textareaRef.scrollHeight}px`;
    }

    // Watch value changes to adjust height
    $effect(() => {
        if (value !== undefined) {
            adjustTextareaHeight();
        }
    });

    // Look up a model's display name from the available models list.
    // Model IDs are unique, so we only need the modelId to find it.
    function getModelDisplayName(modelId: string | undefined): string {
        if (!modelId) return "AI";
        const found = models.find((m) => m.id === modelId);
        return found?.name || modelId;
    }

    // Group models by provider for the dropdown
    let modelsByProvider = $derived(() => {
        const groups: Record<string, ModelInfo[]> = {};
        for (const model of models) {
            if (!groups[model.provider]) {
                groups[model.provider] = [];
            }
            groups[model.provider].push(model);
        }
        return groups;
    });

    // Whether the selected model differs from the user's default
    let modelIsNonDefault = $derived(
        selectedModelId && defaultModelId && selectedModelId !== defaultModelId
    );

    const canSend = $derived(connected && !generating && !disabled && value.trim().length > 0);
</script>

<!-- Unified input container with border -->
<div
    class="group flex items-center gap-2 rounded-md border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring focus-within:border-ring transition-all"
>
    <!-- Model selector button -->
    {#if models.length > 0}
        <DropdownMenu>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger>
                        {#snippet child({ props })}
                            <DropdownMenuTrigger
                                {...props}
                                class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-muted text-foreground transition-colors cursor-pointer"
                                aria-label="Select model"
                            >
                                <Cpu class="size-4" />
                                {#if modelIsNonDefault}
                                    <span
                                        class="absolute top-1 right-1 size-2 rounded-full bg-primary"
                                    ></span>
                                {/if}
                            </DropdownMenuTrigger>
                        {/snippet}
                    </TooltipTrigger>
                    <TooltipContent>Model: {getModelDisplayName(selectedModelId)}</TooltipContent>
                </Tooltip>
            </TooltipProvider>
            <DropdownMenuContent align="start">
                {#each Object.entries(modelsByProvider()) as [provider, providerModels] (provider)}
                    <DropdownMenuGroup>
                        <DropdownMenuLabel class="text-xs text-muted-foreground"
                            >{provider}</DropdownMenuLabel
                        >
                        {#each providerModels as model (model.id)}
                            <DropdownMenuItem
                                onclick={() => (selectedModelId = model.id)}
                                class="flex items-center justify-between"
                            >
                                <span class="text-xs">{model.name}</span>
                                {#if selectedModelId === model.id}
                                    <Check class="size-3.5 shrink-0" />
                                {/if}
                            </DropdownMenuItem>
                        {/each}
                    </DropdownMenuGroup>
                {/each}
            </DropdownMenuContent>
        </DropdownMenu>
    {:else}
        <div class="shrink-0 w-8"></div>
    {/if}

    <!-- Text input with context menu -->
    <ContextMenu>
        <ContextMenuTrigger class="flex-1 min-w-0">
            <Textarea
                bind:ref={textareaRef}
                bind:value
                {placeholder}
                rows={1}
                class="border-0 bg-transparent dark:bg-transparent focus-visible:ring-0 resize-none py-1 w-full overflow-hidden min-h-0 max-h-[200px]"
                onkeydown={handleKeydown}
                oninput={adjustTextareaHeight}
                {disabled}
            />
        </ContextMenuTrigger>
        <ContextMenuContent>
            <ContextMenuItem onclick={handleCut}>
                <Scissors class="mr-2 h-4 w-4" />
                Cut
            </ContextMenuItem>
            <ContextMenuItem onclick={handleCopy}>
                <Clipboard class="mr-2 h-4 w-4" />
                Copy
            </ContextMenuItem>
            <ContextMenuItem onclick={handlePaste}>
                <ClipboardPaste class="mr-2 h-4 w-4" />
                Paste
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onclick={handleClear}>
                <Eraser class="mr-2 h-4 w-4" />
                Clear
            </ContextMenuItem>
        </ContextMenuContent>
    </ContextMenu>

    <!-- Send / Abort button -->
    {#if generating}
        <Button
            variant="destructive"
            size="icon"
            onclick={handleAbort}
            class="h-8 w-8 shrink-0"
            aria-label="Stop generating"
        >
            <StopCircle class="size-4" />
        </Button>
    {:else}
        <Button
            size="icon"
            onclick={handleSend}
            disabled={!canSend}
            class="h-8 w-8 shrink-0"
            aria-label="Send message"
        >
            {#if disabled}
                <Spinner class="h-4 w-4" />
            {:else}
                <Send class="size-4" />
            {/if}
        </Button>
    {/if}
</div>
