<script lang="ts">
    import Clipboard from "@lucide/svelte/icons/clipboard";
    import Check from "@lucide/svelte/icons/check";
    import { highlightElement } from "@speed-highlight/core";

    interface Props {
        lang?: string;
        text?: string;
        /** Whether the parent message is still streaming. When true, syntax highlighting
         *  is deferred to avoid re-highlighting the entire block on every delta.
         *  Named codeStreaming (not streaming) to avoid collision with SvelteMarkdown's
         *  built-in streaming prop. */
        codeStreaming?: boolean;
    }

    let { lang = "", text = "", codeStreaming = false }: Props = $props();
    let copied = $state(false);
    let codeEl: HTMLDivElement | undefined = $state();

    /** Map markdown lang identifiers to speed-highlight language names */
    function mapLang(l: string): string {
        if (!l) return "";
        const lower = l.toLowerCase();
        // Common aliases: markdown lang -> speed-highlight lang
        const aliases: Record<string, string> = {
            javascript: "js",
            typescript: "ts",
            python: "py",
            rust: "rs",
            perl: "pl",
            makefile: "make",
            shell: "bash",
            zsh: "bash",
            markdown: "md",
            yaml: "yaml",
            toml: "toml",
            dockerfile: "docker",
        };
        return aliases[lower] ?? lower;
    }

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(text);
            copied = true;
            setTimeout(() => (copied = false), 2000);
        } catch {
            // Fallback
            const textarea = document.createElement("textarea");
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
            copied = true;
            setTimeout(() => (copied = false), 2000);
        }
    }

    // Re-highlight when text or lang changes — but skip while streaming to avoid
    // re-highlighting the entire growing code block on every delta. Once streaming
    // finishes, we highlight the complete block once.
    // Direct DOM manipulation is required here because @speed-highlight/core's
    // highlightElement() needs to read/modify className and textContent on the
    // raw DOM node. Svelte bindings can't replace this — the library operates on
    // the element directly.
    /* eslint-disable svelte/no-dom-manipulating */
    $effect(() => {
        if (!codeEl) return;
        const mapped = mapLang(lang);
        codeEl.className = mapped ? `shj-lang-${mapped}` : "shj-lang-plain";
        codeEl.textContent = text;
        if (!codeStreaming) {
            highlightElement(codeEl);
        }
    });
    /* eslint-enable svelte/no-dom-manipulating */
</script>

<div class="relative group/code rounded-lg overflow-hidden border bg-background my-3 max-w-[60ch]">
    {#if lang}
        <div
            class="flex items-center justify-between px-4 py-1.5 text-[11px] text-muted-foreground bg-muted/50 border-b"
        >
            <span class="font-medium">{lang}</span>
            <button
                onclick={handleCopy}
                class="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
                aria-label="Copy code"
            >
                {#if copied}
                    <Check class="size-3" />
                    <span>Copied!</span>
                {:else}
                    <Clipboard class="size-3" />
                    <span>Copy</span>
                {/if}
            </button>
        </div>
    {:else}
        <button
            onclick={handleCopy}
            class="absolute top-2 right-2 opacity-0 group-hover/code:opacity-100 transition-opacity inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground bg-muted/80 rounded px-1.5 py-0.5 cursor-pointer z-10"
            aria-label="Copy code"
        >
            {#if copied}
                <Check class="size-3" />
            {:else}
                <Clipboard class="size-3" />
            {/if}
        </button>
    {/if}
    <div class="shj-code-wrapper overflow-x-auto p-4 text-sm leading-relaxed font-mono">
        <div bind:this={codeEl}></div>
    </div>
</div>
