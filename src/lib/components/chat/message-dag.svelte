<script lang="ts">
    import type { SessionTreeNodeData } from "$lib/api.js";
    import GitBranch from "@lucide/svelte/icons/git-branch";

    interface Props {
        /** All nodes in the session tree */
        nodes: SessionTreeNodeData[];
        /** Current leaf ID */
        leafId: string | null;
        /** Callback when user clicks a node to navigate there */
        onnavigateto?: (entryId: string) => void;
        /** Whether a navigation operation is in progress */
        navigating?: boolean;
    }

    let {
        nodes,
        leafId,
        onnavigateto,
        navigating = false,
    }: Props = $props();

    // Only show message entries (user + assistant).
    // The server already excludes: non-message types (model_change, compaction, etc.),
    // toolResult messages, thinking-only assistant intermediates, and empty user messages.
    const messageNodes = $derived(nodes.filter((n) => n.type === "message"));

    // Build a children map from the filtered nodes
    // We need to reconstruct parent-child relationships considering only message nodes.
    // A message's "visual parent" is the nearest ancestor message node, not necessarily its direct parentId in the full tree.
    const childrenMap = $derived(() => {
        const nodeById = new Map(messageNodes.map((n) => [n.id, n]));
        const result = new Map<string, SessionTreeNodeData[]>();

        for (const node of messageNodes) {
            if (!node.parentId) continue;
            // Walk up the full tree until we find a parent that's also a message node
            let ancestorId: string | null = node.parentId;
            let visualParent: SessionTreeNodeData | undefined;
            while (ancestorId) {
                visualParent = nodeById.get(ancestorId);
                if (visualParent) break;
                // Look up the ancestor in the full node list to get ITS parent
                const ancestorInFull = nodes.find((n) => n.id === ancestorId);
                ancestorId = ancestorInFull?.parentId ?? null;
            }
            if (visualParent) {
                const children = result.get(visualParent.id) ?? [];
                children.push(node);
                result.set(visualParent.id, children);
            }
        }
        return result;
    });

    // Root nodes: message nodes with no visual parent message
    const rootNodes = $derived(() => {
        const nodeById = new Map(messageNodes.map((n) => [n.id, n]));
        return messageNodes.filter((n) => {
            if (!n.parentId) return true;
            // Walk up: if no ancestor is a message node, this is a visual root
            let ancestorId: string | null = n.parentId;
            while (ancestorId) {
                if (nodeById.has(ancestorId)) return false;
                const ancestorInFull = nodes.find((n) => n.id === ancestorId);
                ancestorId = ancestorInFull?.parentId ?? null;
            }
            return true;
        });
    });

    // Active branch IDs
    const activeBranchIds = $derived(new Set(messageNodes.filter((n) => n.onActiveBranch).map((n) => n.id)));

    // Hovered node for tooltip
    let hoveredId = $state<string | null>(null);
    const hoveredNode = $derived(hoveredId ? messageNodes.find((n) => n.id === hoveredId) : null);
</script>

<div class="flex flex-col h-full">
    <!-- Header -->
    <div class="flex items-center gap-1.5 px-3 py-2 border-b text-muted-foreground">
        <GitBranch class="size-3.5" />
        <span class="font-medium text-xs">History</span>
    </div>

    <!-- Tree -->
    <div class="flex-1 min-h-0 overflow-auto px-1 py-2">
        {#if rootNodes().length > 0}
            {#each rootNodes() as root}
                {@render treeNode(root, false)}
            {/each}
        {:else}
            <p class="text-muted-foreground text-xs italic px-2">No messages yet</p>
        {/if}
    </div>

    <!-- Hover tooltip -->
    {#if hoveredNode}
        <div class="border-t px-3 py-2 bg-background max-h-40 overflow-auto">
            <p class="text-[10px] font-medium text-muted-foreground mb-0.5">
                {hoveredNode.role === "user" ? "User" : "Assistant"}
            </p>
            <p class="text-xs whitespace-pre-wrap wrap-break-word">
                {hoveredNode.fullContent}
            </p>
        </div>
    {/if}

    <!-- Navigation indicator -->
    {#if navigating}
        <div class="border-t px-3 py-1.5 bg-muted/50 text-xs text-muted-foreground flex items-center gap-1.5">
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Navigating...
        </div>
    {/if}
</div>

{#snippet treeNode(node: SessionTreeNodeData, isLast: boolean)}
    {@const children = childrenMap().get(node.id) ?? []}
    {@const isActive = activeBranchIds.has(node.id)}
    {@const isLeaf = node.id === leafId}
    {@const isHovered = hoveredId === node.id}
    {@const isUser = node.role === "user"}

    <div class="group/dagnode">
        <!-- Node row -->
        {#if isUser}
            <div
                class="w-full text-left flex items-center gap-1.5 px-2 py-1 rounded-sm text-[11px]
                    {isLeaf ? 'bg-primary/15 ring-1 ring-primary/40' : isActive ? 'bg-primary/5' : ''}
                    {isHovered ? 'bg-muted' : ''}"
                onmouseenter={() => (hoveredId = node.id)}
                onmouseleave={() => (hoveredId = null)}
            >
                <!-- Role dot -->
                <span class="shrink-0 size-2 rounded-full bg-primary"></span>

                <!-- Preview text -->
                <span class="truncate {isActive ? 'text-foreground' : 'text-muted-foreground'}">
                    {node.preview || '(empty)'}
                </span>
            </div>
        {:else}
            <button
                class="w-full text-left flex items-center gap-1.5 px-2 py-1 rounded-sm text-[11px] transition-colors cursor-pointer
                    {isLeaf ? 'bg-primary/15 ring-1 ring-primary/40' : isActive ? 'bg-primary/5' : 'hover:bg-muted/60'}
                    {isHovered ? 'bg-muted' : ''}"
                onclick={() => onnavigateto?.(node.id)}
                disabled={navigating}
                onmouseenter={() => (hoveredId = node.id)}
                onmouseleave={() => (hoveredId = null)}
            >
                <!-- Role dot -->
                <span class="shrink-0 size-2 rounded-full bg-foreground/40"></span>

                <!-- Preview text -->
                <span class="truncate {isActive ? 'text-foreground' : 'text-muted-foreground'}">
                    {node.preview || '(empty)'}
                </span>
            </button>
        {/if}

        <!-- Children -->
        {#if children.length > 0}
            <div class="ml-3 border-l border-border/50">
                {#each children as child, i}
                    {@render treeNode(child, i === children.length - 1)}
                {/each}
            </div>
        {/if}
    </div>
{/snippet}
