<script lang="ts">
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import { useSidebar } from "./context.svelte.js";
    import { SIDEBAR_WIDTH_DEFAULT_PX } from "./constants.js";

    let {
        ref = $bindable(null),
        class: className,
        children,
        ...restProps
    }: WithElementRef<HTMLAttributes<HTMLButtonElement>, HTMLButtonElement> = $props();

    const sidebar = useSidebar();

    // Resize state
    let isResizing = $state(false);
    let startX = 0;
    let startWidth = 0;
    let didDrag = false;
    const DRAG_THRESHOLD = 3;

    // Prevent text selection on the body during resize
    $effect(() => {
        if (isResizing) {
            document.body.style.userSelect = "none";
            document.body.style.cursor = "col-resize";
        } else {
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
        }
        return () => {
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
        };
    });

    function handleMouseDown(e: MouseEvent) {
        // Only handle left-click on the rail itself
        if (e.button !== 0) return;
        e.preventDefault();
        isResizing = true;
        didDrag = false;
        startX = e.clientX;
        startWidth = sidebar.width;
        sidebar.setResizing(true);

        // Add listeners to window so we track movement even outside the rail
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
    }

    function handleMouseMove(e: MouseEvent) {
        if (!isResizing) return;
        const delta = e.clientX - startX;
        if (Math.abs(delta) > DRAG_THRESHOLD) {
            didDrag = true;
        }
        sidebar.setWidth(startWidth + delta);
    }

    function handleMouseUp() {
        isResizing = false;
        sidebar.setResizing(false);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
    }

    // Double-click to reset to default width
    function handleDoubleClick() {
        sidebar.setWidth(SIDEBAR_WIDTH_DEFAULT_PX);
    }

    // Click (not drag) to toggle sidebar
    function handleClick(e: MouseEvent) {
        if (!didDrag) {
            sidebar.toggle();
        }
        didDrag = false;
    }
</script>

<button
    bind:this={ref}
    data-sidebar="rail"
    data-slot="sidebar-rail"
    aria-label="Toggle Sidebar"
    tabindex={-1}
    onclick={handleClick}
    ondblclick={handleDoubleClick}
    onmousedown={handleMouseDown}
    title="Toggle Sidebar"
    class={cn(
        "hover:after:bg-sidebar-border absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] sm:flex",
        "in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        isResizing && "select-none",
        className
    )}
    {...restProps}
>
    {@render children?.()}
</button>
