<script lang="ts">
    import * as Tooltip from "$lib/components/ui/tooltip/index.js";
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import {
        SIDEBAR_COOKIE_MAX_AGE,
        SIDEBAR_COOKIE_NAME,
        SIDEBAR_WIDTH_ICON,
    } from "./constants.js";
    import { setSidebar } from "./context.svelte.js";

    let {
        ref = $bindable(null),
        open = $bindable(true),
        onOpenChange = () => {},
        class: className,
        style,
        children,
        ...restProps
    }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
        open?: boolean;
        onOpenChange?: (open: boolean) => void;
    } = $props();

    const sidebar = setSidebar({
        open: () => open,
        setOpen: (value: boolean) => {
            open = value;
            onOpenChange(value);

            // This sets the cookie to keep the sidebar state.
            document.cookie = `${SIDEBAR_COOKIE_NAME}=${String(open)}; path=/; max-age=${String(SIDEBAR_COOKIE_MAX_AGE)}`;
        },
    });

    // Reactive style string that includes the dynamic sidebar width
    let computedStyle = $derived(
        `--sidebar-width: ${String(sidebar.width)}px; --sidebar-width-icon: ${String(SIDEBAR_WIDTH_ICON)}; ${style ?? ""}`
    );
</script>

<svelte:window onkeydown={sidebar.handleShortcutKeydown} />

<Tooltip.Provider delayDuration={0}>
    <div
        data-slot="sidebar-wrapper"
        style={computedStyle}
        class={cn(
            "group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full",
            className
        )}
        bind:this={ref}
        {...restProps}
    >
        {@render children?.()}
    </div>
</Tooltip.Provider>
