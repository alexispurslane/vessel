<script lang="ts">
    import { useSidebar } from "$lib/components/ui/sidebar/index.js";

    let { children }: { children: import("svelte").Snippet } = $props();

    const sidebar = useSidebar();

    let touchStartX = 0;
    let touchStartY = 0;

    /**
     * Records the starting touch position for swipe detection.
     *
     * @param e - The touchstart event.
     */
    function handleTouchStart(e: TouchEvent) {
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
    }

    /**
     * Opens the sidebar when a rightward edge-swipe is detected on mobile.
     *
     * @param e - The touchend event.
     */
    function handleTouchEnd(e: TouchEvent) {
        if (!sidebar.isMobile) return;
        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = Math.abs(touch.clientY - touchStartY);
        // Edge-swipe: start near left edge, move right, mostly horizontal
        if (touchStartX < 20 && deltaX > 80 && deltaY < 50) {
            sidebar.setOpenMobile(true);
        }
    }
</script>

<!-- Gesture detection area, not interactive content -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div ontouchstart={handleTouchStart} ontouchend={handleTouchEnd} class="contents">
    {@render children()}
</div>
