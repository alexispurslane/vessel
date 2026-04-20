<script lang="ts">
    import {
        Tooltip,
        TooltipContent,
        TooltipProvider,
        TooltipTrigger,
    } from "$lib/components/ui/tooltip";

    import Bot from "@lucide/svelte/icons/bot";
    import User from "@lucide/svelte/icons/user";

    interface Props {
        /** The role of the message author */
        role: "user" | "assistant" | "system";
        /** Whether this message is consecutive with the previous one (hides avatar) */
        isConsecutive: boolean;
        /** Authenticated username (shown above user avatar) */
        username?: string;
        /** Model ID (used to look up display name for assistant) */
        model?: string;
        /** Model provider */
        modelProvider?: string;
        /** Function to resolve a model ID to a display name */
        getModelDisplayName: (modelId: string | undefined) => string;
        /** Whether the message has visible content (affects assistant avatar vs spacer) */
        hasContent: boolean;
    }

    let {
        role,
        isConsecutive,
        username,
        model,
        modelProvider,
        getModelDisplayName,
        hasContent,
    }: Props = $props();
</script>

<div class="flex flex-row items-end shrink-0 mt-0.5 font-sans {isConsecutive ? 'invisible' : ''}">
    {#if role === "user"}
        <div class="flex flex-col items-center gap-0.5">
            {#if username}
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span
                                class="text-[10px] text-muted-foreground leading-none max-w-[4.5rem] truncate block overflow-hidden text-ellipsis whitespace-nowrap"
                            >
                                {username}
                            </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" class="text-xs">
                            {username}
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            {/if}
            <div
                class="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
                <User class="size-4" />
            </div>
        </div>
    {:else if model || modelProvider || hasContent}
        <!-- Normal assistant message with avatar -->
        <div class="flex flex-col items-center gap-0.5">
            {#if model || modelProvider}
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span
                                class="text-[10px] text-muted-foreground leading-none max-w-18 truncate block overflow-hidden text-ellipsis whitespace-nowrap"
                            >
                                {getModelDisplayName(model)}
                            </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" class="text-xs">
                            {getModelDisplayName(model)}
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            {:else}
                <!-- Invisible spacer for alignment when no model name -->
                <span class="invisible text-[10px] leading-none max-w-18">&nbsp;</span>
            {/if}
            <div
                class="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
                <Bot class="size-4" />
            </div>
        </div>
    {:else}
        <!-- Tool-only message: use invisible spacer for alignment -->
        <div class="flex flex-col items-center gap-0.5 w-18">
            <!-- Match height of model name + gap + avatar -->
            <span class="invisible text-[10px] leading-none">&nbsp;</span>
            <div class="size-8"></div>
        </div>
    {/if}
</div>
