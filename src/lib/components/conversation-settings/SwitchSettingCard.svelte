<script lang="ts">
    import { Switch } from "$lib/components/ui/switch/index.js";
    import { Label } from "$lib/components/ui/label/index.js";

    interface Props {
        label: string;
        description?: string;
        statusText?: string;
        enabled: boolean;
        onToggle: (v: boolean) => void;
        children?: import("svelte").Snippet;
    }

    let { label, description, statusText, enabled, onToggle, children }: Props = $props();
</script>

<div class="rounded-lg border p-3 space-y-2">
    <div class="flex items-center justify-between">
        <div>
            <Label class="text-sm font-medium">{label}</Label>
            {#if description}
                <p class="text-xs text-muted-foreground mt-0.5">{description}</p>
            {:else if statusText}
                <p class="text-xs text-muted-foreground mt-0.5">{statusText}</p>
            {/if}
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} />
    </div>
    {#if enabled && children}
        {@render children()}
    {/if}
</div>
