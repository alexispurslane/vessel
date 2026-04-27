export { default as PillList } from "./PillList.svelte";
export { default as PathAutocompletePillList } from "./PathAutocompletePillList.svelte";
export { default as PillKeyValueList } from "./PillKeyValueList.svelte";

/** Item type for PillList – has an optional editing flag and arbitrary string-keyed values */
export interface PillItem {
    editing?: boolean;
    [key: string]: unknown;
}

/** Item type for PillKeyValueList – has an optional editing flag and arbitrary string-keyed values */
export interface KeyValueItem {
    editing?: boolean;
    [key: string]: unknown;
}
