<script lang="ts">
    import ExternalLink from "@lucide/svelte/icons/external-link";
    import X from "@lucide/svelte/icons/x";
    import Search from "@lucide/svelte/icons/search";
    import Calendar from "@lucide/svelte/icons/calendar";
    import { Streamdown } from "svelte-streamdown";
    import MathComponent from "svelte-streamdown/math";
    import MermaidComponent from "svelte-streamdown/mermaid";
    import { type DeepPartialTheme } from "$lib/types/theme.js";
    import type { SearchResultItem } from "$lib/types.js";

    interface Props {
        query: string;
        results: SearchResultItem[];
        onclose: () => void;
        onresultclick?: (url: string, title: string, content: string) => void;
    }

    let { query, results, onclose, onresultclick }: Props = $props();

    /** Theme override for side-panel content — compact "peripheral interface info" style */
    const searchResultTheme: DeepPartialTheme = {
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

    function extractDomain(url: string): string {
        try {
            return new URL(url).hostname.replace(/^www\./, "");
        } catch {
            return "";
        }
    }

    function formatDate(dateStr?: string): string {
        if (!dateStr) return "";
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
            });
        } catch {
            return dateStr;
        }
    }
</script>

<div class="flex flex-col h-full pt-9">
    <!-- Header -->
    <div class="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <Search class="size-4 shrink-0 text-muted-foreground" />
        <div class="min-w-0 flex-1">
            <h3 class="text-sm font-medium truncate">
                "{query}"
            </h3>
            <p class="text-xs text-muted-foreground">
                {results.length}
                {results.length === 1 ? "result" : "results"}
            </p>
        </div>
        <button
            class="shrink-0 p-1 rounded-md hover:bg-muted/50 transition-colors"
            onclick={onclose}
        >
            <X class="size-4 text-muted-foreground" />
        </button>
    </div>

    <!-- Results list -->
    <div class="flex-1 overflow-y-auto">
        {#each results as result, i}
            <div class="border-b last:border-b-0">
                <button
                    class="flex flex-col gap-1 px-3 py-2.5 hover:bg-muted/30 transition-colors w-full text-left cursor-pointer"
                    onclick={() =>
                        onresultclick?.(result.url, result.title || "Untitled", result.text || "")}
                >
                    <!-- Title row -->
                    <div class="flex items-start gap-1.5 group/result">
                        <ExternalLink
                            class="size-3.5 shrink-0 mt-0.5 text-blue-500 dark:text-blue-400 group-hover/result:text-blue-600 dark:group-hover/result:text-blue-300 transition-colors"
                        />
                        <span
                            class="text-sm font-medium text-blue-600 dark:text-blue-400 group-hover/result:underline leading-snug flex-1 min-w-0"
                        >
                            {result.title || "Untitled"}
                        </span>
                    </div>

                    <!-- URL -->
                    <span class="text-xs text-muted-foreground truncate">
                        {extractDomain(result.url)}
                    </span>

                    <!-- Published date -->
                    {#if result.publishedDate}
                        <div class="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar class="size-3" />
                            <span>{formatDate(result.publishedDate)}</span>
                        </div>
                    {/if}

                    <!-- Text excerpt -->
                    {#if result.text}
                        <div class="text-muted-foreground line-clamp-3">
                            <Streamdown
                                content={result.text}
                                baseTheme="shadcn"
                                theme={searchResultTheme}
                                parseIncompleteMarkdown={false}
                                components={{ math: MathComponent, mermaid: MermaidComponent }}
                            />
                        </div>
                        <span
                            class="text-xs text-muted-foreground hover:text-foreground transition-colors self-start"
                        >
                            See more
                        </span>
                    {/if}
                </button>
            </div>
        {/each}

        {#if results.length === 0}
            <div class="flex items-center justify-center py-8">
                <p class="text-sm text-muted-foreground">No results found</p>
            </div>
        {/if}
    </div>
</div>
