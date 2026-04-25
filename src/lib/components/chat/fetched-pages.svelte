<script lang="ts">
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import Globe from "@lucide/svelte/icons/globe";
    import type { FetchedPage } from "$lib/types.js";

    interface OgMetadata {
        title: string;
        siteName: string;
        image: string;
        favicon: string;
        url: string;
    }

    interface Props {
        pages: FetchedPage[];
    }

    let { pages }: Props = $props();

    // Cache OG metadata so we don't re-fetch on re-render
    const ogCache = new Map<string, OgMetadata>();
    let ogData = $state<Record<number, OgMetadata>>({});
    let loadingUrls = $state<Set<string>>(new Set());

    function extractDomain(url: string): string {
        try {
            return new URL(url).hostname.replace(/^www\./, "");
        } catch {
            return "";
        }
    }

    async function fetchOgMetadata(url: string, index: number) {
        if (ogCache.has(url)) {
            ogData[index] = ogCache.get(url)!;
            return;
        }
        if (loadingUrls.has(url)) return;

        loadingUrls.add(url);
        try {
            const resp = await fetch(`/api/og-metadata?url=${encodeURIComponent(url)}`);
            if (resp.ok) {
                const data: OgMetadata = await resp.json();
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
        } catch {
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
        }
    }

    // Fetch OG metadata for all pages when they change
    $effect(() => {
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            if (!ogData[i] && !ogCache.has(page.url)) {
                fetchOgMetadata(page.url, i);
            } else if (ogCache.has(page.url) && !ogData[i]) {
                ogData[i] = ogCache.get(page.url)!;
            }
        }
    });

    function getOg(index: number): OgMetadata | undefined {
        return ogData[index] ?? ogCache.get(pages[index]?.url);
    }
</script>

<details class="group rounded-lg border bg-background text-sm" open>
    <summary
        class="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-muted/50 transition-colors rounded-lg text-xs text-muted-foreground"
    >
        <Globe class="size-3" />
        <span class="font-medium">
            {#if pages.length === 1}
                1 Source
            {:else}
                {pages.length} Sources
            {/if}
        </span>
        <ChevronDown
            class="size-3 ml-auto shrink-0 transition-transform group-open:rotate-180"
        />
    </summary>
    <div class="border-t px-3 py-2 flex flex-col gap-1.5">
        {#each pages as page, i (page.url)}
            {@const og = getOg(i)}
            <a
                href={page.url}
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-2 text-xs hover:bg-muted/50 rounded-md px-2 py-1.5 transition-colors group/link"
            >
                {#if og?.favicon}
                    <img
                        src={og.favicon}
                        alt=""
                        class="size-4 shrink-0 rounded-sm"
                        onerror={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                {:else}
                    <Globe class="size-4 shrink-0 text-muted-foreground" />
                {/if}
                <span class="truncate text-foreground group-hover/link:underline">
                    {og?.title || page.title || extractDomain(page.url)}
                </span>
                <span class="shrink-0 text-muted-foreground">
                    ({extractDomain(page.url)})
                </span>
            </a>
        {/each}
    </div>
</details>
