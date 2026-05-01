<script lang="ts">
    import Pencil from "@lucide/svelte/icons/pencil";
    import Save from "@lucide/svelte/icons/save";
    import X from "@lucide/svelte/icons/x";
    import Plus from "@lucide/svelte/icons/plus";
    import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import ChevronRight from "@lucide/svelte/icons/chevron-right";
    import Copy from "@lucide/svelte/icons/copy";
    import Check from "@lucide/svelte/icons/check";
    import { Spinner } from "$lib/components/ui/spinner/index.js";

    /**
     * Shared editor for system prompt custom instructions and replacement prompt.
     *
     * This component is presentation-only — mutations are emitted via callbacks
     * so the parent decides where data is persisted (per-conversation
 API call,
     * global settings save, etc.).
     *
     * There are two usage modes:
     * - "immediate": every change is persisted immediately (per-conversation)
     * - "deferred": changes accumulate locally and are persisted on explicit save (global settings)
     */

    interface Props {
        /** Current list of custom instructions */
        instructions: string[];
        /** Current replacement system prompt (empty string = none set) */
        customSystemPrompt: string;
        /** The effective (fully resolved) system prompt to display */
        effectiveSystemPrompt: string;
        /** Whether a save/persist operation is in progress */
        saving?: boolean;
        /** Error message to display, if any */
        error?: string | null;
        /** An instruction was added. */
        onadd?: (text: string) => void;
        /** An instruction was removed. */
        onremove?: (index: number) => void;
        /** An instruction was edited in-place. */
        onedit?: (index: number, newText: string) => void;
        /** The replacement system prompt changed. */
        onreplacechange?: (value: string) => void;
        /** User requested to clear the replacement system prompt. */
        onreplaceclear?: () => void;
    }

    let {
        instructions = [],
        customSystemPrompt = "",
        effectiveSystemPrompt = "",
        saving = false,
        error = null,
        onadd,
        onremove,
        onedit,
        onreplacechange,
        onreplaceclear,
    }: Props = $props();

    // --- Local edit state ---
    let newInstructionText = $state("");
    let editingIndex = $state<number | null>(null);
    let editText = $state("");
    let replaceOpen = $state(false);
    let editingReplace = $state(false);
    let editReplaceText = $state("");
    let systemPromptCopied = $state(false);

    function getInstructions(): string[] {
        const raw = instructions;
        return Array.isArray(raw) ? raw : [raw];
    }

    function addInstruction() {
        const text = newInstructionText.trim();
        if (!text) return;
        onadd?.(text);
        newInstructionText = "";
    }

    function removeInstruction(index: number) {
        onremove?.(index);
        editingIndex = null;
    }

    function startEditInstruction(index: number) {
        editText = getInstructions()[index] ?? "";
        editingIndex = index;
    }

    function cancelEditInstruction() {
        editingIndex = null;
        editText = "";
    }

    function saveEditInstruction(index: number) {
        const text = editText.trim();
        if (!text) return;
        onedit?.(index, text);
        editingIndex = null;
        editText = "";
    }

    function startEditReplace() {
        editReplaceText = customSystemPrompt;
        editingReplace = true;
    }

    function cancelEditReplace() {
        editingReplace = false;
        editReplaceText = "";
    }

    function saveReplacePrompt() {
        const text = editReplaceText.trim();
        onreplacechange?.(text);
        editingReplace = false;
        editReplaceText = "";
    }

    function clearReplacePrompt() {
        onreplaceclear?.();
    }

    async function copySystemPrompt() {
        if (!effectiveSystemPrompt) return;
        await navigator.clipboard.writeText(effectiveSystemPrompt);
        systemPromptCopied = true;
        setTimeout(() => {
            systemPromptCopied = false;
        }, 2000);
    }
</script>

