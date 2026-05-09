<script lang="ts">
    /**
     * @file Panel showing fetched page metadata.
     */

    /* eslint-disable svelte/no-navigation-without-resolve -- this component renders external URLs, not SvelteKit routes */
    import ExternalLink from "@lucide/svelte/icons/external-link";
    import X from "@lucide/svelte/icons/x";
    import Globe from "@lucide/svelte/icons/globe";
    import { Streamdown } from "svelte-streamdown";
    import MathComponent from "svelte-streamdown/math";
    import MermaidComponent from "svelte-streamdown/mermaid";
    import { type DeepPartialTheme } from "$lib/types/theme.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area";

    interface Props {
        url: string;
        title: string;
        content: string;
        onclose: () => void;
    }

    let { url, title, content, onclose }: Props = $props();

    function extractDomain(url: string): string {
        try {
            return new URL(url).hostname.replace(/^www\./, "");
        } catch {
            return "";
        }
    }

    /** Theme override for side-panel content — compact "peripheral interface info" style */
    const pageContentTheme: DeepPartialTheme = {
        h1: { base: "mt-3 mb-1.5 text-sm font-bold tracking-tight" },
        h2: { base: "mt-3 mb-1.5 text-sm font-bold tracking-tight" },
        h3: { base: "mt-2 mb-1 text-xs font-semibold" },
        h4: { base: "mt-2 mb-1 text-xs font-semibold" },
        h5: { base: "mt-1.5 mb-1 text-[0.6875rem] font-semibold text-muted-foreground" },
        h6: { base: "mt-1.5 mb-1 text-[0.6875rem] font-semibold text-muted-foreground" },
        paragraph: { base: "text-xs leading-[1.7] mb-2.5" },
        ul: { base: "pl-6 list-outside list-disc text-xs mb-2.5" },
        ol: { base: "pl-6 list-outside text-xs mb-2.5" },
        li: { base: "py-0.5" },
        blockquote: {
            base: "my-2 border-l-2 pl-3 italic text-xs text-muted-foreground",
        },
        strong: { base: "font-semibold" },
        em: { base: "italic" },
        del: { base: "text-muted-foreground line-through" },
        link: {
            base: "underline wrap-anywhere font-medium hover:text-foreground/80",
        },
        codespan: {
            base: "bg-muted px-1 py-0.5 rounded font-mono text-[0.85em]",
        },
        hr: { base: "border-border my-3" },
        table: {
            base: "overflow-x-auto max-w-full my-2 rounded-lg border border-border",
        },
        thead: { base: "bg-muted/50" },
        tr: { base: "border-border border-b" },
        th: { base: "px-2 py-1.5 text-xs font-semibold min-w-0" },
        td: { base: "px-2 py-1.5 text-xs min-w-0 break-words" },
        code: {
            base: "my-2 w-full overflow-hidden rounded-lg border border-border flex flex-col max-w-full text-[0.8rem]",
        },
    };
</script>

<div class="flex flex-col h-full pt-9">
    <!-- Header -->
    <div class="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <Globe class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div class="min-w-0 flex-1">
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                class="text-sm font-medium text-foreground hover:underline truncate block"
            >
                {title || extractDomain(url)}
            </a>
            <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span class="truncate">{extractDomain(url)}</span>
                <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-0.5 hover:text-foreground transition-colors shrink-0"
                    aria-label="Open original page in new tab"
                >
                    <ExternalLink class="size-3" aria-hidden="true" />
                </a>
            </div>
        </div>
        <button
            class="shrink-0 p-1 rounded-md hover:bg-muted/50 transition-colors"
            onclick={onclose}
            aria-label="Close page panel"
        >
            <X class="size-4 text-muted-foreground" />
        </button>
    </div>

    <!-- Content -->
    <ScrollArea class="flex-1 min-h-0">
        <div class="px-4 py-3">
            <Streamdown
                {content}
                baseTheme="shadcn"
                theme={pageContentTheme}
                parseIncompleteMarkdown={false}
                components={{ math: MathComponent, mermaid: MermaidComponent }}
            >
                {#snippet code({ token })}
                    <pre
                        class="my-1 overflow-x-auto rounded-md border border-border bg-muted/50 p-2 text-xs">
                        <code>{(token as { text: string }).text}</code>
                    </pre>
                {/snippet}
            </Streamdown>
        </div>
    </ScrollArea>
</div>
