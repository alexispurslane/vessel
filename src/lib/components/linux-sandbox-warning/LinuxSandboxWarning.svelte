<script lang="ts">
    /**
     * @file Dismissible warning banner shown on Linux about Zerobox sandbox issues.
     *
     * On first visit to a Vessel instance running on Linux, this banner warns
     * the user that the Zerobox sandbox runtime does not work properly on Linux
     * due to a known upstream bug, and that all sandboxing and permissions are
     * disabled. The warning can be dismissed and the dismissal is persisted in
     * localStorage so it only shows once per browser.
     */
    import { onMount } from "svelte";
    import { Alert, AlertTitle, AlertDescription } from "$lib/components/ui/alert/index.js";
    import AlertTriangle from "@lucide/svelte/icons/alert-triangle";

    /** Whether the server is running on Linux (passed from layout). */
    interface Props {
        isLinux: boolean;
    }

    let { isLinux }: Props = $props();

    const STORAGE_KEY = "vessel:linux-sandbox-warning-dismissed";

    let dismissed = $state(false);

    onMount(() => {
        if (isLinux && localStorage.getItem(STORAGE_KEY) === "true") {
            dismissed = true;
        }
    });

    function handleDismiss() {
        dismissed = true;
        localStorage.setItem(STORAGE_KEY, "true");
    }
</script>

{#if isLinux && !dismissed}
    <div class="px-4 pt-3">
        <Alert variant="destructive">
            <AlertTriangle class="size-4" />
            <AlertTitle>Sandboxing disabled on Linux</AlertTitle>
            <AlertDescription>
                Due to a known upstream bug, the Zerobox sandbox runtime does not work properly on
                Linux yet. All sandboxing and permissions are disabled — agent tools run without
                isolation. Do not expose this instance to untrusted networks.
            </AlertDescription>
            <button
                onclick={handleDismiss}
                class="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Dismiss warning"
            >
                &times;
            </button>
        </Alert>
    </div>
{/if}
