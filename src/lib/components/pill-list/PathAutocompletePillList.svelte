<script lang="ts">
    /**
     * A pill list specialized for filesystem paths, with:
     * - Path autocomplete via the /api/fs-complete endpoint
     * - Keyboard navigation (ArrowUp/Down, Tab, Enter, Escape) in the autocomplete dropdown
     * - Inline editing of existing pills with the same autocomplete support
     *
     * Avoids the focus-stealing bug by tracking edit input values locally
     * instead of mutating the items array on every keystroke.
     */
    import { Button } from "$lib/components/ui/button/index.js";
    import { fsComplete } from "$lib/api.js";
    import Pencil from "@lucide/svelte/icons/pencil";
    import Trash2 from "@lucide/svelte/icons/trash-2";
    import Plus from "@lucide/svelte/icons/plus";
    import Check from "@lucide/svelte/icons/check";
    import X from "@lucide/svelte/icons/x";

    interface PathItem {
        path: string;
        editing?: boolean;
    }

    interface Props {
        /** The path items to display. */
        items: PathItem[];
        /** Callback when items change (full replacement). */
        onChange: (items: PathItem[]) => void;
        /** Placeholder text for the add/input field. */
        addPlaceholder?: string;
        /** Label for the add button. */
        addButtonLabel?: string;
    }

    let {
        items,
        onChange,
        addPlaceholder = "/path/to/directory",
        addButtonLabel = "Add Path",
    }: Props = $props();

    // --- "Add new" form state ---
    let showAddForm = $state(false);
    let newValue = $state("");
    let addCompletions = $state<string[]>([]);
    let showAddCompletions = $state(false);
    let addSelectedIndex = $state(-1);

    // --- Edit form state (tracked by index to avoid re-render) ---
    let editValues = $state<Record<number, string>>({});
    let editCompletions = $state<Record<number, string[]>>({});
    let editShowCompletions = $state<Record<number, boolean>>({});
    let editSelectedIndex = $state<Record<number, number>>({});

    // --- Helpers ---
    async function fetchCompletions(partial: string): Promise<string[]> {
        if (!partial || partial.length < 2) return [];
        try {
            const result = await fsComplete(partial, "directory");
            return result.completions;
        } catch {
            return [];
        }
    }

    function startEdit(index: number) {
        onChange(items.map((item, i) => ({ ...item, editing: i === index })));
        editValues[index] = items[index].path;
        editCompletions[index] = [];
        editShowCompletions[index] = false;
        editSelectedIndex[index] = -1;
    }

    function confirmEdit(index: number) {
        const value = editValues[index] ?? items[index].path;
        onChange(
            items.map((item, i) =>
                i === index ? { path: value, editing: false } : { ...item, editing: false }
            )
        );
        cleanupEdit(index);
    }

    function cancelEdit(index: number) {
        onChange(
            items.map((item, i) =>
                i === index ? { ...item, editing: false } : { ...item, editing: false }
            )
        );
        cleanupEdit(index);
    }

    function cleanupEdit(index: number) {
        delete editValues[index];
        delete editCompletions[index];
        delete editShowCompletions[index];
        delete editSelectedIndex[index];
    }

    function deleteItem(index: number) {
        onChange(items.filter((_, i) => i !== index));
    }

    function confirmAdd() {
        if (!newValue.trim()) return;
        onChange([
            ...items.map((item) => ({ ...item, editing: false })),
            { path: newValue.trim(), editing: false },
        ]);
        newValue = "";
        showAddForm = false;
        addCompletions = [];
        showAddCompletions = false;
        addSelectedIndex = -1;
    }

    function cancelAdd() {
        newValue = "";
        showAddForm = false;
        addCompletions = [];
        showAddCompletions = false;
        addSelectedIndex = -1;
    }

    // --- Keyboard handlers ---
    function handleEditKeydown(index: number, e: KeyboardEvent) {
        const completions = editCompletions[index] ?? [];
        const show = editShowCompletions[index] ?? false;
        const sel = editSelectedIndex[index] ?? -1;

        if (e.key === "ArrowDown" && show && completions.length > 0) {
            e.preventDefault();
            editSelectedIndex[index] = (sel + 1) % completions.length;
        } else if (e.key === "ArrowUp" && show && completions.length > 0) {
            e.preventDefault();
            editSelectedIndex[index] = sel <= 0 ? completions.length - 1 : sel - 1;
        } else if (e.key === "Tab" && show && sel >= 0) {
            e.preventDefault();
            editValues[index] = completions[sel];
            editSelectedIndex[index] = -1;
            editShowCompletions[index] = false;
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (show && sel >= 0) {
                editValues[index] = completions[sel];
                editSelectedIndex[index] = -1;
                editShowCompletions[index] = false;
            } else {
                confirmEdit(index);
            }
        } else if (e.key === "Escape") {
            if (show) {
                editShowCompletions[index] = false;
                editSelectedIndex[index] = -1;
            } else {
                cancelEdit(index);
            }
        }
    }

    async function handleEditInput(index: number, value: string) {
        editValues[index] = value;
        editSelectedIndex[index] = -1;
        const completions = await fetchCompletions(value);
        editCompletions[index] = completions;
        editShowCompletions[index] = completions.length > 0;
    }

    function handleAddKeydown(e: KeyboardEvent) {
        if (e.key === "ArrowDown" && showAddCompletions && addCompletions.length > 0) {
            e.preventDefault();
            addSelectedIndex = (addSelectedIndex + 1) % addCompletions.length;
        } else if (e.key === "ArrowUp" && showAddCompletions && addCompletions.length > 0) {
            e.preventDefault();
            addSelectedIndex =
                addSelectedIndex <= 0 ? addCompletions.length - 1 : addSelectedIndex - 1;
        } else if (e.key === "Tab" && showAddCompletions && addSelectedIndex >= 0) {
            e.preventDefault();
            newValue = addCompletions[addSelectedIndex];
            addSelectedIndex = -1;
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (showAddCompletions && addSelectedIndex >= 0) {
                newValue = addCompletions[addSelectedIndex];
                addSelectedIndex = -1;
                showAddCompletions = false;
            } else {
                confirmAdd();
            }
        } else if (e.key === "Escape") {
            if (showAddCompletions) {
                showAddCompletions = false;
                addSelectedIndex = -1;
            } else {
                cancelAdd();
            }
        }
    }

    async function handleAddInput(value: string) {
        newValue = value;
        addSelectedIndex = -1;
        addCompletions = await fetchCompletions(value);
        showAddCompletions = addCompletions.length > 0;
    }
