<script lang="ts">
    /**
     * Canvas panel component — manages canvas file state and renders
     * collaborative CodeMirror editors for all canvas-ized files.
     *
     * Each canvas file is shown as a collapsible section with a file
     * header. When expanded, the CodeMirror editor is rendered for
     * that file.
     *
     * @param conversationId - The conversation this panel belongs to
     * @param canvasFiles - Set of workspace-relative file paths that are canvas-ized
     * @param onclose - Callback when the user closes the canvas panel entirely
     */
    import { onMount, onDestroy, untrack } from "svelte";
    import CanvasEditor from "./CanvasEditor.svelte";
    import { getCanvasUpdates } from "$lib/api.js";
    import { getChat } from "$lib/stores/chat.svelte.js";
    import type { CanvasUpdateEvent } from "$lib/types/canvas.js";
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import ChevronRight from "@lucide/svelte/icons/chevron-right";
    import FileCode from "@lucide/svelte/icons/file-code";
    import X from "@lucide/svelte/icons/x";

    interface Props {
        /** The conversation this panel belongs to */
        conversationId: string;
        /** Set of workspace-relative file paths that are canvas-ized */
        canvasFiles: Set<string>;
        /** Callback when the user closes the canvas panel entirely */
        onclose?: () => void;
    }

    let { conversationId, canvasFiles, onclose }: Props = $props();

    /** Canvas file data with content and version */
    interface CanvasEntry {
        filePath: string;
        content: string;
        version: number;
        /** Whether this section is expanded */
        expanded: boolean;
        /** Whether content is still loading */
        loading: boolean;
    }

    /**
     * Reactive array of canvas entries. This is the single source of
     * truth that the template iterates. It depends on BOTH canvasFiles
     * (from the parent) and the entries' mutable state (loading,
     * expanded, etc.) so any change causes a re-render.
     */
    let entries: CanvasEntry[] = $state([]);

    /** Set of filePaths currently being loaded (prevents duplicate loads) */
    const loadingSet = new Set<string>();

    /** Registered receivers for canvas_update SSE events */
    const canvasReceivers = new Map<string, (event: CanvasUpdateEvent) => void>();

    /**
     * Snapshot of current file paths from canvasFiles.
     * Used by the sync effect to avoid reading entries (which would
     * create a read-write dependency cycle).
     */
    let currentFilePaths: string[] = $derived([...canvasFiles]);

    /**
     * Sync the entries array with canvasFiles. Adds entries for
     * new files and removes entries for files no longer tracked.
     * Only depends on currentFilePaths (derived from canvasFiles),
     * not on entries itself.
     */
    $effect(() => {
        const pathsSet = new Set(currentFilePaths);

        untrack(() => {
            // Add entries for new canvas files
            const existingPaths = new Set(entries.map((e) => e.filePath));
            for (const filePath of pathsSet) {
                if (!existingPaths.has(filePath)) {
                    entries.push({
                        filePath,
                        content: "",
                        version: 0,
                        expanded: false,
                        loading: true,
                    });
                    if (!loadingSet.has(filePath)) {
                        loadingSet.add(filePath);
                        void loadCanvasContent(filePath);
                    }
                }
            }

            // Remove entries for files no longer canvas-ized
            for (let i = entries.length - 1; i >= 0; i--) {
                if (!pathsSet.has(entries[i].filePath)) {
                    loadingSet.delete(entries[i].filePath);
                    canvasReceivers.delete(entries[i].filePath);
                    entries.splice(i, 1);
                }
            }
        });
    });

    /**
     * Load canvas file content and version from the server.
     *
     * @param filePath - The workspace-relative file path
     */
    async function loadCanvasContent(filePath: string): Promise<void> {
        try {
            // Fetch content via the workspace download API
            const downloadUrl = `/api/sessions/${conversationId}/workspace/download?path=${encodeURIComponent(filePath)}`;
            let content = "";
            try {
                const response = await fetch(downloadUrl);
                content = await response.text();
            } catch {
                // Fall through with empty content
            }

            // Fetch the current version from the server
            let serverVersion = 0;
            try {
                const result = await getCanvasUpdates(conversationId, filePath, 0);
                serverVersion = result.version;
            } catch {
                // If we can't reach the server, use version 0
            }

            // Update the entry in the array
            const entry = entries.find((e) => e.filePath === filePath);
            if (entry) {
                entry.content = content;
                entry.version = serverVersion;
                entry.loading = false;
            }
        } catch {
            const entry = entries.find((e) => e.filePath === filePath);
            if (entry) {
                entry.loading = false;
            }
        } finally {
            loadingSet.delete(filePath);
        }
    }

    /**
     * Toggle a canvas file section's expanded state.
     *
     * @param filePath - The workspace-relative file path
     */
    function toggleExpanded(filePath: string): void {
        const entry = entries.find((e) => e.filePath === filePath);
        if (entry) {
            entry.expanded = !entry.expanded;
        }
    }

    /**
     * Update the version of a canvas file.
     * Called by CanvasEditor when the version changes (push or remote update).
     *
     * @param filePath - The workspace-relative file path
     * @param version - The new document version
     */
    function updateCanvasVersion(filePath: string, version: number): void {
        const entry = entries.find((e) => e.filePath === filePath);
        if (entry) {
            entry.version = version;
        }
    }

    /**
     * Register a receiver for canvas_update SSE events from a specific file.
     * Called by CanvasEditor when it mounts.
     *
     * @param filePath - The file path this receiver handles
     * @param receiver - The receiver function
     */
    function registerCanvasReceiver(
        filePath: string,
        receiver: (event: CanvasUpdateEvent) => void
    ): void {
        canvasReceivers.set(filePath, receiver);
    }

    /**
     * Handle a canvas_update SSE event.
     * Dispatches to the correct canvas receiver based on filePath.
     *
     * @param event - The canvas update event
     */
    function handleCanvasUpdate(event: CanvasUpdateEvent): void {
        const receiver = canvasReceivers.get(event.filePath);
        if (receiver) {
            receiver(event);
        }
        // Keep entries version in sync even for non-expanded files
        updateCanvasVersion(event.filePath, event.version);
    }

    /**
     * Open a specific canvas file and expand it.
     * Called by the parent when the user triggers canvas editing.
     *
     * @param filePath - The workspace-relative file path
     * @param content - The initial file content
     * @param version - The initial document version
     */
    export function openFile(filePath: string, content: string, version: number = 0): void {
        const entry = entries.find((e) => e.filePath === filePath);
        if (entry) {
            entry.content = content;
            entry.version = version;
            entry.expanded = true;
            entry.loading = false;
        } else {
            entries.push({
                filePath,
                content,
                version,
                expanded: true,
                loading: false,
            });
        }
    }

    const chat = getChat();

    // Register/unregister with the chat store's canvas_update SSE listener system
    onMount(() => {
        chat.registerCanvasUpdateListener(handleCanvasUpdate);
    });

    onDestroy(() => {
        chat.unregisterCanvasUpdateListener(handleCanvasUpdate);
    });
