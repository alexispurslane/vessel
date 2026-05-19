<script lang="ts">
    /**
     * @file Chat input component with file upload support.
     */
    import { Button } from "$lib/components/ui/button/index.js";
    import CodeMirrorInput from "$lib/components/codemirror/CodeMirrorInput.svelte";
    import {
        DropdownMenu,
        DropdownMenuContent,
        DropdownMenuGroup,
        DropdownMenuItem,
        DropdownMenuLabel,
        DropdownMenuTrigger,
    } from "$lib/components/ui/dropdown-menu/index.js";
    import {
        ContextMenu,
        ContextMenuContent,
        ContextMenuItem,
        ContextMenuTrigger,
        ContextMenuSeparator,
    } from "$lib/components/ui/context-menu/index.js";
    import {
        Tooltip,
        TooltipContent,
        TooltipProvider,
        TooltipTrigger,
    } from "$lib/components/ui/tooltip/index.js";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import Send from "@lucide/svelte/icons/send";
    import StopCircle from "@lucide/svelte/icons/stop-circle";
    import Cpu from "@lucide/svelte/icons/cpu";
    import Scissors from "@lucide/svelte/icons/scissors";
    import Clipboard from "@lucide/svelte/icons/clipboard";
    import ClipboardPaste from "@lucide/svelte/icons/clipboard-paste";
    import Eraser from "@lucide/svelte/icons/eraser";
    import Check from "@lucide/svelte/icons/check";
    import CheckCircle from "@lucide/svelte/icons/check-circle";
    import Paintbrush from "@lucide/svelte/icons/paintbrush";
    import Undo2 from "@lucide/svelte/icons/undo-2";
    import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
    import Plus from "@lucide/svelte/icons/plus";
    import X from "@lucide/svelte/icons/x";
    import Maximize from "@lucide/svelte/icons/maximize";
    import Minimize from "@lucide/svelte/icons/minimize";
    import FileIcon from "@lucide/svelte/icons/file";
    import ImageIcon from "@lucide/svelte/icons/image";
    import Download from "@lucide/svelte/icons/download";
    import { isTextFile } from "$lib/utils/file-type.js";
    import type { ModelInfo } from "$lib/types.js";

    interface PendingFile {
        file: File;
        id: string;
    }

    interface Props {
        /** The text value of the input (two-way bindable) */
        value?: string;
        /** Placeholder text when input is empty */
        placeholder?: string;
        /** Whether the input is disabled */
        disabled?: boolean;
        /** Whether the AI is currently generating (shows abort button) */
        generating?: boolean;
        /** Whether connected to the server (affects send button state) */
        connected?: boolean;
        /** Available models for the model selector dropdown */
        models?: ModelInfo[];
        /** The currently selected model ID (two-way bindable) */
        selectedModelId?: string;
        /** The conversation's default model ID — a dot appears when the selected model differs */
        conversationDefaultModelId?: string;
        /** The global default model ID — used by the "reset to global" action */
        globalDefaultModelId?: string;
        /** Pending files to upload (two-way bindable) */
        pendingFiles?: PendingFile[];
        /** Names of files already uploaded to the sandbox (read-only display) */
        sandboxFiles?: string[];
        /** Callback when user clicks a sandbox file to download it */
        ondownloadsandboxfile?: (path: string) => void;
        /** Callback when user clicks a text sandbox file to open it as canvas */
        oneditcanvasfile?: (path: string) => void;
        /** Callback when user removes an uploaded sandbox file */
        onremovesandboxfile?: (path: string) => void;
        /** Set of sandbox file paths that are currently canvas-ized */
        canvasFiles?: Set<string>;
        /** Whether there are pending invisible status updates to send (enables send with empty text) */
        hasPendingStatus?: boolean;
        /** Callback when send button is clicked */
        onsend?: () => void;
        /** Callback when abort button is clicked */
        onabort?: () => void;
        /** Callback when user sets the current model as the conversation default */
        onsetconversationdefault?: () => void;
        /** Callback when user switches the selector to the global default */
        onswitchtoglobaldefault?: () => void;
        /** Whether to autofocus the input on mount */
        autofocus?: boolean;
        /** Whether the input is in fullscreen mode (two-way bindable) */
        fullscreen?: boolean;
    }

    let {
        value = $bindable(""),
        placeholder = "Type a message...",
        disabled = false,
        generating = false,
        connected = true,
        models = [],
        selectedModelId = $bindable(""),
        conversationDefaultModelId = "",
        globalDefaultModelId = "",
        pendingFiles = $bindable<PendingFile[]>([]),
        sandboxFiles = [],
        ondownloadsandboxfile,
        oneditcanvasfile,
        onremovesandboxfile,
        canvasFiles = new Set<string>(),
        hasPendingStatus = false,
        onsend,
        onabort,
        onsetconversationdefault,
        onswitchtoglobaldefault,
        autofocus = false,
        fullscreen = $bindable(false),
    }: Props = $props();

    let editorRef: import("@codemirror/view").EditorView | null = $state(null);
    let fileInputRef: HTMLInputElement | null = $state(null);

    // Autofocus the editor on mount when requested
    $effect(() => {
        if (autofocus && editorRef) {
            editorRef.focus();
        }
    });

    function handleSend() {
        if (
            (!value.trim() && pendingFiles.length === 0 && !hasPendingStatus) ||
            !connected ||
            generating ||
            disabled
        )
            return;
        onsend?.();
    }

    function handleAbort() {
        onabort?.();
    }

    async function handleCut() {
        const sel = window.getSelection();
        if (sel?.toString()) {
            await navigator.clipboard.writeText(sel.toString());
            sel.deleteFromDocument();
        }
    }

    async function handleCopy() {
        const sel = window.getSelection();
        if (sel?.toString()) {
            await navigator.clipboard.writeText(sel.toString());
        }
    }

    /**
     * Handle paste events on the editor.
     * If the clipboard contains image data, the image is captured as a
     * File and added to pendingFiles.
     * Text content from the same paste is also inserted so nothing is lost.
     * @param e - The native clipboard paste event
     */
    function handleTextareaPaste(e: ClipboardEvent) {
        if (!e.clipboardData) return;

        const imageItems = [...e.clipboardData.items].filter((item) =>
            item.type.startsWith("image/")
        );

        if (imageItems.length > 0) {
            e.preventDefault();

            // Capture image files into pendingFiles
            for (const item of imageItems) {
                const file = item.getAsFile();
                if (!file) continue;
                pendingFiles = [
                    ...pendingFiles,
                    {
                        file,
                        id: `pasted-image-${String(Date.now())}-${crypto.randomUUID().slice(0, 8)}`,
                    },
                ];
            }

            // Insert any plain text from the same paste via EditorView
            const text = e.clipboardData.getData("text/plain");
            if (text && editorRef) {
                const view = editorRef;
                const pos = view.state.selection.main.head;
                view.dispatch({
                    changes: { from: pos, insert: text },
                });
            }
        }
    }

    async function handlePaste() {
        try {
            const text = await navigator.clipboard.readText();
            if (text && editorRef) {
                const view = editorRef;
                const pos = view.state.selection.main.head;
                view.dispatch({
                    changes: { from: pos, insert: text },
                });
            }
        } catch {
            // Clipboard read failed (e.g. permissions denied)
        }
    }

    function handleClear() {
        value = "";
        pendingFiles = [];
        editorRef?.focus();
    }

    function handleFileSelect() {
        fileInputRef?.click();
    }

    function handleFileInputChange(e: Event) {
        const input = e.target as HTMLInputElement;
        if (!input.files) return;

        for (const file of input.files) {
            pendingFiles = [
                ...pendingFiles,
                {
                    file,
                    id: `${file.name}-${String(Date.now())}-${crypto.randomUUID().slice(0, 8)}`,
                },
            ];
        }

        // Reset the input so the same file can be selected again
        input.value = "";
    }

    function removeFile(fileId: string) {
        pendingFiles = pendingFiles.filter((f) => f.id !== fileId);
    }

    function formatFileSize(bytes: number): string {
        if (bytes < 1024) return `${String(bytes)} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    // Height auto-resize is handled by CodeMirrorInput's internal auto-grow logic

    // Look up a model's display name from the available models list.
    // Model IDs are unique, so we only need the modelId to find it.
    function getModelDisplayName(modelId: string | undefined): string {
        if (!modelId) return "AI";
        const found = models.find((m) => m.id === modelId);
        return found?.name || modelId;
    }

    // Group models by provider for the dropdown
    let modelsByProvider = $derived(() => {
        const groups: Record<string, ModelInfo[]> = {};
        for (const model of models) {
            if (!(model.provider in groups)) {
                groups[model.provider] = [];
            }
            groups[model.provider].push(model);
        }
        return groups;
    });

    // Whether the selected model differs from the conversation's default
    let modelIsNonDefault = $derived(
        selectedModelId &&
            conversationDefaultModelId &&
            selectedModelId !== conversationDefaultModelId
    );

    // Whether the conversation's default differs from the global default
    let conversationDefaultDiffersFromGlobal = $derived(
        conversationDefaultModelId &&
            globalDefaultModelId &&
            conversationDefaultModelId !== globalDefaultModelId
    );

    const canSend = $derived(
        connected &&
            !generating &&
            !disabled &&
            (value.trim().length > 0 || pendingFiles.length > 0 || hasPendingStatus)
    );
</script>

<!-- Hidden file input for attaching files -->
<input
    bind:this={fileInputRef}
    type="file"
    multiple
    class="hidden"
    onchange={handleFileInputChange}
/>

<!-- Unified input container with border -->
<div
    class="group relative flex flex-col rounded-md border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring focus-within:border-ring transition-all {fullscreen
        ? 'flex-1 min-h-0'
        : ''}"
>
    <!-- Exit fullscreen button (upper-right overlay) -->
    {#if fullscreen}
        <button
            class="absolute top-2 right-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            onclick={() => (fullscreen = false)}
            aria-label="Exit fullscreen"
        >
            <Minimize class="size-4" />
        </button>
    {/if}
    <!-- File chips: sandbox files (subdued) + pending files (outlined) -->
    {#if sandboxFiles.length > 0 || pendingFiles.length > 0}
        <div class="flex flex-wrap gap-1.5 pb-2">
            <!-- Sandbox files: already uploaded, subdued style -->
            {#each sandboxFiles as filename (filename)}
                {@const isText = isTextFile(filename)}
                <ContextMenu>
                    <ContextMenuTrigger>
                        <div
                            class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground bg-muted/50 max-w-50 hover:bg-muted/70 cursor-pointer transition-colors"
                            role="button"
                            tabindex="0"
                            onclick={() => {
                                if (isText) {
                                    oneditcanvasfile?.(filename);
                                } else {
                                    ondownloadsandboxfile?.(filename);
                                }
                            }}
                            onkeydown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    if (isText) {
                                        oneditcanvasfile?.(filename);
                                    } else {
                                        ondownloadsandboxfile?.(filename);
                                    }
                                }
                            }}
                            aria-label="{isText ? 'Open' : 'Download'} {filename} from sandbox"
                        >
                            {#if canvasFiles.has(filename)}
                                <Paintbrush class="size-3 shrink-0 text-purple-500" />
                            {:else}
                                <Check class="size-3 shrink-0 text-green-600" />
                            {/if}
                            <span class="truncate">{filename}</span>
                            <button
                                class="shrink-0 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                                onclick={(e) => {
                                    e.stopPropagation();
                                    onremovesandboxfile?.(filename);
                                }}
                                aria-label="Remove {filename} from sandbox"
                            >
                                <X class="size-3" />
                            </button>
                        </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                        <ContextMenuItem onclick={() => ondownloadsandboxfile?.(filename)}>
                            <Download class="size-4" />
                            <span>Download</span>
                        </ContextMenuItem>
                    </ContextMenuContent>
                </ContextMenu>
            {/each}
            <!-- Pending files: queued for upload, outlined -->
            {#each pendingFiles as pf (pf.id)}
                <div
                    class="flex items-center gap-1.5 rounded-md border border-primary/40 bg-background px-2 py-1 text-xs text-foreground max-w-50"
                >
                    {#if pf.file.type.startsWith("image/")}
                        <ImageIcon class="size-3 shrink-0" />
                    {:else}
                        <FileIcon class="size-3 shrink-0" />
                    {/if}
                    <span class="truncate">{pf.file.name}</span>
                    <span class="shrink-0 text-muted-foreground/60"
                        >({formatFileSize(pf.file.size)})</span
                    >
                    <button
                        class="shrink-0 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                        onclick={() => {
                            removeFile(pf.id);
                        }}
                        aria-label="Remove {pf.file.name}"
                    >
                        <X class="size-3" />
                    </button>
                </div>
            {/each}
        </div>
    {/if}

    <!-- Input row -->
    <div class="flex {fullscreen ? 'flex-1 min-h-0' : 'items-center'} gap-2">
        <!-- Left-side buttons: model selector etc. -->
        <div class="flex {fullscreen ? 'self-end' : 'items-center'} gap-1">
            {#if models.length > 0}
                <DropdownMenu>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                {#snippet child({ props })}
                                    <DropdownMenuTrigger
                                        {...props}
                                        class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-muted text-foreground transition-colors cursor-pointer"
                                        aria-label="Select model"
                                    >
                                        <Cpu class="size-4" />
                                        {#if modelIsNonDefault}
                                            <span
                                                class="absolute top-1 right-1 size-2 rounded-full bg-primary"
                                            ></span>
                                        {/if}
                                    </DropdownMenuTrigger>
                                {/snippet}
                            </TooltipTrigger>
                            <TooltipContent
                                >Model: {getModelDisplayName(selectedModelId)}</TooltipContent
                            >
                        </Tooltip>
                    </TooltipProvider>
                    <DropdownMenuContent align="start">
                        {#each Object.entries(modelsByProvider()) as [provider, providerModels] (provider)}
                            <DropdownMenuGroup>
                                <DropdownMenuLabel class="text-xs text-muted-foreground"
                                    >{provider}</DropdownMenuLabel
                                >
                                {#each providerModels as model (model.id)}
                                    <DropdownMenuItem
                                        onclick={() => (selectedModelId = model.id)}
                                        class="flex items-center justify-between"
                                    >
                                        <span class="text-xs">{model.name}</span>
                                        {#if selectedModelId === model.id}
                                            <Check class="size-3.5 shrink-0" />
                                        {/if}
                                    </DropdownMenuItem>
                                {/each}
                            </DropdownMenuGroup>
                        {/each}
                    </DropdownMenuContent>
                </DropdownMenu>

                <!-- Model action buttons: visible when selected model differs from conversation default -->
                {#if modelIsNonDefault}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                {#snippet child({ props })}
                                    <button
                                        {...props}
                                        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-green-600 hover:bg-green-500/10 transition-colors cursor-pointer"
                                        onclick={onsetconversationdefault}
                                        aria-label="Set as conversation default"
                                    >
                                        <CheckCircle class="size-3.5" />
                                    </button>
                                {/snippet}
                            </TooltipTrigger>
                            <TooltipContent>Set as conversation default</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                {#snippet child({ props })}
                                    <button
                                        {...props}
                                        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                                        onclick={() =>
                                            (selectedModelId = conversationDefaultModelId)}
                                        aria-label="Restore conversation default"
                                    >
                                        <Undo2 class="size-3.5" />
                                    </button>
                                {/snippet}
                            </TooltipTrigger>
                            <TooltipContent>Restore to conversation default</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                {/if}

                <!-- Reset conversation default to global default -->
                {#if conversationDefaultDiffersFromGlobal}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                {#snippet child({ props })}
                                    <button
                                        {...props}
                                        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                                        onclick={onswitchtoglobaldefault}
                                        aria-label="Switch to global default"
                                    >
                                        <RotateCcw class="size-3.5" />
                                    </button>
                                {/snippet}
                            </TooltipTrigger>
                            <TooltipContent>Switch to global default</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                {/if}
            {:else}
                <div class="shrink-0 w-8"></div>
            {/if}
        </div>

        <!-- Text input with context menu -->
        <ContextMenu>
            <ContextMenuTrigger class="flex-1 min-w-0 {fullscreen ? 'min-h-0 flex flex-col' : ''}">
                <CodeMirrorInput
                    bind:ref={editorRef}
                    bind:value
                    {placeholder}
                    {disabled}
                    {fullscreen}
                    {sandboxFiles}
                    onsubmit={handleSend}
                    onpaste={handleTextareaPaste}
                />
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onclick={handleCut}>
                    <Scissors class="mr-2 h-4 w-4" />
                    Cut
                </ContextMenuItem>
                <ContextMenuItem onclick={handleCopy}>
                    <Clipboard class="mr-2 h-4 w-4" />
                    Copy
                </ContextMenuItem>
                <ContextMenuItem onclick={handlePaste}>
                    <ClipboardPaste class="mr-2 h-4 w-4" />
                    Paste
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onclick={handleClear}>
                    <Eraser class="mr-2 h-4 w-4" />
                    Clear
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>

        <!-- Right-side action buttons -->
        <div class="flex {fullscreen ? 'self-end' : 'items-center'} gap-2">
            <!-- Plus button for file upload -->
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger>
                        {#snippet child({ props })}
                            <Button
                                {...props}
                                variant="ghost"
                                size="icon"
                                onclick={handleFileSelect}
                                class="h-8 w-8 shrink-0"
                                aria-label="Attach files"
                            >
                                <Plus class="size-4" />
                            </Button>
                        {/snippet}
                    </TooltipTrigger>
                    <TooltipContent>Attach files to sandbox</TooltipContent>
                </Tooltip>
            </TooltipProvider>

            <!-- Fullscreen toggle button -->
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger>
                        {#snippet child({ props })}
                            <Button
                                {...props}
                                variant="ghost"
                                size="icon"
                                onclick={() => (fullscreen = !fullscreen)}
                                class="h-8 w-8 shrink-0"
                                aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                            >
                                {#if fullscreen}
                                    <Minimize class="size-4" />
                                {:else}
                                    <Maximize class="size-4" />
                                {/if}
                            </Button>
                        {/snippet}
                    </TooltipTrigger>
                    <TooltipContent>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</TooltipContent>
                </Tooltip>
            </TooltipProvider>

            <!-- Send / Abort button -->
            {#if generating}
                <Button
                    variant="destructive"
                    size="icon"
                    onclick={handleAbort}
                    class="h-8 w-8 shrink-0"
                    aria-label="Stop generating"
                >
                    <StopCircle class="size-4" />
                </Button>
            {:else}
                <Button
                    size="icon"
                    onclick={handleSend}
                    disabled={!canSend}
                    class="h-8 w-8 shrink-0"
                    aria-label="Send message"
                >
                    {#if disabled}
                        <Spinner class="h-4 w-4" />
                    {:else}
                        <Send class="size-4" />
                    {/if}
                </Button>
            {/if}
        </div>
    </div>
</div>