</script>

<div class="flex flex-wrap gap-2">
    {#each items as item, index (item.path + "-" + index)}
        {#if item.editing}
            <div
                class="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-sm relative"
            >
                <input
                    type="text"
                    value={editValues[index] ?? item.path}
                    placeholder={addPlaceholder}
                    class="w-48 rounded border-0 bg-muted px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-ring"
                    oninput={(e) => handleEditInput(index, e.currentTarget.value)}
                    onkeydown={(e) => handleEditKeydown(index, e)}
                />
                {#if (editShowCompletions[index] ?? false) && (editCompletions[index] ?? []).length > 0}
                    <div
                        class="absolute top-full left-0 mt-1 w-56 max-h-32 overflow-auto rounded border bg-popover shadow-lg z-50"
                    >
                        {#each editCompletions[index] ?? [] as completion, idx (completion)}
                            <button
                                type="button"
                                class="w-full px-2 py-1 text-left text-xs font-mono hover:bg-muted {idx ===
                                (editSelectedIndex[index] ?? -1)
                                    ? 'bg-muted'
                                    : ''}"
                                onmouseenter={() => (editSelectedIndex[index] = idx)}
                                onclick={() => {
                                    editValues[index] = completion;
                                    editShowCompletions[index] = false;
                                    editSelectedIndex[index] = -1;
                                }}
                            >
                                {completion}
                            </button>
                        {/each}
                    </div>
                {/if}
                <Button
                    size="sm"
                    variant="ghost"
                    class="h-5 w-5 rounded-full p-0"
                    onclick={() => confirmEdit(index)}
                >
                    <Check class="h-3 w-3" />
                </Button>
            </div>
        {:else}
            <div
                class="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-sm"
            >
                <span class="font-mono text-xs">{item.path}</span>
                <Button
                    size="sm"
                    variant="ghost"
                    class="h-5 w-5 rounded-full p-0"
                    onclick={() => startEdit(index)}
                >
                    <Pencil class="h-3 w-3" />
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    class="h-5 w-5 rounded-full p-0 text-destructive hover:text-destructive"
                    onclick={() => deleteItem(index)}
                >
                    <Trash2 class="h-3 w-3" />
                </Button>
            </div>
        {/if}
    {/each}

    {#if showAddForm}
        <div
            class="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-sm relative"
        >
            <input
                type="text"
                value={newValue}
                placeholder={addPlaceholder}
                class="w-48 rounded border-0 bg-muted px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-ring"
                oninput={(e) => handleAddInput(e.currentTarget.value)}
                onkeydown={handleAddKeydown}
            />
            {#if showAddCompletions && addCompletions.length > 0}
                <div
                    class="absolute top-full left-0 mt-1 w-56 max-h-32 overflow-auto rounded border bg-popover shadow-lg z-50"
                >
                    {#each addCompletions as completion, idx (completion)}
                        <button
                            type="button"
                            class="w-full px-2 py-1 text-left text-xs font-mono hover:bg-muted {idx ===
                            addSelectedIndex
                                ? 'bg-muted'
                                : ''}"
                            onmouseenter={() => (addSelectedIndex = idx)}
                            onclick={() => {
                                newValue = completion;
                                showAddCompletions = false;
                                addSelectedIndex = -1;
                            }}
                        >
                            {completion}
                        </button>
                    {/each}
                </div>
            {/if}
            <Button
                size="sm"
                variant="ghost"
                class="h-5 w-5 rounded-full p-0"
                onclick={confirmAdd}
                disabled={!newValue.trim()}
            >
                <Check class="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" class="h-5 w-5 rounded-full p-0" onclick={cancelAdd}>
                <X class="h-3 w-3" />
            </Button>
        </div>
    {:else}
        <Button
            size="sm"
            variant="outline"
            class="rounded-full h-8 px-3"
            onclick={() => (showAddForm = true)}
        >
            <Plus class="h-3.5 w-3.5 mr-1" />
            {addButtonLabel}
        </Button>
    {/if}
</div>
