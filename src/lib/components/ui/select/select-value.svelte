<script lang="ts">
    import { Select as SelectPrimitive } from "bits-ui";
    import { cn } from "$lib/utils.js";

    let {
        ref = $bindable(null),
        class: className,
        placeholder,
        ...restProps
    }: SelectPrimitive.ValueProps & { placeholder?: string } = $props();
</script>

<SelectPrimitive.Value
    bind:ref
    data-slot="select-value"
    class={cn("text-sm", className)}
    {...restProps}
>
    {#snippet children({ selection })}
        {#if selection?.type === "single" && selection.selected}
            {selection.selected.label || selection.selected.value}
        {:else}
            {placeholder || ""}
        {/if}
    {/snippet}
</SelectPrimitive.Value>