</script>

<div class="flex flex-col h-full bg-background pt-9">
    <!-- Panel header -->
    <div class="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <FileCode class="size-3.5 text-muted-foreground" />
        <span class="text-sm font-medium">Canvas</span>
        <div class="flex-1"></div>
        {#if onclose}
            <button
                class="hover:text-foreground transition-colors cursor-pointer p-1 rounded hover:bg-muted"
                onclick={onclose}
                aria-label="Close canvas panel"
            >
                <X class="size-3.5" />
            </button>
        {/if}
    </div>

    <!-- Canvas file list -->
    <div class="flex-1 min-h-0 overflow-auto">
        {#if entries.length === 0}
            <div class="flex items-center justify-center text-muted-foreground text-sm p-6">
                <p class="text-center">No canvas files yet</p>
            </div>
        {:else}
            {#each entries as entry (entry.filePath)}
                <div class="border-b border-border">
                    <!-- Collapsible header -->
                    <button
                        class="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted/50 transition-colors cursor-pointer text-left"
                        onclick={() => toggleExpanded(entry.filePath)}
                        aria-label="{entry.expanded ? 'Collapse' : 'Expand'} {entry.filePath}"
                        aria-expanded={entry.expanded}
                    >
                        {#if entry.expanded}
                            <ChevronDown class="size-3 shrink-0 text-muted-foreground" />
                        {:else}
                            <ChevronRight class="size-3 shrink-0 text-muted-foreground" />
                        {/if}
                        <span class="truncate font-mono">{entry.filePath}</span>
                        {#if entry.loading}
                            <span class="shrink-0 text-muted-foreground/60">loading…</span>
                        {:else if entry.version > 0}
                            <span class="shrink-0 text-muted-foreground/60">v{entry.version}</span>
                        {/if}
                    </button>

                    <!-- Editor (only rendered when expanded) -->
                    {#if entry.expanded && !entry.loading}
                        <div class="border-t border-border">
                            <CanvasEditor
                                {conversationId}
                                filePath={entry.filePath}
                                initialContent={entry.content}
                                initialVersion={entry.version}
                                onregisterReceiver={(receiver) =>
                                    registerCanvasReceiver(entry.filePath, receiver)}
                                onversionchange={(v) => updateCanvasVersion(entry.filePath, v)}
                            />
                        </div>
                    {/if}
                </div>
            {/each}
        {/if}
    </div>
</div>
