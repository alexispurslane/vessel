<script lang="ts">
    /**
     * @file Display panel for agent-fetched sources and search results.
     */
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import Globe from "@lucide/svelte/icons/globe";
    import Search from "@lucide/svelte/icons/search";
    import { SvelteMap, SvelteSet } from "svelte/reactivity";
    import { onMount } from "svelte";
    import type { FetchedSource } from "$lib/types.js";

    interface OgMetadata {
        title: string;
        siteName: string;
        image: string;
        favicon: string;
        url: string;
    }

    import type { SearchResultItem } from "$lib/types.js";

    interface Props {
        sources: FetchedSource[];
        onsearchclick?: (query: string, results: SearchResultItem[]) => void;
        onpageclick?: (url: string, title: string, content: string) => void;
    }

    let { sources, onsearchclick, onpageclick }: Props = $props();

    // Cache OG metadata so we don't re-fetch on re-render
    const ogCache = new SvelteMap<string, OgMetadata>();
    let ogData = $state<Record<number, OgMetadata>>({});
    let loadingUrls = new SvelteSet<string>();

    // Concurrency control: only 3 OG requests in flight at a time
    const MAX_CONCURRENT = 3;
    let activeRequests = 0;
    const pendingQueue: Array<{ url: string; index: number }> = [];

    // AbortController for cancelling in-flight requests on unmount
    let abortController = new AbortController();

    function extractDomain(url: string): string {
        try {
            return new URL(url).hostname.replace(/^www\./, "");
        } catch {
            return "";
        }
    }

    function processQueue() {
        while (activeRequests < MAX_CONCURRENT && pendingQueue.length > 0) {
            const item = pendingQueue.shift();
            if (item) {
                void fetchOgMetadata(item.url, item.index);
            }
        }
    }

    async function fetchOgMetadata(url: string, index: number) {
        if (ogCache.has(url)) {
            ogData[index] = ogCache.get(url) as OgMetadata;
            return;
        }
        if (loadingUrls.has(url)) return;

        // If at concurrency limit, queue the request
        if (activeRequests >= MAX_CONCURRENT) {
            pendingQueue.push({ url, index });
            return;
        }

        loadingUrls.add(url);
        activeRequests++;
        try {
            const resp = await fetch(`/api/og-metadata?url=${encodeURIComponent(url)}`, {
                signal: abortController.signal,
            });
            if (resp.ok) {
                const data = (await resp.json()) as OgMetadata;
                ogCache.set(url, data);
                ogData[index] = data;
            } else {
                const fallback: OgMetadata = {
                    title: extractDomain(url),
                    siteName: "",
                    image: "",
                    favicon: "",
                    url,
                };
                ogCache.set(url, fallback);
                ogData[index] = fallback;
            }
        } catch (e) {
            // Don't cache on abort — the component is being destroyed
            if (e instanceof DOMException && e.name === "AbortError") return;
            const fallback: OgMetadata = {
                title: extractDomain(url),
                siteName: "",
                image: "",
                favicon: "",
                url,
            };
            ogCache.set(url, fallback);
            ogData[index] = fallback;
        } finally {
            loadingUrls.delete(url);
            activeRequests--;
            processQueue();
        }
    }

    // Only pages need OG metadata — filter them by index
    const pageIndices = $derived(
        sources.map((s, i) => (s.type === "page" ? i : -1)).filter((i) => i >= 0)
    );

    // Determine the latest turn so we can dim sources from earlier turns
    const maxTurn = $derived(Math.max(...sources.map((s) => s.turn)));

    // Only fetch OG metadata for the current (latest) turn's sources.
    // Previous-turn sources are already dimmed and don't need the overhead.
    const currentPageIndices = $derived(pageIndices.filter((i) => sources[i].turn === maxTurn));

    // Fetch OG metadata for current-turn page sources when they change
    $effect(() => {
        for (const i of currentPageIndices) {
            const source = sources[i];
            if (source.type !== "page") continue;
            if (!(i in ogData) && !ogCache.has(source.url)) {
                void fetchOgMetadata(source.url, i);
            } else if (ogCache.has(source.url) && !(i in ogData)) {
                ogData[i] = ogCache.get(source.url) as OgMetadata;
            }
        }
    });

    // Cancel all in-flight OG requests on unmount
    onMount(() => {
        return () => {
            abortController.abort();
        };
    });

    function getOg(index: number): OgMetadata | undefined {
        return ogData[index] ?? ogCache.get((sources[index] as { url: string }).url);
    }

    function truncateTitle(title: string): string {
        if (title.length <= 50) return title;
        return title.slice(0, 50) + "…";
    }
</script>

<details class="group rounded-lg border bg-background text-sm w-full overflow-hidden" open>
    <summary
        class="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-muted/50 transition-colors rounded-lg text-xs text-muted-foreground"
    >
        <Globe class="size-3" />
        <span class="font-medium">
            {#if sources.length === 1}
                1 Source
            {:else}
                {sources.length} Sources
            {/if}
        </span>
        <ChevronDown class="size-3 ml-auto shrink-0 transition-transform group-open:rotate-180" />
    </summary>
    <div class="border-t px-3 py-2 flex flex-col gap-1.5">
        {#each sources as source, i (i)}
            {@const isPreviousTurn = source.turn < maxTurn}
            {#if source.type === "page"}
                {@const og = getOg(i)}
                <button
                    class="flex items-center gap-2 text-xs hover:bg-muted/50 rounded-md px-2 py-1.5 transition-colors group/link min-w-0 overflow-hidden w-full text-left cursor-pointer {isPreviousTurn
                        ? 'opacity-40'
                        : ''}"
                    onclick={() =>
                        onpageclick?.(source.url, og?.title || source.title, source.content)}
                >
                    {#if og?.favicon}
                        <img
                            src={og.favicon}
                            alt=""
                            class="size-4 shrink-0 rounded-sm"
                            onerror={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                            }}
                        />
                    {:else}
                        <Globe class="size-4 shrink-0 text-muted-foreground" />
                    {/if}
                    <span class="text-foreground group-hover/link:underline">
                        {truncateTitle(og?.title || source.title || extractDomain(source.url))}
                    </span>
                    <span class="shrink-0 text-muted-foreground">
                        ({extractDomain(source.url)})
                    </span>
                </button>
            {:else if source.type === "search"}
                <button
                    class="flex items-center gap-2 text-xs hover:bg-muted/50 rounded-md px-2 py-1.5 transition-colors group/search min-w-0 overflow-hidden w-full text-left cursor-pointer {isPreviousTurn
                        ? 'opacity-40'
                        : ''}"
                    onclick={() => onsearchclick?.(source.query, source.results)}
                >
                    <Search class="size-4 shrink-0 text-muted-foreground" />
                    <span class="text-foreground group-hover/search:underline">
                        "{truncateTitle(source.query)}"
                    </span>
                    <span class="shrink-0 text-muted-foreground">
                        ({source.resultCount}
                        {source.resultCount === 1 ? "result" : "results"})
                    </span>
                </button>
            {/if}
        {/each}
    </div>
</details>
