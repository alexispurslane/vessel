<script lang="ts">
    /**
     * @file Pill list for key-value pair entries.
     *
     * A reusable component that renders a list of editable "pills" (rounded badges)
     * where each pill has multiple key-value fields (e.g. key, value, hosts for secrets).
     *
     * Unlike PillList which is generic over a single labelKey, this component supports
     * items with multiple configurable fields, making it ideal for secrets and similar
     * key-value data structures.
     */
    import { Button } from "$lib/components/ui/button/index.js";
    import Pencil from "@lucide/svelte/icons/pencil";
    import Trash2 from "@lucide/svelte/icons/trash-2";
    import Plus from "@lucide/svelte/icons/plus";
    import Check from "@lucide/svelte/icons/check";
    import X from "@lucide/svelte/icons/x";

    interface KeyValueItem {
        editing?: boolean;
        [key: string]: unknown;
    }

    interface FieldDef {
        /** The key on each item that holds the field value. */
        key: string;
        /** Placeholder text for the input. */
        placeholder: string;
        /** Width class for the input (e.g. "w-24"). */
        width?: string;
        /** Input type — use "password" for sensitive fields. */
        // oxlint-disable-next-line secure-coding/no-hardcoded-credentials -- 'password' is an HTML input type, not a credential
        type?: "text" | "password";
        /** Whether to display this field in the non-editing pill view. */
        showInView?: boolean;
        /** How to display the field in the non-editing pill view. "mask" shows •••, "value" shows the raw value. */
        viewDisplay?: "mask" | "value";
        /** Font mono for the input. */
        mono?: boolean;
    }

    interface Props {
        /** The items to display. Each must have string properties named by field keys. */
        items: KeyValueItem[];
        /** Field definitions for the multiple fields per item. */
        fields: FieldDef[];
        /** Callback when items change (full replacement). */
        onChange: (items: KeyValueItem[]) => void;
        /** Label for the add button. */
        addButtonLabel?: string;
        /** Disabled state for the add button. */
        disabled?: boolean;
    }

    let { items, fields, onChange, addButtonLabel = "Add", disabled = false }: Props = $props();

    // State for the "add new" form
    let showAddForm = $state(false);
    let newValues = $state<Record<string, string>>({});

    // Track the "edit" input values separately to avoid focus-stealing re-renders
    let editValues = $state<Record<number, Record<string, string>>>({});

    function startEdit(index: number) {
        const item = items[index];
        const currentValues: Record<string, string> = {};
        for (const field of fields) {
            currentValues[field.key] = item[field.key] as string;
        }
        editValues[index] = currentValues;
        onChange(items.map((item, i) => ({ ...item, editing: i === index })));
    }

    function confirmEdit(index: number) {
        const vals = editValues[index];
        const updated = { ...items[index] };
        for (const field of fields) {
            updated[field.key] = vals[field.key];
        }
        updated.editing = false;
        onChange(items.map((item, i) => (i === index ? updated : { ...item, editing: false })));
        Reflect.deleteProperty(editValues, index);
    }

    function cancelEdit(_index: number) {
        onChange(items.map((item) => ({ ...item, editing: false })));
        Reflect.deleteProperty(editValues, _index);
    }

    function deleteItem(index: number) {
        Reflect.deleteProperty(editValues, index);
        onChange(items.filter((_, i) => i !== index));
    }

    function confirmAdd() {
        const newItem: KeyValueItem = { editing: false };
        let hasRequired = true;
        for (const field of fields) {
            const val = newValues[field.key].trim();
            // First field and second field are required (key + value)
            if ((field === fields[0] || field === fields[1]) && !val) {
                hasRequired = false;
            }
            newItem[field.key] = val;
        }
        if (!hasRequired) return;
        onChange([...items.map((item) => ({ ...item, editing: false })), newItem]);
        newValues = {};
        showAddForm = false;
    }

    function cancelAdd() {
        newValues = {};
        showAddForm = false;
    }
