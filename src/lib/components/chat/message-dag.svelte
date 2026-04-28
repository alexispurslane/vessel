<script lang="ts">
    import type { SessionTreeNodeData } from "$lib/api.js";
    import { graphStratify, sugiyama, coordSimplex, decrossTwoLayer, layeringLongestPath } from "d3-dag";
    import GitBranch from "@lucide/svelte/icons/git-branch";
    import User from "@lucide/svelte/icons/user";
    import Bot from "@lucide/svelte/icons/bot";

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

    // Only show message entries (user + assistant)
    const messageNodes = $derived(nodes.filter((n) => n.type === "message"));

    // The server repairs parentIds to reference visible ancestors, but as a safety net
    // we also do a client-side pass: any parentId that references a node we're not
    // displaying gets walked up to the nearest visible ancestor (or nulled out).
    const repairedNodes = $derived(() => {
        if (messageNodes.length === 0) return [];

        const visibleById = new Map(messageNodes.map((n) => [n.id, n]));
        // Check if all parentIDs already reference visible nodes (the fast path)
        const allValid = messageNodes.every(
            (n) => !n.parentId || visibleById.has(n.parentId)
        );
        if (allValid) return messageNodes;

        // Slow path: repair any dangling parentIds by walking up via the full node list
        const fullById = new Map(nodes.map((n) => [n.id, n]));
        return messageNodes.map((n) => {
            if (!n.parentId || visibleById.has(n.parentId)) return n;
            let ancestorId: string | null = n.parentId;
            while (ancestorId && !visibleById.has(ancestorId)) {
                const ancestor = fullById.get(ancestorId);
                ancestorId = ancestor?.parentId ?? null;
            }
            return { ...n, parentId: ancestorId ?? null };
        });
    });

    // Active branch IDs
    const activeBranchIds = $derived(new Set(repairedNodes().filter((n) => n.onActiveBranch).map((n) => n.id)));

    // Hovered node
    let hoveredId = $state<string | null>(null);
    const hoveredNode = $derived(hoveredId ? repairedNodes().find((n) => n.id === hoveredId) : null);

    // Layout constants
    const NODE_WIDTH = 220;
    const NODE_HEIGHT = 36;
    const NODE_RX = 6;
    const GAP_X = 24;
    const GAP_Y = 16;
    const ARROW_SIZE = 7;
    const PADDING = 16;

    // Compute node style class based on state
    function nodeStyleClass(isActive: boolean, isLeaf: boolean, isHovered: boolean): string {
        if (isLeaf) return "node-leaf";
        if (isActive) return "node-active";
        if (isHovered) return "node-hovered";
        return "node-default";
    }

    // Compute link style class
    function linkStyleClass(onActiveBranch: boolean): string {
        return onActiveBranch ? "link-active" : "link-inactive";
    }

    // Compute the d3-dag layout
    interface DagNodeData {
        id: string;
        parentIds: string[];
        node: SessionTreeNodeData;
    }

    interface LaidNode {
        id: string;
        x: number;
        y: number;
        node: SessionTreeNodeData;
    }

    interface LaidLink {
        source: { x: number; y: number; id: string };
        target: { x: number; y: number; id: string };
        onActiveBranch: boolean;
    }

    const layoutResult = $derived(() => {
        const visible = repairedNodes();
        if (visible.length === 0) {
            return { nodes: [] as LaidNode[], links: [] as LaidLink[], width: 0, height: 0 };
        }

        // Build stratify data using the already-repaired parentIds
        const stratifyData: DagNodeData[] = visible.map((node) => ({
            id: node.id,
            parentIds: node.parentId ? [node.parentId] : [],
            node,
        }));

        try {
            // d3-dag's default stratify operator expects objects with `id` and `parentIds`
            // Our DagNodeData satisfies HasId & HasParentIds, so defaults work.
            const builder = graphStratify()
                .id((d: DagNodeData) => d.id)
                .parentIds((d: DagNodeData) => d.parentIds);
            const dag = builder(stratifyData as readonly (DagNodeData & { id: string; parentIds: string[] })[]);

            const layout = sugiyama()
                .nodeSize([NODE_WIDTH + GAP_X, NODE_HEIGHT + GAP_Y])
                .coord(coordSimplex())
                .decross(decrossTwoLayer())
                .layering(layeringLongestPath());

            const { width, height } = layout(dag);

            const laidNodes: LaidNode[] = [];
            const laidLinks: LaidLink[] = [];

            for (const dagNode of dag.nodes()) {
                const data = dagNode.data as unknown as DagNodeData;
                laidNodes.push({
                    id: data.id,
                    x: dagNode.x ?? 0,
                    y: dagNode.y ?? 0,
                    node: data.node,
                });
            }

            for (const dagLink of dag.links()) {
                const sourceData = dagLink.source.data as unknown as DagNodeData;
                const targetData = dagLink.target.data as unknown as DagNodeData;
                laidLinks.push({
                    source: {
                        id: sourceData.id,
                        x: dagLink.source.x ?? 0,
                        y: dagLink.source.y ?? 0,
                    },
                    target: {
                        id: targetData.id,
                        x: dagLink.target.x ?? 0,
                        y: dagLink.target.y ?? 0,
                    },
                    onActiveBranch: activeBranchIds.has(sourceData.id) && activeBranchIds.has(targetData.id),
                });
            }

            return { nodes: laidNodes, links: laidLinks, width: width ?? 0, height: height ?? 0 };
        } catch (e) {
            console.error("d3-dag layout failed:", e);
            return { nodes: [] as LaidNode[], links: [] as LaidLink[], width: 0, height: 0 };
        }
    });

    // Generate SVG path for a curved link between two nodes
    function linkPath(link: LaidLink): string {
        const sx = link.source.x;
        const sy = link.source.y + NODE_HEIGHT;
        const tx = link.target.x;
        const ty = link.target.y;
        const midY = (sy + ty) / 2;
        return `M${sx},${sy} C${sx},${midY} ${tx},${midY} ${tx},${ty}`;
    }

    // Generate arrowhead polygon points at the target point
    function arrowPoints(link: LaidLink): string {
        const tx = link.target.x;
        const ty = link.target.y;
        const sx = link.source.x;
        const sy = link.source.y + NODE_HEIGHT;

        const dx = tx - sx;
        const dy = ty - sy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;

        const hw = ARROW_SIZE * 0.55;
        const bl = ARROW_SIZE;
        const bx = tx - ux * bl;
        const by = ty - uy * bl;
        const nx = -uy;
        const ny = ux;

        return `${tx},${ty} ${bx + nx * hw},${by + ny * hw} ${bx - nx * hw},${by - ny * hw}`;
    }

    // Truncate preview text for SVG display
    function truncatePreview(preview: string): string {
        if (!preview) return "(empty)";
        if (preview.length > 28) return preview.slice(0, 28) + "\u2026";
        return preview;
    }
