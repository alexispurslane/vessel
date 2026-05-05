<script lang="ts">
    import { SidebarMenuItem, SidebarMenuButton } from "$lib/components/ui/sidebar/index.js";
    import {
        ContextMenu,
        ContextMenuContent,
        ContextMenuItem,
        ContextMenuTrigger,
        ContextMenuSeparator,
    } from "$lib/components/ui/context-menu";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import MessageSquare from "@lucide/svelte/icons/message-square";
    import Trash2 from "@lucide/svelte/icons/trash-2";
    import Pencil from "@lucide/svelte/icons/pencil";
    import Tag from "@lucide/svelte/icons/tag";
    import Sparkles from "@lucide/svelte/icons/sparkles";
    import Pin from "@lucide/svelte/icons/pin";
    import PinOff from "@lucide/svelte/icons/pin-off";
    import { hashHue } from "$lib/utils.js";
    import { resolve } from "$app/paths";

    interface Conversation {
        id: string;
        title: string;
        tags: string[];
        pinned: boolean;
    }

    let {
        conv,
        isActive,
        generatingTitle,
        hasDraft = false,
        onSelect,
        onDelete,
        onRename,
        onTag,
        onGenerateTitle,
        onPin,
    }: {
        conv: Conversation;
        isActive: boolean;
        generatingTitle: boolean;
        hasDraft?: boolean;
        onSelect: (id: string) => void;
        onDelete: (id: string, e: MouseEvent) => void;
        onRename: (id: string) => void;
        onTag: (id: string) => void;
        onGenerateTitle: (id: string) => void;
        onPin: (id: string, pinned: boolean) => void;
    } = $props();
</script>

<SidebarMenuItem>
    <ContextMenu>
        <ContextMenuTrigger>
            <SidebarMenuButton
                {isActive}
                onclick={() => {
                    onSelect(conv.id);
                }}
                class="group h-12"
            >
                <MessageSquare class="shrink-0" />
                <div class="flex-1 min-w-0 flex flex-col">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <span class="truncate">{conv.title}</span>
                        {#if hasDraft}
                            <Badge
                                variant="outline"
                                class="shrink-0 text-[9px] h-4 px-1 leading-none gap-0.5"
                                >Draft</Badge
                            >
                        {/if}
                    </div>
                    {#if conv.tags.length > 0}
                        <div class="flex gap-1 mt-1 pb-1 overflow-x-auto no-scrollbar">
                            {#each conv.tags as tag (tag)}
                                <a
                                    href={resolve(`/tags/${tag}`)}
                                    class="tag-pill-colors inline-flex items-center justify-center h-3.5 px-1 rounded-full text-[8px] leading-none font-medium whitespace-nowrap cursor-pointer hover:opacity-80 transition-opacity shrink-0"
                                    style="--tag-hue: {hashHue(tag)}"
                                    onclick={(e) => {
                                        e.stopPropagation();
                                    }}
                                >
                                    {tag}
                                </a>
                            {/each}
                        </div>
                    {/if}
                </div>
                <div
                    class="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    <button
                        class="p-0.5 hover:text-foreground"
                        onclick={(e) => {
                            e.stopPropagation();
                            onPin(conv.id, !conv.pinned);
                        }}
                        aria-label={conv.pinned ? "Unpin conversation" : "Pin conversation"}
                        title={conv.pinned ? "Unpin conversation" : "Pin conversation"}
                    >
                        {#if conv.pinned}
                            <Pin class="h-3.5 w-3.5 text-foreground" />
                        {:else}
                            <Pin class="h-3.5 w-3.5" />
                        {/if}
                    </button>
                    <button
                        class="p-0.5 hover:text-destructive"
                        onclick={(e) => {
                            onDelete(conv.id, e);
                        }}
                        aria-label="Delete conversation"
                    >
                        <Trash2 class="h-3.5 w-3.5" />
                    </button>
                </div>
            </SidebarMenuButton>
        </ContextMenuTrigger>
        <ContextMenuContent>
            <ContextMenuItem
                onclick={() => {
                    onPin(conv.id, !conv.pinned);
                }}
            >
                {#if conv.pinned}
                    <PinOff class="mr-2 h-4 w-4" />
                    Unpin
                {:else}
                    <Pin class="mr-2 h-4 w-4" />
                    Pin
                {/if}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
                onclick={() => {
                    onRename(conv.id);
                }}
            >
                <Pencil class="mr-2 h-4 w-4" />
                Rename
            </ContextMenuItem>
            <ContextMenuItem
                onclick={() => {
                    onTag(conv.id);
                }}
            >
                <Tag class="mr-2 h-4 w-4" />
                Edit Tags
            </ContextMenuItem>
            <ContextMenuItem
                onclick={() => {
                    onGenerateTitle(conv.id);
                }}
                disabled={generatingTitle}
            >
                <Sparkles class="mr-2 h-4 w-4" />
                {generatingTitle ? "Generating..." : "Generate New Title"}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
                onclick={() => {
                    onDelete(conv.id, new MouseEvent("click"));
                }}
                class="text-destructive focus:text-destructive"
            >
                <Trash2 class="mr-2 h-4 w-4" />
                Delete
            </ContextMenuItem>
        </ContextMenuContent>
    </ContextMenu>
</SidebarMenuItem>