</script>

<div class="flex flex-wrap gap-2">
    {#each items as item, index (`${String(item[fields[0].key])}-${String(index)}`)}
        {#if item.editing}
            <div
                class="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-sm"
            >
                {#each fields as field (field.key)}
                    <input
                        type={field.type ?? "text"}
                        class="{field.width ??
                            'w-24'} rounded border-0 bg-muted px-2 py-1 text-xs {field.mono !==
                        false
                            ? 'font-mono'
                            : ''} focus:ring-1 focus:ring-ring"
                        placeholder={field.placeholder}
                        value={editValues[index][field.key] ?? item[field.key]}
                        oninput={(e) => {
                            if (!(index in editValues)) {
                                const vals: Record<string, string> = {};
                                for (const f of fields) {
                                    vals[f.key] = item[f.key] as string;
                                }
                                editValues[index] = vals;
                            }
                            editValues[index][field.key] = e.currentTarget.value;
                        }}
                        onkeydown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                confirmEdit(index);
                            } else if (e.key === "Escape") {
                                cancelEdit(index);
                            }
                        }}
                    />
                {/each}
                <Button
                    variant="ghost"
                    size="icon"
                    class="h-5 w-5"
                    onclick={() => {
                        confirmEdit(index);
                    }}
                >
                    <Check class="h-3 w-3" />
                </Button>
            </div>
        {:else}
            <div
                class="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-sm"
            >
                {#each fields as field, fieldIndex (field.key)}
                    {#if field.showInView !== false}
                        {#if fieldIndex > 0 && fields
                                .filter((f) => f.showInView !== false)
                                .includes(field) && fields.filter((f) => f.showInView !== false)[0] !== field}
                            {#if fieldIndex === 1}
                                <span class="text-muted-foreground">=</span>
                            {/if}
                        {/if}
                        {#if field.viewDisplay === "mask"}
                            <span class="font-mono text-muted-foreground text-xs">•••</span>
                        {:else}
                            <span
                                class="font-mono {fieldIndex === 0
                                    ? 'font-medium'
                                    : 'text-muted-foreground'} text-xs">{item[field.key]}</span
                            >
                        {/if}
                    {/if}
                {/each}
                {#each fields as field (field.key)}
                    {#if field.showInView === false && item[field.key]}
                        <span class="text-xs text-muted-foreground">({item[field.key]})</span>
                    {/if}
                {/each}
                <Button
                    variant="ghost"
                    size="icon"
                    class="h-5 w-5"
                    onclick={() => {
                        startEdit(index);
                    }}
                >
                    <Pencil class="h-3 w-3" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    class="h-5 w-5"
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
            {#each fields as field (field.key)}
                <input
                    type={field.type ?? "text"}
                    class="{field.width ??
                        'w-24'} rounded border-0 bg-muted px-2 py-1 text-xs {field.mono !== false
                        ? 'font-mono'
                        : ''} focus:ring-1 focus:ring-ring"
                    placeholder={field.placeholder}
                    value={newValues[field.key]}
                    oninput={(e) => {
                        newValues[field.key] = e.currentTarget.value;
                    }}
                    onkeydown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            confirmAdd();
                        } else if (e.key === "Escape") {
                            cancelAdd();
                        }
                    }}
                />
            {/each}
            <Button variant="ghost" size="icon" class="h-5 w-5" onclick={confirmAdd} {disabled}>
                <Check class="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" class="h-5 w-5" onclick={cancelAdd}>
                <X class="h-3 w-3" />
            </Button>
        </div>
    {:else}
        <Button
            variant="outline"
            size="sm"
            class="h-7 rounded-full"
            onclick={() => (showAddForm = true)}
            {disabled}
        >
            <Plus class="h-3.5 w-3.5 mr-1" />
            {addButtonLabel}
        </Button>
    {/if}
</div>
