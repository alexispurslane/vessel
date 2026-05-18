<script lang="ts">
    interface Option {
        value: unknown;
        label: string;
    }

    interface Props {
        value: unknown;
        options: Option[];
        onChange: (value: unknown) => void;
        /** Whether the toggle is disabled (no interaction, dimmed appearance). */
        disabled?: boolean;
    }

    let { value, options, onChange, disabled = false }: Props = $props();
</script>

<div class="flex gap-1.5">
    {#each options as option}
        <button
            class="px-2.5 py-1 text-xs rounded-md border transition-colors {value === option.value
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted'} {disabled ? 'opacity-50 cursor-not-allowed' : ''}"
            onclick={() => {
                if (!disabled) onChange(option.value);
            }}
            {disabled}
        >
            {option.label}
        </button>
    {/each}
</div>
