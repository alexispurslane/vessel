<script lang="ts">
    import SvelteMarkdown from "@humanspeak/svelte-markdown";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import Wrench from "@lucide/svelte/icons/wrench";
    import Check from "@lucide/svelte/icons/check";
    import X from "@lucide/svelte/icons/x";
    import Brain from "@lucide/svelte/icons/brain";
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import ChevronUp from "@lucide/svelte/icons/chevron-up";
    import Clipboard from "@lucide/svelte/icons/clipboard";
    import AlertCircle from "@lucide/svelte/icons/alert-circle";
    import Trash2 from "@lucide/svelte/icons/trash-2";
    import Pencil from "@lucide/svelte/icons/pencil";
    import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
    import CodeBlock from "$lib/components/chat/code-block.svelte";
    import type { ChatMessage as ChatMessageType, ToolCallInfo } from "$lib/types.js";

    interface Props {
        /** The chat message data */
        msg: ChatMessageType;
        /** Whether the thinking dropdown is open */
        thinkingIsOpen?: boolean;
        /** Callback when the thinking dropdown is toggled */
        onthinkingtoggle?: (open: boolean) => void;
        /** The scrollable viewport element for scrolling to message top */
        scrollContainer?: HTMLElement | null;
        /** Callback to delete this message (and everything after it) */
        ondelete?: (messageId: string, role: string) => void;
        /** Callback to edit this message (navigate back + resend with new text for user, regenerate for assistant) */
        onedit?: (messageId: string, role: string, newText?: string) => void;
        /** Whether a navigation operation is in progress */
        navigating?: boolean;
    }

    let {
        msg,
        thinkingIsOpen,
        onthinkingtoggle,
        scrollContainer,
        ondelete,
        onedit,
        navigating = false,
    }: Props = $props();

    /** Custom renderers for SvelteMarkdown */
    const renderers = {
        code: CodeBlock,
    };

    let thinkingEl: HTMLDivElement | undefined = $state();
    let msgEl: HTMLDivElement | undefined = $state();
    let copied = $state(false);
    let confirmDelete = $state(false);
    let confirmDeleteTimer: ReturnType<typeof setTimeout> | undefined;
    let editing = $state(false);
    let editText = $state("");

    function scrollToTop() {
        console.log(msgEl, scrollContainer);
        if (!msgEl || !scrollContainer) return;
        console.log("Scroll to top");
        scrollContainer.scrollTo({
            top: msgEl.offsetTop - scrollContainer.offsetTop - 8,
            behavior: "smooth",
        });
    }

    // Auto-scroll thinking block to bottom as streaming tokens arrive
    $effect(() => {
        if (msg.thinkingStreaming && thinkingEl) {
            requestAnimationFrame(() => {
                thinkingEl.scrollTop = thinkingEl.scrollHeight;
            });
        }
    });

    async function handleCopyMessage() {
        try {
            await navigator.clipboard.writeText(msg.content);
        } catch {
            const textarea = document.createElement("textarea");
            textarea.value = msg.content;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
        }
        copied = true;
        setTimeout(() => (copied = false), 2000);
    }

    function handleToggle(e: Event) {
        const el = e.currentTarget as HTMLDetailsElement;
        onthinkingtoggle?.(el.open);
    }

    function handleDelete() {
        if (confirmDelete) {
            // Second click — actually delete
            confirmDelete = false;
            if (confirmDeleteTimer) clearTimeout(confirmDeleteTimer);
            ondelete?.(msg.id, msg.role);
        } else {
            // First click — show confirmation
            confirmDelete = true;
            // Auto-cancel confirmation after 3 seconds
            confirmDeleteTimer = setTimeout(() => {
                confirmDelete = false;
            }, 3000);
        }
    }

    function handleEdit() {
        if (msg.role === 'user') {
            // In-place editing for user messages
            editText = msg.content;
            editing = true;
        } else {
            // Regenerate for assistant messages
            onedit?.(msg.id, msg.role);
        }
    }

    function handleEditSubmit() {
        const trimmed = editText.trim();
        if (!trimmed) return;
        editing = false;
        onedit?.(msg.id, msg.role, trimmed);
    }

    function handleEditCancel() {
        editing = false;
        editText = "";
    }

    function handleEditKeydown(e: KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleEditSubmit();
        } else if (e.key === "Escape") {
            handleEditCancel();
        }
    }
</script>

