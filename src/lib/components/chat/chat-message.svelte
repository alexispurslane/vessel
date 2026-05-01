<script lang="ts">
    import { Streamdown } from "svelte-streamdown";
    import MathComponent from "svelte-streamdown/math";
    import MermaidComponent from "svelte-streamdown/mermaid";
    import StreamdownCode from "$lib/components/chat/streamdown-code.svelte";
    import { preprocessMathMarkdown } from "$lib/utils/math-preprocess.js";
    import { type DeepPartialTheme } from "$lib/types/theme.js";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import Brain from "@lucide/svelte/icons/brain";
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import ChevronUp from "@lucide/svelte/icons/chevron-up";
    import Clipboard from "@lucide/svelte/icons/clipboard";
    import AlertCircle from "@lucide/svelte/icons/alert-circle";
    import Trash2 from "@lucide/svelte/icons/trash-2";
    import Pencil from "@lucide/svelte/icons/pencil";
    import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
    import X from "@lucide/svelte/icons/x";
    import Check from "@lucide/svelte/icons/check";
    import ToolCall from "$lib/components/chat/tool-call.svelte";
    import FetchedSources from "$lib/components/chat/fetched-sources.svelte";
    import type { ChatMessage as ChatMessageType } from "$lib/types.js";
    import type { SearchResultItem } from "$lib/types.js";

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
        /** Callback for in-place edit of an assistant message (no AI re-prompt, just modifies the stored text) */
        oneditassistant?: (messageId: string, newText: string) => void;
        /** Whether a navigation operation is in progress */
        navigating?: boolean;
        /** Callback when a search source is clicked, to open search results panel */
        onsearchclick?: (query: string, results: SearchResultItem[]) => void;
        /** Callback when a page source is clicked, to open page content panel */
        onpageclick?: (url: string, title: string, content: string) => void;
    }

    let {
        msg,
        thinkingIsOpen,
        onthinkingtoggle,
        scrollContainer,
        ondelete,
        onedit,
        oneditassistant,
        navigating = false,
        onsearchclick,
        onpageclick,
    }: Props = $props();

    /** Theme override for user messages — needs text-primary-foreground instead of text-foreground */
    const userMsgTheme: DeepPartialTheme = {
        h1: { base: "mt-4 mb-1 text-xl font-semibold text-primary-foreground" },
        h2: { base: "mt-4 mb-1 text-lg font-semibold text-primary-foreground" },
        h3: { base: "mt-3 mb-1 text-base font-semibold text-primary-foreground" },
        h4: { base: "mt-3 mb-1 text-sm font-semibold text-primary-foreground" },
        h5: { base: "mt-2 mb-1 text-sm font-semibold text-primary-foreground" },
        h6: { base: "mt-2 mb-1 text-xs font-semibold text-primary-foreground" },
        paragraph: { base: "text-primary-foreground" },
        ul: { base: "pl-6 list-outside list-disc whitespace-normal text-primary-foreground" },
        ol: { base: "pl-6 list-outside whitespace-normal text-primary-foreground" },
        li: { base: "py-0.5 text-primary-foreground" },
        blockquote: {
            base: "border-primary-foreground/30 text-primary-foreground/80 my-2 border-l-4 pl-4 italic",
        },
        strong: { base: "font-semibold text-primary-foreground" },
        em: { base: "italic text-primary-foreground" },
        del: { base: "text-primary-foreground/60 line-through" },
        link: {
            base: "text-primary-foreground underline wrap-anywhere font-medium hover:text-primary-foreground/80",
        },
        codespan: {
            base: "bg-primary-foreground/15 rounded px-1.5 py-0.5 font-mono text-primary-foreground text-[0.9em]",
        },
        hr: { base: "border-primary-foreground/30 my-4" },
        table: {
            base: "overflow-x-auto max-w-full my-2 border border-primary-foreground/20 rounded-lg",
        },
        thead: { base: "bg-primary-foreground/10" },
        tr: { base: "border-primary-foreground/15 border-b" },
        th: { base: "px-3 py-2 text-xs font-semibold text-primary-foreground min-w-0" },
        td: { base: "px-3 py-2 text-xs text-primary-foreground min-w-0 break-words" },
    };

    /** Theme override for assistant messages — constrain widths, use serif font, compact spacing */
    const assistantMsgTheme: DeepPartialTheme = {
        h1: { base: "mt-4 mb-1 text-xl font-semibold" },
        h2: { base: "mt-4 mb-1 text-lg font-semibold" },
        h3: { base: "mt-3 mb-1 text-base font-semibold" },
        h4: { base: "mt-3 mb-1 text-sm font-semibold" },
        h5: { base: "mt-2 mb-1 text-sm font-semibold" },
        h6: { base: "mt-2 mb-1 text-xs font-semibold" },
        paragraph: { base: "" },
        ul: { base: "pl-6 list-outside list-disc whitespace-normal" },
        ol: { base: "pl-6 list-outside whitespace-normal" },
        li: { base: "py-0.5" },
        blockquote: { base: "my-2 border-l-4 pl-4 italic" },
        table: { base: "overflow-x-auto max-w-full my-2 rounded-lg border border-border" },
        th: { base: "px-3 py-2 text-xs font-semibold min-w-0" },
        td: { base: "px-3 py-2 text-xs min-w-0 break-words" },
        code: {
            base: "my-2 w-full overflow-hidden rounded-lg border border-border flex flex-col max-w-full",
        },
    };

    /** Theme override for thinking block — very compact */
    const thinkingTheme: DeepPartialTheme = {
        h1: { base: "mt-2 mb-0.5 text-xs font-semibold" },
        h2: { base: "mt-2 mb-0.5 text-xs font-semibold" },
        h3: { base: "mt-1.5 mb-0.5 text-xs font-semibold" },
        h4: { base: "mt-1 mb-0.5 text-xs font-semibold" },
        paragraph: { base: "" },
        ul: { base: "pl-5 list-outside list-disc whitespace-normal" },
        ol: { base: "pl-5 list-outside whitespace-normal" },
        li: { base: "py-0" },
        code: {
            base: "my-1 w-full overflow-hidden rounded border border-border flex flex-col max-w-full text-[0.7rem]",
        },
    };

    let thinkingEl: HTMLDivElement | undefined = $state();
    let msgEl: HTMLDivElement | undefined = $state();
    let copied = $state(false);
    let confirmDelete = $state(false);
    let confirmDeleteTimer: ReturnType<typeof setTimeout> | undefined;
    let editing = $state(false);
    let editText = $state("");

    /** Preprocessed content: fixes math formatting for Streamdown */
    const preprocessedContent = $derived(preprocessMathMarkdown(msg.content));
    const preprocessedThinking = $derived(preprocessMathMarkdown(msg.thinking || ""));

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
            const el = thinkingEl;
            requestAnimationFrame(() => {
                el.scrollTop = el.scrollHeight;
            });
        }
    });

    async function handleCopyMessage() {
        try {
            await navigator.clipboard.writeText(msg.content);
        } catch {
            // Clipboard API not available (e.g. non-HTTPS context)
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
        editText = msg.content;
        editing = true;
    }

    function handleEditSubmit() {
        const trimmed = editText.trim();
        if (!trimmed) return;
        editing = false;
        if (msg.role === "user") {
            onedit?.(msg.id, msg.role, trimmed);
        } else {
            // In-place edit for assistant messages — no AI re-prompt
            oneditassistant?.(msg.id, trimmed);
        }
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
            <div
                bind:this={thinkingEl}
                class="border-t px-3 py-2 text-xs text-muted-foreground max-h-64 overflow-auto markdown-prose markdown-thinking"
            >
                <Streamdown
                    content={preprocessedThinking}
                    baseTheme="shadcn"
                    theme={thinkingTheme}
                    parseIncompleteMarkdown={msg.thinkingStreaming ?? false}
                    components={{
                        math: MathComponent,
                        mermaid: MermaidComponent,
                        code: StreamdownCode,
                    }}
                />
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
                {:else if editing}
                    <!-- In-place editing mode for both user and assistant messages -->
                    <!-- svelte-ignore a11y_autofocus -->
                    <textarea
                        bind:value={editText}
                        onkeydown={handleEditKeydown}
                        autofocus
                        class="w-full bg-transparent resize-none outline-none min-h-[2em] max-h-[50vh] overflow-auto text-sm leading-relaxed"
                        rows={Math.max(2, editText.split("\n").length)}
                    ></textarea>
                {:else if msg.role === "user"}
                    <div class="markdown-prose">
                        <Streamdown
                            content={preprocessedContent}
                            baseTheme="shadcn"
                            theme={userMsgTheme}
                            parseIncompleteMarkdown={false}
                            components={{
                                math: MathComponent,
                                mermaid: MermaidComponent,
                                code: StreamdownCode,
                            }}
                        />
                    </div>
                {:else}
                    <div class="markdown-prose">
                        <Streamdown
                            content={preprocessedContent}
                            baseTheme="shadcn"
                            theme={assistantMsgTheme}
                            parseIncompleteMarkdown={msg.streaming ?? false}
                            components={{
                                math: MathComponent,
                                mermaid: MermaidComponent,
                                code: StreamdownCode,
                            }}
                        />
                    </div>
                {/if}
            </div>
            <!-- Action bar at bottom, visible on hover -->
            {#if editing}
                <div class="flex justify-end gap-1.5 mt-1">
                    <button
                        onclick={() => {
                            handleEditCancel();
                        }}
                        class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-2 py-1 rounded hover:bg-muted"
                        aria-label="Cancel editing"
                    >
                        <X class="size-3" />
                        Cancel
                    </button>
                    <button
                        onclick={() => {
                            handleEditSubmit();
                        }}
                        class="inline-flex items-center gap-1 text-[11px] text-primary-foreground bg-primary hover:bg-primary/90 transition-colors cursor-pointer px-2 py-1 rounded"
                        aria-label="Submit edit"
                    >
                        <Check class="size-3" />
                        {msg.role === "user" ? "Save & Resend" : "Save"}
                    </button>
                </div>
            {:else if !msg.streaming && !navigating}
                <div
                    class="flex justify-end gap-1 mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity"
                >
                    {#if oneditassistant || (onedit && msg.role === "user")}
                        <button
                            onclick={() => {
                                handleEdit();
                            }}
                            class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-muted"
                            aria-label="Edit message"
                            title="Edit message"
                        >
                            <Pencil class="size-3" />
                        </button>
                    {/if}
                    {#if onedit && msg.role === "user"}
                        <button
                            onclick={() => {
                                onedit(msg.id, msg.role);
                            }}
                            class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-muted"
                            aria-label="Regenerate from here"
                            title="Regenerate from here"
                        >
                            <RotateCcw class="size-3" />
                        </button>
                    {/if}
                    {#if onedit && msg.role === "assistant"}
                        <button
                            onclick={() => {
                                onedit(msg.id, msg.role);
                            }}
                            class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-muted"
                            aria-label="Regenerate response"
                            title="Regenerate response"
                        >
                            <RotateCcw class="size-3" />
                        </button>
                    {/if}
                    {#if ondelete}
                        <button
                            onclick={() => {
                                handleDelete();
                            }}
                            class="inline-flex items-center gap-1 text-[11px] transition-colors cursor-pointer px-1.5 py-0.5 rounded {confirmDelete
                                ? 'text-destructive bg-destructive/10'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
                            aria-label={confirmDelete ? "Confirm delete" : "Delete message"}
                            title={confirmDelete
                                ? "Click again to confirm deletion"
                                : "Delete message"}
                        >
                            <Trash2 class="size-3" />
                            {#if confirmDelete}
                                <span class="text-[10px] font-medium">Confirm?</span>
                            {/if}
                        </button>
                    {/if}
                    <button
                        onclick={() => {
                            void handleCopyMessage();
                        }}
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
                        onclick={() => {
                            scrollToTop();
                        }}
                        class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-muted"
                        aria-label="Scroll to top of message"
                    >
                        <ChevronUp class="size-3" />
                    </button>
                </div>
            {:else if navigating}
                <div class="flex justify-end gap-1 mt-1">
                    <span
                        class="inline-flex items-center gap-1 text-[11px] text-muted-foreground px-1.5 py-0.5"
                    >
                        <Spinner class="size-3" />
                        Updating...
                    </span>
                </div>
            {/if}
        </div>
    {/if}

    <!-- Fetched sources -->
    {#if msg.role === "assistant" && msg.fetchedSources && msg.fetchedSources.length > 0 && !msg.streaming}
        <FetchedSources sources={msg.fetchedSources} {onsearchclick} {onpageclick} />
    {/if}

    <!-- Tool calls -->
    {#if msg.toolCalls && msg.toolCalls.length > 0}
        <div class="flex flex-col gap-1">
            {#each msg.toolCalls as tool, i (`${msg.id}-tool-${String(i)}`)}
                <ToolCall toolCall={tool} />
            {/each}
        </div>
    {/if}
</div>
