<script lang="ts">
    /**
     * @file Keyboard shortcuts help overlay — shows all available shortcuts in a dialog.
     */
    import {
        Dialog,
        DialogContent,
        DialogHeader,
        DialogTitle,
        DialogDescription,
    } from "$lib/components/ui/dialog/index.js";
    import { Kbd, KbdGroup } from "$lib/components/ui/kbd/index.js";
    import {
        SHORTCUTS,
        SHORTCUT_EVENT_TYPE,
        type ShortcutEventDetail,
    } from "$lib/utils/keyboard.js";
    import { onMount } from "svelte";

    let open = $state(false);

    onMount(() => {
        function onShortcut(e: CustomEvent<ShortcutEventDetail>) {
            if (e.detail.action === "shortcuts-help") {
                open = !open;
            }
        }
        window.addEventListener(SHORTCUT_EVENT_TYPE, onShortcut as EventListener);
        return () => window.removeEventListener(SHORTCUT_EVENT_TYPE, onShortcut as EventListener);
    });

    /**
     * Parse a shortcut label like "⌘K" or "⌘⇧C" into individual key symbols.
     * @param label - The shortcut label string to parse
     * @returns An array of individual key symbol strings
     */
    function parseKeys(label: string): string[] {
        const keys: string[] = [];
        let i = 0;
        while (i < label.length) {
            const code = label.codePointAt(i)!;
            if (code > 0xffff) {
                // 4-byte char (e.g. ⌘ = U+2318)
                keys.push(String.fromCodePoint(code));
                i += 2;
            } else {
                keys.push(label[i]!);
                i += 1;
            }
        }
        return keys;
    }
</script>

<Dialog bind:open>
    <DialogContent class="sm:max-w-md">
        <DialogHeader>
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
            <DialogDescription>All available keyboard shortcuts in Vessel</DialogDescription>
        </DialogHeader>
        <div class="space-y-1">
            {#each SHORTCUTS as shortcut (shortcut.action)}
                <div class="flex items-center justify-between py-1.5">
                    <span class="text-sm">{shortcut.description}</span>
                    <KbdGroup>
                        {#each parseKeys(shortcut.label) as key}
                            <Kbd>{key}</Kbd>
                        {/each}
                    </KbdGroup>
                </div>
            {/each}

            <div class="pt-2 mt-2 border-t">
                <p class="text-xs text-muted-foreground mb-2">Sidebar shortcuts</p>
                <div class="flex items-center justify-between py-1.5">
                    <span class="text-sm">Search conversations</span>
                    <KbdGroup>
                        <Kbd>⌘</Kbd>
                        <Kbd>F</Kbd>
                    </KbdGroup>
                </div>
                <div class="flex items-center justify-between py-1.5">
                    <span class="text-sm">Navigate conversations</span>
                    <KbdGroup>
                        <Kbd>↑</Kbd>
                        <Kbd>↓</Kbd>
                    </KbdGroup>
                </div>
                <div class="flex items-center justify-between py-1.5">
                    <span class="text-sm">Open selected conversation</span>
                    <KbdGroup>
                        <Kbd>↵</Kbd>
                    </KbdGroup>
                </div>
            </div>
        </div>
    </DialogContent>
</Dialog>