<div class="flex flex-col gap-1.5 w-full font-sans">
    <!-- Thinking section -->
    {#if msg.role === "assistant" && (msg.thinking || msg.thinkingStreaming)}
        <details
            class="group rounded-lg border bg-background text-sm"
            open={thinkingIsOpen ?? msg.thinkingStreaming}
            ontoggle={handleToggle}
        >
            <summary
                class="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-muted/50 transition-colors rounded-lg text-xs text-muted-foreground"
            >
                {#if msg.thinkingStreaming}
                    <Spinner class="size-3" />
                {:else}
                    <Brain class="size-3" />
                {/if}
                <span class="font-medium">
                    {#if msg.thinkingStreaming}
                        Thinking...
                    {:else}
                        Thought
                    {/if}
                </span>
                <ChevronDown
                    class="size-3 ml-auto shrink-0 transition-transform group-open:rotate-180"
                />
            </summary>
            <div bind:this={thinkingEl} class="border-t px-3 py-2 text-xs text-muted-foreground max-h-64 overflow-auto markdown-prose markdown-thinking">
                <SvelteMarkdown source={msg.thinking || ""} streaming={msg.thinkingStreaming} {renderers} options={{ gfm: true, breaks: true }} />
            </div>
        </details>
    {/if}

    {#if msg.isError || msg.content || msg.streaming}
        <div class="group/msg w-full" bind:this={msgEl}>
            <div
                class="rounded-2xl px-4 py-2.5 text-sm leading-relaxed {msg.isError
                    ? 'bg-destructive/10 text-destructive border border-destructive/30 rounded-bl-sm'
                    : msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm'}"
            >
                {#if msg.isError}
                    <span class="flex items-center gap-1.5 font-medium">
                        <AlertCircle class="size-4 shrink-0" />
                        {msg.content}
                    </span>
                {:else if msg.role === 'user' && editing}
                    <!-- In-place editing mode for user messages -->
                    <!-- svelte-ignore a11y_autofocus -->
                    <textarea
                        bind:value={editText}
                        onkeydown={handleEditKeydown}
                        autofocus
                        class="w-full bg-transparent resize-none outline-none min-h-[2em] max-h-[50vh] overflow-auto text-sm leading-relaxed"
                        rows={Math.max(2, editText.split('\n').length)}
                    ></textarea>
                {:else if msg.role === 'user'}
                    <div class="markdown-prose">
                        <SvelteMarkdown source={msg.content} {renderers} options={{ gfm: true, breaks: true }} />
                    </div>
                {:else}
                    <div class="markdown-prose">
                        <SvelteMarkdown source={msg.content} streaming={msg.streaming} {renderers} options={{ gfm: true, breaks: true }} />
                    </div>
                {/if}
                {#if msg.streaming}
                    <span
                        class="inline-block w-0.5 h-[1.1em] ml-0.5 bg-current animate-pulse rounded-full align-text-bottom"
                    ></span>
                {/if}
            </div>
            <!-- Action bar at bottom, visible on hover -->
            {#if editing}
                <div class="flex justify-end gap-1.5 mt-1">
                    <button
                        onclick={() => handleEditCancel()}
                        class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-2 py-1 rounded hover:bg-muted"
                        aria-label="Cancel editing"
                    >
                        <X class="size-3" />
                        Cancel
                    </button>
                    <button
                        onclick={() => handleEditSubmit()}
                        class="inline-flex items-center gap-1 text-[11px] text-primary-foreground bg-primary hover:bg-primary/90 transition-colors cursor-pointer px-2 py-1 rounded"
                        aria-label="Submit edit"
                    >
                        <Check class="size-3" />
                        Save & Resend
                    </button>
                </div>
            {:else if !msg.streaming && !navigating}
                <div class="flex justify-end gap-1 mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                    {#if onedit}
                        <button
                            onclick={() => handleEdit()}
                            class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-muted"
                            aria-label={msg.role === 'user' ? 'Edit message' : 'Regenerate response'}
                            title={msg.role === 'user' ? 'Edit message' : 'Regenerate response'}
                        >
                            {#if msg.role === 'user'}
                                <Pencil class="size-3" />
                            {:else}
                                <RotateCcw class="size-3" />
                            {/if}
                        </button>
                    {/if}
                    {#if ondelete}
                        <button
                            onclick={() => handleDelete()}
                            class="inline-flex items-center gap-1 text-[11px] transition-colors cursor-pointer px-1.5 py-0.5 rounded {confirmDelete ? 'text-destructive bg-destructive/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
                            aria-label={confirmDelete ? 'Confirm delete' : 'Delete message'}
                            title={confirmDelete ? 'Click again to confirm deletion' : 'Delete message'}
                        >
                            <Trash2 class="size-3" />
                            {#if confirmDelete}
                                <span class="text-[10px] font-medium">Confirm?</span>
                            {/if}
                        </button>
                    {/if}
                    <button
                        onclick={() => handleCopyMessage()}
                        class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-muted"
                        aria-label="Copy message"
                    >
                        {#if copied}
                            <Check class="size-3" />
                        {:else}
                            <Clipboard class="size-3" />
                        {/if}
                    </button>
                    <button
                        onclick={() => scrollToTop()}
                        class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-muted"
                        aria-label="Scroll to top of message"
                    >
                        <ChevronUp class="size-3" />
                    </button>
                </div>
            {:else if navigating}
                <div class="flex justify-end gap-1 mt-1">
                    <span class="inline-flex items-center gap-1 text-[11px] text-muted-foreground px-1.5 py-0.5">
                        <Spinner class="size-3" />
                        Updating...
                    </span>
                </div>
            {/if}
        </div>
    {/if}

    <!-- Tool calls -->
    {#if msg.toolCalls && msg.toolCalls.length > 0}
        <div class="flex flex-col gap-1">
            {#each msg.toolCalls as tool, i (msg.id + "-tool-" + i)}
                <details class="group rounded-lg border bg-background text-sm">
                    <summary
                        class="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-muted/50 transition-colors rounded-lg text-xs"
                    >
                        <Wrench class="size-3 text-muted-foreground shrink-0" />
                        <span class="font-medium truncate">{tool.toolName}</span>
                        <span class="ml-auto shrink-0 flex items-center">
                            {#if tool.status === "running"}
                                <Spinner class="size-3" />
                            {:else if tool.status === "completed"}
                                <Check class="size-3.5 text-green-600 dark:text-green-400" />
                            {:else if tool.status === "error"}
                                <X class="size-3.5 text-destructive" />
                            {/if}
                        </span>
                    </summary>
                    {#if tool.output}
                        <div
                            class="border-t px-3 py-2 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all max-h-48 overflow-auto"
                        >
                            {tool.output}
                        </div>
                    {/if}
                </details>
            {/each}
        </div>
    {/if}
</div>
