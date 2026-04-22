<script lang="ts">
    /**
     * A circular progress ring showing context window usage.
     * Shows percentage text in the center and fills the ring proportionally.
     * Changes color as usage increases: green -> yellow -> orange -> red.
     */
    interface Props {
        /** Usage as a fraction 0–1 */
        fraction: number;
        /** Size of the ring in px */
        size?: number;
        /** Stroke width in px */
        strokeWidth?: number;
    }

    let { fraction, size = 24, strokeWidth = 2.5 }: Props = $props();

    // Derived values
    let radius = $derived((size - strokeWidth) / 2);
    let circumference = $derived(2 * Math.PI * radius);
    let offset = $derived(circumference * (1 - Math.min(Math.max(fraction, 0), 1)));
    let percent = $derived(Math.round(Math.min(Math.max(fraction, 0), 1) * 100));

    // Color based on usage level
    let ringColor = $derived.by(() => {
        if (fraction < 0.5) return "var(--color-chart-2)"; // green-ish
        if (fraction < 0.75) return "var(--color-chart-1)"; // yellow-ish
        if (fraction < 0.9) return "var(--color-chart-4)"; // orange-ish
        return "var(--color-chart-5)"; // red-ish
    });
</script>

<svg
    width={size}
    height={size}
    viewBox="0 0 {size} {size}"
    class="shrink-0"
    role="img"
    aria-label="{percent}% context window used"
>
    <!-- Background track -->
    <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        stroke-width={strokeWidth}
        class="text-muted-foreground/20"
    />
    <!-- Progress arc -->
    <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={ringColor}
        stroke-width={strokeWidth}
        stroke-linecap="round"
        stroke-dasharray={circumference}
        stroke-dashoffset={offset}
        transform="rotate(-90 {size / 2} {size / 2})"
        style="transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;"
    />
    <!-- Percentage text -->
    <text
        x={size / 2}
        y={size / 2}
        text-anchor="middle"
        dominant-baseline="central"
        class="fill-current text-muted-foreground"
        style="font-size: {size * 0.38}px; font-weight: 600;"
    >
        {percent}
    </text>
</svg>
