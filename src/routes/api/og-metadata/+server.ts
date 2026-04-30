/**
 * GET /api/og-metadata?url=...
 *
 * Fetches OpenGraph metadata for a URL. Used by the FetchedPages component
 * to show page titles and favicons for sources the agent looked up.
 *
 * Returns JSON: { title, siteName, image, favicon, url }
 */
import { json } from "@sveltejs/kit";
import { badRequest, tryApi } from "$lib/server/api-errors.js";

// Timeout for fetching external pages (ms)
const FETCH_TIMEOUT = 8000;

// Cache OG metadata for 10 minutes to avoid re-fetching the same URL
const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map<string, { data: Record<string, string>; expires: number }>();

interface OgResult {
    title: string;
    siteName: string;
    image: string;
    favicon: string;
    url: string;
}

function extractFavicon(html: string, pageUrl: URL): string {
    // Look for <link rel="icon" ...> or <link rel="shortcut icon" ...>
    const iconPatterns = [
        /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i,
        /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i,
    ];
    for (const pattern of iconPatterns) {
        const match = html.match(pattern);
        if (match?.[1]) {
            try {
                return new URL(match[1], pageUrl).href;
            } catch {
                continue;
            }
        }
    }
    // Default to /favicon.ico
    try {
        return new URL("/favicon.ico", pageUrl).href;
    } catch {
        return "";
    }
}

function extractOgField(html: string, property: string): string {
    // og:XXX can appear as <meta property="og:XXX" content="..."> or
    // <meta content="..." property="og:XXX">
    const re1 = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*?)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*?)["'][^>]+property=["']${property}["']`, "i");
    const match = html.match(re1) || html.match(re2);
    return match?.[1] ?? "";
}

function extractTitle(html: string): string {
    const ogTitle = extractOgField(html, "og:title");
    if (ogTitle) return ogTitle;
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match?.[1]?.trim() ?? "";
}

function extractDomain(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return "";
    }
}

export const GET = tryApi(async ({ url }) => {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
        return badRequest("Missing url parameter");
    }

    // Validate URL
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(targetUrl);
    } catch {
        return badRequest("Invalid URL");
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return badRequest("Unsupported protocol");
    }

    // Check cache
    const cached = cache.get(targetUrl);
    if (cached && cached.expires > Date.now()) {
        return json(cached.data);
    }

    try {
        const resp = await fetch(targetUrl, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT),
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (compatible; VesselBot/1.0; +https://vessel.dev)",
                Accept: "text/html,application/xhtml+xml",
            },
            redirect: "follow",
        });

        if (!resp.ok) {
            return json({ title: extractDomain(targetUrl), siteName: "", image: "", favicon: "", url: targetUrl });
        }

        const contentType = resp.headers.get("content-type") ?? "";
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
            return json({ title: extractDomain(targetUrl), siteName: "", image: "", favicon: "", url: targetUrl });
        }

        // Only read the first 100KB — OG tags are in the <head>
        const text = await resp.text();
        const html = text.slice(0, 100_000);

        const result: OgResult = {
            title: extractTitle(html) || extractDomain(targetUrl),
            siteName: extractOgField(html, "og:site_name"),
            image: extractOgField(html, "og:image"),
            favicon: extractFavicon(html, parsedUrl),
            url: targetUrl,
        };

        // Resolve relative OG image URLs
        if (result.image && !result.image.startsWith("http")) {
            try {
                result.image = new URL(result.image, parsedUrl).href;
            } catch {
                result.image = "";
            }
        }

        const data: Record<string, string> = {
            title: result.title,
            siteName: result.siteName,
            image: result.image,
            favicon: result.favicon,
            url: result.url,
        };

        // Cache the result
        cache.set(targetUrl, { data, expires: Date.now() + CACHE_TTL });

        return json(data);
    } catch {
        // Fetch failed — return fallback with just the domain
        return json({
            title: extractDomain(targetUrl),
            siteName: "",
            image: "",
            favicon: "",
            url: targetUrl,
        });
    }
});
