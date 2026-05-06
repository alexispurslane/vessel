<script lang="ts">
    /**
     * @file Network access configuration card component.
     */
    import { Label } from "$lib/components/ui/label/index.js";
    import { Switch } from "$lib/components/ui/switch/index.js";
    import { Separator } from "$lib/components/ui/separator/index.js";
    import { TriStateToggle } from "$lib/components/ui/tri-state-toggle/index.js";
    import {
        PillList,
        PillKeyValueList,
        type PillItem,
        type KeyValueItem,
    } from "$lib/components/pill-list/index.js";

    interface Props {
        allowNetState: boolean | null;
        allowAllDomainsState: boolean | null;
        useCustomDomains: boolean;
        allowedDomains: PillItem[];
        useCustomSecrets: boolean;
        secrets: KeyValueItem[];
        onAllowNetChange: (value: boolean | null) => void;
        onAllowAllDomainsChange: (value: boolean | null) => void;
        onUseCustomDomainsChange: (value: boolean) => void;
        onAllowedDomainsChange: (items: PillItem[]) => void;
        onUseCustomSecretsChange: (value: boolean) => void;
        onSecretsChange: (items: KeyValueItem[]) => void;
    }

    let {
        allowNetState,
        allowAllDomainsState,
        useCustomDomains,
        allowedDomains,
        useCustomSecrets,
        secrets,
        onAllowNetChange,
        onAllowAllDomainsChange,
        onUseCustomDomainsChange,
        onAllowedDomainsChange,
        onUseCustomSecretsChange,
        onSecretsChange,
    }: Props = $props();
</script>

<div class="rounded-lg border p-3">
    <div class="space-y-2">
        <div>
            <Label class="text-sm font-medium">Network Access</Label>
            <p class="text-xs text-muted-foreground mt-0.5">
                {allowNetState === null
                    ? "Inheriting global"
                    : allowNetState
                      ? "Allowed"
                      : "Denied"}
            </p>
        </div>
        <TriStateToggle
            value={allowNetState}
            options={[
                { value: null, label: "Inherit" },
                { value: true, label: "Allow" },
                { value: false, label: "Deny" },
            ]}
            onChange={(v) => onAllowNetChange(v as boolean | null)}
        />
    </div>

    {#if allowNetState === true}
        <Separator class="my-2" />

        <div class="space-y-2">
            <div>
                <Label class="text-xs font-medium">Domain Access</Label>
                <p class="text-xs text-muted-foreground mt-0.5">
                    {allowAllDomainsState === null
                        ? "Inheriting global"
                        : allowAllDomainsState
                          ? "All domains"
                          : "Specific domains only"}
                </p>
            </div>
            <TriStateToggle
                value={allowAllDomainsState}
                options={[
                    { value: null, label: "Inherit" },
                    { value: true, label: "All Domains" },
                    { value: false, label: "Specific" },
                ]}
                onChange={(v) => onAllowAllDomainsChange(v as boolean | null)}
            />
        </div>

        {#if allowAllDomainsState === false}
            <div class="mt-2 space-y-2">
                <div class="flex items-center justify-between">
                    <div>
                        <Label class="text-xs font-medium">Allowed Domains</Label>
                        <p class="text-xs text-muted-foreground mt-0.5">
                            {useCustomDomains ? "Custom domains" : "Inheriting global"}
                        </p>
                    </div>
                    <Switch
                        checked={useCustomDomains}
                        onCheckedChange={(v: boolean) => onUseCustomDomainsChange(v)}
                    />
                </div>
                {#if useCustomDomains}
                    <PillList
                        items={allowedDomains}
                        labelKey="domain"
                        onChange={onAllowedDomainsChange}
                        addPlaceholder="example.com"
                        addButtonLabel="Add"
                        inputWidth="w-36"
                    />
                {/if}
            </div>
        {/if}

        <Separator class="my-3" />

        <div class="space-y-2">
            <div class="flex items-center justify-between">
                <div>
                    <Label class="text-xs font-medium">Secrets</Label>
                    <p class="text-xs text-muted-foreground mt-0.5">
                        {useCustomSecrets ? "Custom secrets" : "Inheriting global"}
                    </p>
                </div>
                <Switch
                    checked={useCustomSecrets}
                    onCheckedChange={(v: boolean) => onUseCustomSecretsChange(v)}
                />
            </div>
            {#if useCustomSecrets}
                <PillKeyValueList
                    items={secrets}
                    fields={[
                        {
                            key: "key",
                            placeholder: "KEY",
                            width: "w-20",
                            mono: true,
                        },
                        {
                            key: "value",
                            placeholder: "value",
                            width: "w-20",
                            type: "password",
                            viewDisplay: "mask",
                        },
                        {
                            key: "hosts",
                            placeholder: "hosts",
                            width: "w-20",
                            showInView: false,
                        },
                    ]}
                    onChange={onSecretsChange}
                    addButtonLabel="Add Secret"
                />
            {/if}
        </div>
    {/if}
</div>
