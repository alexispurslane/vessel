<script lang="ts">
    /**
     * @file ARIA live region for announcing chat events to screen readers.
     *
     * Place a single instance of this component at the top level of the chat
     * view. It renders a visually-hidden `aria-live="polite"` region that
     * screen readers will announce whenever its text content changes.
     */
    interface Props {
        /** The announcement text — changes are spoken by the screen reader */
        announcement: string;
    }

    let { announcement }: Props = $props();
</script>

<div class="sr-only" aria-live="polite" aria-atomic="true">
    {announcement}
</div>
