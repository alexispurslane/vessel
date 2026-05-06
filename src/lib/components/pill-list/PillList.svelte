<script lang="ts">
    /**
     * @file Generic pill/tag list component.
     *
     * A reusable component that renders a list of editable "pills" (rounded badges).
     * Each pill can be edited inline or deleted. A "Add" button opens an inline input
     * for adding new items.
     *
     * The component is generic over the label key — pass `labelKey="domain"` if each
     * item is `{ domain: string, editing?: boolean }`, etc.
     */
    import { Button } from "$lib/components/ui/button/index.js";
    import Pencil from "@lucide/svelte/icons/pencil";
    import Trash2 from "@lucide/svelte/icons/trash-2";
    import Plus from "@lucide/svelte/icons/plus";
    import Check from "@lucide/svelte/icons/check";
    import X from "@lucide/svelte/icons/x";

    interface PillItem {
        editing?: boolean;
        [key: string]: unknown;
    }

    interface Props {
        /** The items to display. Each must have a string property named by `labelKey`. */
        items: PillItem[];
        /** The key on each item that holds the display string (e.g. "path", "domain", "name"). */
        labelKey: string;
        /** Callback when items change (full replacement). */
        onChange: (items: PillItem[]) => void;
        /** Placeholder text for the add/input field. */
        addPlaceholder?: string;
        /** Label for the add button (e.g. "Add Path", "Add Domain"). */
        addButtonLabel?: string;
        /** Width class for the input field (e.g. "w-48", "w-32"). */
        inputWidth?: string;
        /** Optional: font-mono for displayed values (default true). */
        mono?: boolean;
        /** Disabled state for the add button. */
        disabled?: boolean;
    }

    let {
        items,
        labelKey,
        onChange,
        addPlaceholder = "Add item...",
        addButtonLabel = "Add",
        inputWidth = "w-36",
        mono = true,
        disabled = false,
    }: Props = $props();

    // State for the "add new" form
    let showAddForm = $state(false);
    let newValue = $state("");

    function startEdit(index: number) {
        onChange(items.map((item, i) => ({ ...item, editing: i === index })));
    }

    function confirmEdit(index: number, value: string) {
        onChange(
            items.map((item, i) =>
                i === index
                    ? { ...item, [labelKey]: value, editing: false }
                    : { ...item, editing: false }
            )
        );
    }

    function cancelEdit(_index: number) {
        onChange(items.map((item) => ({ ...item, editing: false })));
    }

    function deleteItem(index: number) {
        onChange(items.filter((_, i) => i !== index));
    }

    function confirmAdd() {
        if (!newValue.trim()) return;
        onChange([
            ...items.map((item) => ({ ...item, editing: false })),
            { [labelKey]: newValue.trim(), editing: false },
        ]);
        newValue = "";
        showAddForm = false;
    }

    function cancelAdd() {
        newValue = "";
        showAddForm = false;
    }

    // Track the "edit" input value separately to avoid re-render issues
    let editValues = $state<Record<number, string>>({});
</script>

<div class="flex flex-wrap gap-2">
    {#each items as item, index (`${String(item[labelKey])}-${String(index)}`)}
        {#if item.editing}
            <div
                class="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-sm"
            >
                <input
                    type="text"
                    value={item[labelKey] as string}
                    placeholder={addPlaceholder}
                    class="{inputWidth} rounded border-0 bg-muted px-2 py-1 text-xs {mono
                        ? 'font-mono'
                        : ''} focus:ring-1 focus:ring-ring"
                    onfocus={(_e) => {
                        // Track the edit value locally
                        editValues[index] = item[labelKey] as string;
                    }}
                    oninput={(e) => {
                        editValues[index] = e.currentTarget.value;
                    }}
                    onkeydown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            confirmEdit(index, editValues[index] ?? (item[labelKey] as string));
                        } else if (e.key === "Escape") {
                            cancelEdit(index);
                        }
                    }}
                />
                <Button
                    size="sm"
                    variant="ghost"
                    class="h-5 w-5 rounded-full p-0"
                    onclick={() => {
                        confirmEdit(index, editValues[index] ?? (item[labelKey] as string));
                    }}
                >
                    <Check class="h-3 w-3" />
                </Button>
            </div>
        {:else}
            <div
                class="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-sm"
            >
                <span class={mono ? "font-mono text-xs" : "text-xs"}>{item[labelKey]}</span>
                <Button
                    size="sm"
                    variant="ghost"
                    class="h-5 w-5 rounded-full p-0"
                    onclick={() => {
                        startEdit(index);
                    }}
                >
                    <Pencil class="h-3 w-3" />
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    class="h-5 w-5 rounded-full p-0 text-destructive hover:text-destructive"
                    onclick={() => {
                        deleteItem(index);
                    }}
                >
                    <Trash2 class="h-3 w-3" />
                </Button>
            </div>
        {/if}
    {/each}

    {#if showAddForm}
        <div
            class="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-sm"
        >
            <input
                type="text"
                bind:value={newValue}
                placeholder={addPlaceholder}
                class="{inputWidth} rounded border-0 bg-muted px-2 py-1 text-xs {mono
                    ? 'font-mono'
                    : ''} focus:ring-1 focus:ring-ring"
                onkeydown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        confirmAdd();
                    } else if (e.key === "Escape") {
                        cancelAdd();
                    }
                }}
            />
            <Button
                size="sm"
                variant="ghost"
                class="h-5 w-5 rounded-full p-0"
                onclick={confirmAdd}
                disabled={!newValue.trim() || disabled}
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
            {disabled}
        >
            <Plus class="h-3.5 w-3.5 mr-1" />
            {addButtonLabel}
        </Button>
    {/if}
</div>