</script>

<div class="flex flex-col h-full">
    <!-- Header -->
    <div class="flex items-center gap-1.5 px-3 py-2 border-b text-muted-foreground">
        <GitBranch class="size-3.5" />
        <span class="font-medium text-xs">History</span>
    </div>

    <!-- DAG SVG -->
    <div class="flex-1 min-h-0 overflow-auto">
        {#if layoutResult().nodes.length > 0}
            {@const result = layoutResult()}
            <svg
                width={result.width + PADDING * 2}
                height={result.height + PADDING * 2}
                viewBox="0 0 {result.width + PADDING * 2} {result.height + PADDING * 2}"
                class="dag-svg block"
                style="min-width: 100%;"
            >
                <g transform="translate({PADDING}, {PADDING})">
                    <!-- Links (arrows) - drawn first so they're behind nodes -->
                    {#each result.links as link}
                        <path
                            d={linkPath(link)}
                            fill="none"
                            class={linkStyleClass(link.onActiveBranch)}
                        />
                        <polygon
                            points={arrowPoints(link)}
                            class={linkStyleClass(link.onActiveBranch) + "-arrow"}
                        />
                    {/each}

                    <!-- Nodes -->
                    {#each result.nodes as laidNode}
                        {@const node = laidNode.node}
                        {@const isActive = activeBranchIds.has(node.id)}
                        {@const isLeaf = node.id === leafId}
                        {@const isHovered = hoveredId === node.id}
                        {@const isUser = node.role === "user"}

                        <g
                            transform="translate({laidNode.x - NODE_WIDTH / 2}, {laidNode.y})"
                            class="dag-node-group"
                            onmouseenter={() => (hoveredId = node.id)}
                            onmouseleave={() => (hoveredId = null)}
                            onclick={() => onnavigateto?.(node.id)}
                            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onnavigateto?.(node.id); }}
                            role="button"
                            tabindex="0"
                            aria-label="{isUser ? 'User' : 'Assistant'}: {node.preview}"
                        >
                            <!-- Box -->
                            <rect
                                x="0"
                                y="0"
                                width={NODE_WIDTH}
                                height={NODE_HEIGHT}
                                rx={NODE_RX}
                                ry={NODE_RX}
                                class={nodeStyleClass(isActive, isLeaf, isHovered)}
                            />

                            <!-- Role icon -->
                            <foreignObject x="4" y={(NODE_HEIGHT - 20) / 2} width="20" height="20">
                                <div class="dag-icon-wrap {isUser ? 'icon-user' : 'icon-assistant'}" xmlns="http://www.w3.org/1999/xhtml">
                                    {#if isUser}
                                        <User class="size-3.5" />
                                    {:else}
                                        <Bot class="size-3.5" />
                                    {/if}
                                </div>
                            </foreignObject>

                            <!-- Preview text -->
                            <text
                                x="30"
                                y={NODE_HEIGHT / 2}
                                dominant-baseline="central"
                                class="dag-text {isActive || isLeaf ? 'text-active' : 'text-inactive'}"
                            >
                                {truncatePreview(node.preview)}
                            </text>
                        </g>
                    {/each}
                </g>
            </svg>
        {:else}
            <p class="text-muted-foreground text-xs italic px-3 py-4">No messages yet</p>
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
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
            Navigating...
        </div>
    {/if}
</div>

<style>
    /* SVG link styles */
    .link-active {
        stroke: var(--primary);
        stroke-width: 2;
        opacity: 1;
    }
    .link-inactive {
        stroke: var(--muted-foreground);
        stroke-width: 1.5;
        opacity: 0.55;
        stroke-dasharray: 4 2;
    }
    .link-active-arrow {
        fill: var(--primary);
        opacity: 1;
    }
    .link-inactive-arrow {
        fill: var(--muted-foreground);
        opacity: 0.55;
    }

    /* SVG node box styles */
    .node-leaf {
        fill: color-mix(in oklch, var(--primary) 15%, transparent);
        stroke: color-mix(in oklch, var(--primary) 50%, transparent);
        stroke-width: 2;
    }
    .node-active {
        fill: color-mix(in oklch, var(--primary) 5%, transparent);
        stroke: color-mix(in oklch, var(--primary) 20%, transparent);
        stroke-width: 1;
    }
    .node-hovered {
        fill: var(--muted);
        stroke: var(--border);
        stroke-width: 1;
    }
    .node-default {
        fill: var(--card);
        stroke: var(--border);
        stroke-width: 1;
    }

    /* Role icons */
    .dag-icon-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
    }
    .icon-user {
        color: var(--primary-foreground);
        background: var(--primary);
        border-radius: 50%;
        width: 20px;
        height: 20px;
    }
    .icon-assistant {
        color: var(--muted-foreground);
        background: var(--muted);
        border-radius: 50%;
        width: 20px;
        height: 20px;
    }

    /* Text */
    .dag-text {
        font-size: 11px;
    }
    .text-active {
        fill: var(--foreground);
    }
    .text-inactive {
        fill: var(--muted-foreground);
    }

    /* Node group cursor */
    .dag-node-group {
        cursor: pointer;
    }

    /* SVG container */
    .dag-svg {
        font-family: var(--font-sans);
    }
</style>