<!-- Custom Instructions -->
<div class="rounded-lg border">
    <div class="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
        <span class="text-[11px] font-medium text-muted-foreground">Custom Instructions</span>
        {#if getInstructions().length > 0}
            <span class="text-[10px] text-muted-foreground">{getInstructions().length}</span>
        {/if}
    </div>
    <div class="p-2 space-y-2">
        {#if getInstructions().length > 0}
            <div class="space-y-1.5">
                {#each getInstructions() as instruction, i (i)}
                    <div
                        class="group flex items-start gap-1.5 rounded border bg-background px-2 py-1.5"
                    >
                        {#if editingIndex === i}
                            <div class="flex-1 space-y-1.5">
                                <textarea
                                    bind:value={editText}
                                    class="w-full text-[11px] leading-relaxed font-mono bg-background border rounded px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                                    rows="2"
                                ></textarea>
                                <div class="flex items-center justify-end gap-1">
                                    <button
                                        onclick={cancelEditInstruction}
                                        class="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-muted"
                                        disabled={saving}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onclick={() => {
                                            saveEditInstruction(i);
                                        }}
                                        class="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-primary/10"
                                        disabled={saving}
                                    >
                                        {#if saving}
                                            <Spinner class="size-3" />
                                        {:else}
                                            <Save class="size-3" />
                                        {/if}
                                        Save
                                    </button>
                                </div>
                            </div>
                        {:else}
                            <p
                                class="flex-1 text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/80 font-mono"
                            >
                                {instruction}
                            </p>
                            <div
                                class="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <button
                                    onclick={() => {
                                        startEditInstruction(i);
                                    }}
                                    class="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-0.5 rounded hover:bg-muted"
                                    title="Edit instruction"
                                >
                                    <Pencil class="size-3" />
                                </button>
                                <button
                                    onclick={() => {
                                        removeInstruction(i);
                                    }}
                                    class="inline-flex items-center text-muted-foreground hover:text-destructive transition-colors cursor-pointer p-0.5 rounded hover:bg-muted"
                                    title="Remove instruction"
                                    disabled={saving}
                                >
                                    <X class="size-3" />
                                </button>
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>
        {:else}
            <p class="text-[10px] text-muted-foreground text-center py-2">
                No custom instructions yet.
            </p>
        {/if}

        {#if error}
            <p class="text-[10px] text-destructive">{error}</p>
        {/if}

        <!-- Add new instruction -->
        <div class="flex items-start gap-1.5">
            <input
                bind:value={newInstructionText}
                class="flex-1 text-[11px] font-mono bg-background border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Add an instruction..."
                onkeydown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        addInstruction();
                    }
                }}
            />
            <button
                onclick={addInstruction}
                class="shrink-0 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-1.5 py-1 rounded hover:bg-muted"
                disabled={saving || !newInstructionText.trim()}
                title="Add instruction
"
            >
                {#if saving}
                    <Spinner class="size-3" />
                {:else}
                    <Plus class="size-3" />
                {/if}
            </button>
        </div>
    </div>
</div>

<!-- Replace system prompt (collapsible, dangerous) -->
<div class="rounded-lg border">
    <button
        class="flex items-center
 justify-between w-full px-3 py-1.5 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
        onclick={() => (replaceOpen = !replaceOpen)}
    >
        <div class="flex items-center gap-1.5">
            <TriangleAlert class="size-3 text-amber-500" />
            <span class="text-[11px] font-medium text-muted-foreground">Replace System Prompt</span>
            {#if customSystemPrompt}
                <span class="text-[9px] text-amber-600 dark:text-amber-400 font-medium">active</span
                >
            {/if}
        </div>
        {#if replaceOpen}
            <ChevronDown class="size-3 text-muted-foreground" />
        {:else}
            <ChevronRight class="size-3 text-muted-foreground" />
        {/if}
    </button>
    {#if replaceOpen}
        <div class="px-3 py-2 space-y-2 border-t">
            <p class="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed">
                Replaces the <em>entire</em> default system prompt — tool descriptions, guidelines,
                working directory, and all. Prefer <strong>Custom Instructions</strong> above instead.
            </p>
            {#if editingReplace}
                <textarea
                    bind:value={editReplaceText}
                    class="w-full min-h-[120px] text-[11px] leading-relaxed font-mono bg-background border rounded px-2 py-1.5 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="Enter your full replacement system prompt here..."
                ></textarea>
                <div class="flex items-center justify-end gap-1.5">
                    <button
                        onclick={cancelEditReplace}
                        class="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-2 py-1 rounded hover:bg-muted"
                        disabled={saving}
                    >
                        <X class="size-3" />
                        Cancel
                    </button>
                    <button
                        onclick={saveReplacePrompt}
                        class="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors cursor-pointer px-2 py-1 rounded hover:bg-primary/10"
                        disabled={saving}
                    >
                        {#if saving}
                            <Spinner class="size-3" />
                        {:else}
                            <Save class="size-3" />
                        {/if}
                        Save
                    </button>
                </div>
            {:else if customSystemPrompt}
                <div class="space-y-2">
                    <pre
                        class="text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono text-foreground/80 max-h-[25vh] overflow-y-auto bg-muted/30 rounded p-2">{customSystemPrompt}</pre>
                    <div class="flex items-center justify-end gap-1.5">
                        <button
                            onclick={startEditReplace}
                            class="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-2 py-1 rounded hover:bg-muted"
                        >
                            <Pencil class="size-3" />
                            Edit
                        </button>
                        <button
                            onclick={clearReplacePrompt}
                            class="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive transition-colors cursor-pointer px-2 py-1 rounded hover:bg-muted"
                            disabled={saving}
                        >
                            <X class="size-3" />
                            Remove
                        </button>
                    </div>
                </div>
            {:else}
                <div class="flex items-center justify-center py-1">
                    <button
                        onclick={startEditReplace}
                        class="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-2 py-1 rounded hover:bg-muted"
                    >
                        <Plus class="size-3" />
                        Set replacement prompt
                    </button>
                </div>
            {/if}
        </div>
    {/if}
</div>

<!-- Effective system prompt (read-only) -->
<div class="rounded-lg border">
    <div class="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
        <span class="text-[11px] font-medium text-muted-foreground">
            Effective System Prompt
            {#if instructions.length > 0 || customSystemPrompt}
                <span class="text-amber-600 dark:text-amber-400 ml-1">(modified)</span>
            {/if}
        </span>
        <button
            onclick={copySystemPrompt}
            class="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Copy system prompt"
        >
            {#if systemPromptCopied}
                <Check class="size-3" />
                <span>Copied</span>
            {:else}
                <Copy class="size-3" />
                <span>Copy</span>
            {/if}
        </button>
    </div>
    <div class="p-3">
        <pre
            class="text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono text-foreground/80 max-h-[50vh] overflow-y-auto">{effectiveSystemPrompt}</pre>
    </div>
</div>
