<!--
    @file Drop zone wrapper that adds drag-and-drop file upload support with
    visual feedback. Dropped files are added directly to the pending files list.
-->
<script lang="ts">
    import Upload from "@lucide/svelte/icons/upload";

    interface PendingFile {
        file: File;
        id: string;
    }

    interface Props {
        /** Pending files list (two-way bindable) — dropped files are appended here */
        pendingFiles?: PendingFile[];
        /** The slotted content to wrap with the drop zone */
        children: import("svelte").Snippet;
    }

    let { pendingFiles = $bindable<PendingFile[]>([]), children }: Props = $props();

    /** Number of active drag-over events (browsers fire enter/leave for child elements). */
    let dragCounter = $state(0);

    /** Whether a drag operation is currently hovering over this zone. */
    let isDragging = $derived(dragCounter > 0);

    function handleDragEnter(e: DragEvent) {
        e.preventDefault();
        dragCounter++;
    }

    function handleDragOver(e: DragEvent) {
        e.preventDefault();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = "copy";
        }
    }

    function handleDragLeave() {
        dragCounter--;
    }

    function handleDrop(e: DragEvent) {
        e.preventDefault();
        dragCounter = 0;

        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;

        for (const file of files) {
            pendingFiles = [
                ...pendingFiles,
                {
                    file,
                    id: `${file.name}-${String(Date.now())}-${crypto.randomUUID().slice(0, 8)}`,
                },
            ];
        }
    }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="contents"
    ondragenter={handleDragEnter}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
>
    {@render children()}

    {#if isDragging}
        <div
            class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-none"
            role="presentation"
        >
            <div
                class="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-primary/60 bg-primary/5 px-8 py-6 text-primary"
            >
                <Upload class="size-8 opacity-70" />
                <span class="text-sm font-medium">Drop files here</span>
                <span class="text-xs text-muted-foreground"
                    >Files will be added to your message</span
                >
            </div>
        </div>
    {/if}
</div>
