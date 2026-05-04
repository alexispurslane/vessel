<script lang="ts">
    import { Label } from "$lib/components/ui/label/index.js";

    interface Props {
        label: string;
        description?: string;
        class?: string;
        children: import("svelte").Snippet;
    }

    let { label, description, class: className = "", children }: Props = $props();
</script>

<div class="rounded-lg border p-3 {className}">
    <div class="space-y-2">
        <div>
            <Label class="text-sm font-medium">{label}</Label>
            {#if description}
                <p class="text-xs text-muted-foreground mt-0.5">{description}</p>
            {/if}
        </div>
        {@render children()}
    </div>
</div>
