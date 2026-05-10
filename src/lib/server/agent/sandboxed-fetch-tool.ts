/**
 * @file Fetch tool — fetches the fully-rendered content of any web page using
 * happy-dom, then extracts the main content as Markdown via defuddle.
 *
 * Two execution modes, both running in-process:
 *
 * **Sandboxed**: Pass a zerobox `Sandbox` instance to
 * `createFetchTool({ sandbox })`. The sandbox's network policy
 * (`allowNet`) is enforced in-process — URLs are checked against the policy
 * before any request is made, and happy-dom's fetch interceptor routes
 * sub-resource requests through impit (with the same domain check).
 *
 * **Local** (fallback): Call `createFetchTool()` with no options. No sandbox
 * restrictions apply — all network requests go through directly.
 *
 * Both paths share the same in-process logic:
 * 1. impit fetches the HTML with Chrome 131's TLS fingerprint/headers
 * 2. happy-dom renders the page (JS execution, DOM construction)
 * 3. defuddle extracts the main content as Markdown
 *
 * The impit TLS fingerprinting, navigator patches, fetch interceptor,
 * CAPTCHA detection, img/SVG replacement, and defuddle extraction happen
 * in a single shared `fetchPage` function — no code duplication.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Sandbox } from "zerobox";
import { Browser, BrowserErrorCaptureEnum } from "happy-dom";
import type BrowserWindow from "happy-dom/lib/window/BrowserWindow.js";
import type IFetchInterceptor from "happy-dom/lib/fetch/types/IFetchInterceptor.js";
import type Request from "happy-dom/lib/fetch/Request.js";
import type Response from "happy-dom/lib/fetch/Response.js";
import { Impit } from "impit";
import { Defuddle } from "defuddle/node";

// --- Bun vm module workaround ---

/**
 * Patch JS globals onto a happy-dom BrowserWindow instance.
 *
 * Bun's `vm` module does not properly execute happy-dom's
 * `VMGlobalPropertyScript.runInContext()`, which uses `vm.Script` to copy
 * JS globals (`SyntaxError`, `TypeError`, `Array`, etc.) from `globalThis`
 * onto the window object. Under Bun every one of these properties ends up as
 * `undefined`. This causes an immediate crash in happy-dom's
 * `SelectorParser.getSelectorGroups()`, which eagerly constructs a
 * `SyntaxError` with `new this.window.SyntaxError(...)` — turning what
 * should be a clean selector-parse error into an opaque
 * `TypeError: undefined is not a constructor` that kills *every*
 * `querySelectorAll` call (even valid selectors like `"p"` or `"*"`).
 *
 * This function copies any missing globals from `globalThis` onto the
 * window, restoring normal selector parsing and error handling.
 *
 * @param win - The happy-dom BrowserWindow instance to patch
 */
function patchBunVmGlobals(win: BrowserWindow): void {
    // Mirrors happy-dom's VMGlobalPropertyScript (minus deprecated globals).
    // Only patch when undefined — some properties are already set correctly.
    const jsGlobals: (keyof typeof globalThis)[] = [
        "Array", "ArrayBuffer", "Boolean", "DataView", "Date", "Error",
        "EvalError", "Float32Array", "Float64Array", "Function", "Infinity",
        "Int16Array", "Int32Array", "Int8Array", "Intl", "JSON", "Map", "Math",
        "NaN", "Number", "Object", "Promise", "RangeError", "ReferenceError",
        "RegExp", "Reflect", "Set", "String", "Symbol", "SyntaxError",
        "TypeError", "URIError", "Uint16Array", "Uint32Array", "Uint8Array",
        "Uint8ClampedArray", "WeakMap", "WeakSet", "decodeURI",
        "decodeURIComponent", "encodeURI", "encodeURIComponent", "eval",
        "isFinite", "isNaN", "parseFloat", "parseInt",
    ];

    for (const name of jsGlobals) {
        if ((win as unknown as Record<string, unknown>)[name] === undefined) {
            (win as unknown as Record<string, unknown>)[name] = globalThis[name];
        }
    }
}

// --- Chrome 131 on Windows Spoof ---

/**
 * A realistic Chrome-on-Windows user agent string.
 *
 * By default happy-dom advertises itself with a `HappyDOM` user agent,
 * which some sites detect and block. Spoofing a common browser avoids
 * this without any downside for content extraction.
 *
 * This must match impit's `chrome131` profile (which sets Chrome 131 in
 * `Sec-CH-UA`), but with a Windows platform instead of the default macOS.
 */
const CHROME_WINDOWS_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * HTTP Client Hints that Chrome 131 on Windows sends by default (low-entropy).
 *
 * impit's `chrome131` profile sets `Sec-CH-UA` correctly but defaults to
 * `"macOS"` for the platform. We override `Sec-CH-UA-Platform` and
 * `User-Agent` to match our Windows UA string.
 */
const CHROME_CLIENT_HINT_HEADERS: Record<string, string> = {
    "User-Agent": CHROME_WINDOWS_UA,
    "Sec-CH-UA-Platform": '"Windows"',
};

/**
 * The `Sec-CH-UA` header value impit's chrome131 profile sends.
 *
 * We capture this as a constant so the JS-level `navigator.userAgentData`
 * patch can stay in sync with the HTTP-level `Sec-CH-UA` header.
 *
 * Format: `"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"`
 */
const CHROME_SEC_CH_UA =
    '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';

/**
 * The `Sec-CH-UA-Platform` value for Windows.
 *
 * Used in the JS-level `navigator.userAgentData.platform` patch.
 */
const CHROME_PLATFORM = "Windows";

/**
 * The impit browser profile that matches our Chrome 131 spoof.
 *
 * This gives us the correct TLS fingerprint (JA3/JA4), HTTP/2 frame settings,
 * and default `Sec-CH-UA` brand formatting for Chrome 131.
 */
const IMPIT_BROWSER_PROFILE = "chrome131" as const;

// --- Schema ---

const fetchSchema = Type.Object({
    url: Type.String({
        description: "The URL of the web page to fetch (must include the protocol, e.g. https://)",
    }),
    timeout: Type.Optional(
        Type.Number({
            description:
                "Maximum time in seconds to wait for the page to finish rendering, including any JavaScript execution (default: 30)",
        })
    ),
});

export type FetchToolInput = Static<typeof fetchSchema>;

// --- Details & options ---

export interface FetchToolDetails {
    /** The URL that was fetched. */
    url: string;
    /** The page title. */
    title: string;
    /** Length of the returned content in characters. */
    contentLength: number;
    /** Whether the output was truncated. */
    truncated: boolean;
    /** The fetched and defuddle'd markdown content the model saw. */
    content: string;
    /** Whether the URL was already present in search results, so the fetch was skipped. */
    wasSearchResult?: boolean;
}

export interface FetchToolOptions {
    /**
     * A zerobox Sandbox whose network policy should be respected.
     * When provided, the sandbox's `allowNet` policy (false, true, or specific
     * domains) is enforced in-process — URLs are checked before any request.
     * When omitted, no network restrictions apply.
     */
    sandbox?: Sandbox;
    /**
     * A shared Set shared with the search tool to track URLs that appeared in search results.
     * When the fetch tool encounters a URL in this set, it skips the actual fetch and
     * returns a message indicating the page was already seen in search results.
     */
    searchResultUrls?: Set<string>;
}

// --- Network policy enforcement ---

/**
 * Check whether a URL is permitted by the sandbox's network policy.
 *
 * The sandbox's `allowNet` can be:
 * - `false`: no network access at all
 * - `true`: all domains allowed
 * - `string[]`: only specific domains allowed (matched by hostname suffix)
 *
 * Domain matching uses hostname suffix comparison — e.g. if "example.com"
 * is in the allowed list, "api.example.com" is also allowed.
 *
 * @param url - The URL to check
 * @param allowNet - The sandbox's network policy value
 * @returns Whether the URL is permitted
 */
function isUrlAllowed(url: string, allowNet: boolean | string[]): boolean {
    if (allowNet === true) return true;
    if (allowNet === false) return false;

    const hostname = new URL(url).hostname.toLowerCase();
    return allowNet.some((domain) => {
        const d = domain.toLowerCase();
        return hostname === d || hostname.endsWith("." + d);
    });
}

// --- CAPTCHA detection ---

/**
 * Detect common CAPTCHA and anti-bot challenge patterns in the rendered document.
 *
 * Checks for well-known Cloudflare, reCAPTCHA, and hCAPTCHA indicators in the
 * page title, DOM elements, and body text.
 *
 * @param document - The happy-dom Document to inspect
 * @returns Whether a CAPTCHA was detected
 */
function detectCaptcha(document: Document): boolean {
    const docTitle = (document.title || "").toLowerCase();
    if (docTitle.includes("just a moment") || docTitle.includes("attention required")) return true;
    if (document.querySelector("#challenge-running") || document.querySelector("#challenge-stage")) return true;
    if (document.querySelector(".cf-turnstile")) return true;
    if (document.querySelector(".g-recaptcha")) return true;
    if (document.querySelector('iframe[src*="google.com/recaptcha"]')) return true;
    if (document.querySelector(".h-captcha")) return true;
    if (document.querySelector('iframe[src*="hcaptcha.com"]')) return true;

    const bodyText = (document.body?.textContent || "").trim();
    if (bodyText.length > 0 && bodyText.length < 500) {
        const lower = bodyText.toLowerCase();
        if (
            lower.includes("captcha") ||
            lower.includes("verify you") ||
            lower.includes("are you a robot") ||
            lower.includes("are you human") ||
            lower.includes("access denied") ||
            (lower.includes("blocked") && lower.includes("bot"))
        ) {
            return true;
        }
    }

    return false;
}

// --- Image/SVG cleanup ---

/**
 * Replace img and SVG elements with paragraphs containing their alt text
 * before passing to defuddle.
 *
 * Huge SVGs (diagrams, icons, charts) dump pages of markup into the output.
 * For `<img>`, use the alt attribute. For `<svg>`, check aria-label, title
 * attribute, or `<title>` child. If no descriptive text is found, remove the
 * element entirely.
 *
 * @param document - The happy-dom Document to clean up
 */
function cleanImagesAndSvgs(document: Document): void {
    document.querySelectorAll("img").forEach((el) => {
        const alt = el.getAttribute("alt");
        if (alt && alt.trim()) {
            const p = document.createElement("p");
            p.textContent = "[Image: " + alt.trim() + "]";
            // Node.parentNode can be null for detached elements
            if (el.parentNode) el.parentNode.replaceChild(p, el);
        } else {
            el.remove();
        }
    });
    document.querySelectorAll("svg").forEach((el) => {
        const ariaLabel = el.getAttribute("aria-label");
        const titleAttr = el.getAttribute("title");
        const titleEl = el.querySelector("title");
        const titleText = titleEl ? titleEl.textContent : null;
        const label =
            (ariaLabel && ariaLabel.trim()) ||
            (titleAttr && titleAttr.trim()) ||
            (titleText && titleText.trim());
        if (label) {
            const p = document.createElement("p");
            p.textContent = "[Image: " + label + "]";
            // Node.parentNode can be null for detached elements
            if (el.parentNode) el.parentNode.replaceChild(p, el);
        } else {
            el.remove();
        }
    });
}

// --- Navigator patches ---

/**
 * Build the Sec-CH-UA brand list from the constant header value.
 *
 * @returns Array of { brand, version } objects parsed from `CHROME_SEC_CH_UA`
 */
function parseBrowserBrands(): { brand: string; version: string }[] {
    return CHROME_SEC_CH_UA.split(", ")
        .map((part) => {
            const m = part.match(/"([^"]+)";v="([^"]+)"/);
            return m ? { brand: m[1], version: m[2] } : null;
        })
        .filter((b): b is { brand: string; version: string } => b !== null);
}

/** Pre-parsed brand list for the `userAgentData` navigator patch. */
const BROWSER_BRANDS = parseBrowserBrands();

/**
 * Apply navigator and DOM patches to a happy-dom window to spoof Chrome 131
 * on Windows. Patches vendor, productSub, platform, userAgentData,
 * getBoundingClientRect, and requestAnimationFrame.
 *
 * @param win - The happy-dom BrowserWindow to patch
 */
function applyNavigatorPatches(win: BrowserWindow): void {
    Object.defineProperty(win.Navigator.prototype, "vendor", {
        get: () => "Google Inc.",
        configurable: true,
    });
    Object.defineProperty(win.Navigator.prototype, "productSub", {
        get: () => "20030107",
        configurable: true,
    });
    Object.defineProperty(win.Navigator.prototype, "platform", {
        get: () => "Win32",
        configurable: true,
    });

    Object.defineProperty(win.Navigator.prototype, "userAgentData", {
        get: () => ({
            brands: BROWSER_BRANDS,
            mobile: false,
            platform: CHROME_PLATFORM,
            getHighEntropyValues: async (hints: string[]) => {
                const result: {
                    brands: { brand: string; version: string }[];
                    mobile: boolean;
                    platform: string;
                    platformVersion?: string;
                    architecture?: string;
                    model?: string;
                    bitness?: string;
                    fullVersionList?: { brand: string; version: string }[];
                } = {
                    brands: BROWSER_BRANDS,
                    mobile: false,
                    platform: CHROME_PLATFORM,
                };
                if (hints.includes("platformVersion"))
                    result.platformVersion = "15.0.0";
                if (hints.includes("architecture"))
                    result.architecture = "x86";
                if (hints.includes("model")) result.model = "";
                if (hints.includes("bitness")) result.bitness = "64";
                if (hints.includes("fullVersionList"))
                    result.fullVersionList = BROWSER_BRANDS.map((b) => ({
                        brand: b.brand,
                        version: b.version,
                    }));
                return result;
            },
        }),
        configurable: true,
    });

    // Stub getBoundingClientRect — anti-bot scripts probe element geometry
    // Timer dispatch, not eval/deserialization

    // oxlint-disable-next-line secure-coding/no-unsafe-deserialization
    win.Element.prototype.getBoundingClientRect = function () {
        return { width: 100, height: 100, top: 0, left: 0, bottom: 100, right: 100, x: 0, y: 0 } as unknown as ReturnType<typeof win.Element.prototype.getBoundingClientRect>;
    };
    // Stub requestAnimationFrame — scripts rely on animation loop heartbeat
    // Timer dispatch, not eval/deserialization

    // oxlint-disable-next-line secure-coding/no-unsafe-deserialization
    win.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(callback, 16) as unknown as NodeJS.Immediate;
}

/**
 * Build a fetch interceptor that routes sub-resource requests through impit
 * (for TLS fingerprint consistency) and enforces the sandbox network policy.
 *
 * The window reference comes from the `beforeAsyncRequest` callback parameter,
 * not from the factory call — this avoids the chicken-and-egg problem of
 * needing a BrowserWindow before the Browser is created.
 *
 * @param allowNet - Network policy from the sandbox (false, true, or domain list).
 *   When undefined, no network restrictions apply.
 * @param timeoutMs - Timeout for impit requests in milliseconds
 * @returns A fetch interceptor object for happy-dom's configuration
 */
function buildFetchInterceptor(
    allowNet: boolean | string[] | undefined,
    timeoutMs: number
): IFetchInterceptor {
    return {
        async beforeAsyncRequest({
            request,
            window: win,
        }: {
            request: Request;
            window: BrowserWindow;
        }): Promise<Response | void> {
            // Enforce sandbox network policy on sub-resource requests
            if (allowNet !== undefined && !isUrlAllowed(request.url, allowNet)) {
                return new win.Response("", {
                    status: 403,
                    statusText: "Forbidden (sandbox policy)",
                });
            }

            try {
                const subImpit = new Impit({
                    browser: IMPIT_BROWSER_PROFILE,
                    timeout: timeoutMs,
                    headers: CHROME_CLIENT_HINT_HEADERS,
                });
                const subResponse = await subImpit.fetch(request.url, {
                    method: request.method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS",
                    headers: Object.fromEntries(request.headers.entries()),
                    body:
                        request.method !== "GET" && request.method !== "HEAD"
                            ? await request.text()
                            : undefined,
                });
                const body = await subResponse.text();
                const headerEntries: [string, string][] = [];
                subResponse.headers.forEach((value, key) =>
                    headerEntries.push([key, value])
                );
                return new win.Response(body, {
                    status: subResponse.status,
                    statusText: subResponse.statusText,
                    headers: headerEntries,
                });
            } catch {
                // Let happy-dom handle the error (return void = no interception)
            }
        },
    };
}

// --- Core fetch ---

/**
 * Fetch HTML from a URL using impit with Chrome 131's TLS fingerprint.
 *
 * @param url - The URL to fetch
 * @param timeoutMs - Timeout in milliseconds
 * @param allowNet - Network policy to enforce (undefined = no restrictions)
 * @returns The HTML content and HTTP status code
 * @throws Error if the URL is blocked by the network policy
 */
async function fetchHtml(
    url: string,
    timeoutMs: number,
    allowNet: boolean | string[] | undefined
): Promise<{ html: string; httpStatus: number }> {
    // Check network policy before making any request
    if (allowNet !== undefined && !isUrlAllowed(url, allowNet)) {
        throw new Error(
            "Network access to " +
            new URL(url).hostname +
            " is blocked by the sandbox policy. " +
            "The domain is not in the allowed domains list."
        );
    }

    const impit = new Impit({
        browser: IMPIT_BROWSER_PROFILE,
        timeout: timeoutMs,
        headers: CHROME_CLIENT_HINT_HEADERS,
    });
    const impitResponse = await impit.fetch(url);
    const httpStatus = impitResponse.status;
    const html = await impitResponse.text();

    return { html, httpStatus };
}

/**
 * Render HTML in happy-dom and extract content via defuddle.
 *
 * Creates a happy-dom Browser, injects the pre-fetched HTML, waits for
 * JS execution to complete, then runs CAPTCHA detection, image/SVG cleanup,
 * and defuddle extraction.
 *
 * @param url - The page URL (set as the document's origin)
 * @param html - The pre-fetched HTML content
 * @param allowNet - Network policy to enforce on sub-resource requests
 * @param timeoutMs - Timeout for sub-resource impit requests
 * @returns The defuddle-extracted content, title, and captcha detection result
 */
async function renderAndExtract(
    url: string,
    html: string,
    allowNet: boolean | string[] | undefined,
    timeoutMs: number
): Promise<{ content: string; title: string; captchaDetected: boolean }> {
    const browser = new Browser({
        settings: {
            errorCapture: BrowserErrorCaptureEnum.processLevel,
            navigator: { userAgent: CHROME_WINDOWS_UA },
            navigation: {
                beforeContentCallback: (win) => {
                    patchBunVmGlobals(win);
                    applyNavigatorPatches(win);
                },
            },
            fetch: {
                interceptor: buildFetchInterceptor(allowNet, timeoutMs),
            },
        },
    });

    try {
        const page = browser.newPage();

        // Bun vm workaround (see patchBunVmGlobals): beforeContentCallback
        // does not fire when setting page.content directly, so patch eagerly.
        patchBunVmGlobals(page.mainFrame.window);

        // Inject the impit-fetched HTML directly instead of using page.goto(),
        // which would make a separate HTTP request with Node's generic TLS fingerprint
        page.url = url;
        page.content = html;
        await page.waitUntilComplete();

        const document = page.mainFrame.document;

        const captchaDetected = detectCaptcha(document as unknown as Document);
        cleanImagesAndSvgs(document as unknown as Document);

        const defuddleResult = await Defuddle(
            document as unknown as Document,
            url,
            { markdown: true, removeImages: true }
        );
        const content = defuddleResult.content;
        const title = defuddleResult.title || document.title;

        return { content, title, captchaDetected };
    } finally {
        await browser.close();
    }
}

/**
 * Fetch and render a web page in-process using impit → happy-dom → defuddle.
 *
 * 1. impit fetches the raw HTML with Chrome 131's TLS fingerprint and headers
 * 2. happy-dom renders the page (JavaScript execution, DOM construction)
 * 3. defuddle extracts the main content as Markdown
 *
 * When `allowNet` is provided (from the sandbox policy), all HTTP requests —
 * both the initial page fetch and any sub-resource requests triggered by
 * happy-dom's rendering — are validated against the domain allowlist.
 * Requests to disallowed domains are silently blocked.
 *
 * @param url - The URL to fetch
 * @param timeoutSeconds - Timeout in seconds (default: 30)
 * @param allowNet - Network policy from the sandbox (false, true, or domain list).
 *   When undefined, no network restrictions apply.
 * @returns Parsed content, title, captcha flag, and HTTP status
 */
async function fetchPage(
    url: string,
    timeoutSeconds: number = 30,
    allowNet?: boolean | string[]
): Promise<{
    content: string;
    title: string;
    captchaDetected: boolean;
    httpStatus: number;
}> {
    const timeoutMs = timeoutSeconds * 1000;

    const { html, httpStatus } = await fetchHtml(url, timeoutMs, allowNet);
    // False positive: this is a DOM render + extraction, not a file operation
    // oxlint-disable-next-line secure-coding/no-unlimited-resource-allocation
    const { content, title, captchaDetected } = await renderAndExtract(
        url,
        html,
        allowNet,
        timeoutMs
    );

    return { content, title, captchaDetected, httpStatus };
}

// --- Truncation ---

const DEFAULT_MAX_CONTENT_CHARS = 500_000;

/**
 * Truncate content to a maximum character count, appending a notice
 * if truncation occurred. Tries to truncate at a newline boundary for
 * cleaner output.
 *
 * @param content - The content to truncate
 * @param maxChars - Maximum character count (default: 500,000)
 * @returns The (possibly truncated) content and truncation flag
 */
function truncateContent(
    content: string,
    maxChars: number = DEFAULT_MAX_CONTENT_CHARS
): { content: string; truncated: boolean } {
    if (content.length <= maxChars) {
        return { content, truncated: false };
    }

    // Find a safe truncation point near the limit
    let cutPoint = content.lastIndexOf("\n", maxChars);
    if (cutPoint < maxChars * 0.8) {
        // No good newline boundary — hard truncate
        cutPoint = maxChars;
    }

    const notice =
        "\n\n[Output truncated: showing " +
        String(cutPoint) +
        " of " +
        String(content.length) +
        " characters]";
    return { content: content.slice(0, cutPoint) + notice, truncated: true };
}

// --- Tool helpers ---

/**
 * Build a tool error result with a text message and empty details.
 *
 * @param url - The URL that was being fetched
 * @param text - The error or info message
 * @param wasSearchResult - Whether the URL was already in search results
 * @returns A tool result with the error message
 */
function buildErrorResult(
    url: string,
    text: string,
    wasSearchResult = false
): AgentToolResult<FetchToolDetails> {
    return {
        content: [{ type: "text" as const, text }],
        details: {
            url,
            title: "",
            contentLength: 0,
            truncated: false,
            content: "",
            ...(wasSearchResult && { wasSearchResult: true }),
        },
    };
}

/**
 * Validate and parse a URL for the fetch tool.
 *
 * Returns the parsed URL on success, or an AgentToolResult with an error
 * message if the URL is invalid or uses an unsupported protocol.
 *
 * @param rawUrl - The raw URL string to validate
 * @returns The parsed URL, or an error result
 */
function validateFetchUrl(
    rawUrl: string
): URL | AgentToolResult<FetchToolDetails> {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(rawUrl);
    } catch {
        return buildErrorResult(
            rawUrl,
            "Invalid URL: " + rawUrl + ". Make sure to include the protocol (e.g. https://)."
        );
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return buildErrorResult(
            rawUrl,
            "Unsupported protocol: " + parsedUrl.protocol + ". Only http: and https: are supported."
        );
    }

    return parsedUrl;
}

/**
 * Run the actual fetch and validate the result.
 *
 * Calls `fetchPage` with the sandbox's network policy, then validates
 * the HTTP status, CAPTCHA detection, and content emptiness.
 * Returns the deduddled content on success, or throws on semantic failures.
 *
 * @param url - The URL to fetch
 * @param timeout - Timeout in seconds
 * @param sandbox - Optional sandbox for network policy
 * @returns The fetch result (content, title, captchaDetected, httpStatus)
 * @throws Error on HTTP errors, CAPTCHA detection, or empty content
 */
async function executeFetch(
    url: string,
    timeout: number,
    sandbox?: Sandbox
): Promise<{ content: string; title: string; captchaDetected: boolean; httpStatus: number }> {
    const allowNet = sandbox?.options.allowNet;
    const result = await fetchPage(url, timeout, allowNet);

    // Throwing marks the tool call as isError — correct for semantic failures
    if (result.httpStatus >= 400) {
        throw new Error(
            "The page returned HTTP " +
            String(result.httpStatus) +
            ". " +
            "The site may be blocking automated access or the page may not exist."
        );
    }

    if (result.captchaDetected) {
        throw new Error(
            "CAPTCHA or anti-bot challenge page detected. " +
            "The site is blocking automated access and the page content could not be retrieved."
        );
    }

    if (!result.content || result.content.trim().length === 0) {
        throw new Error(
            "The page returned no readable content. " +
            "The site may be blocking automated access, require JavaScript that happy-dom doesn't support, " +
            "or the page may be empty."
        );
    }

    return result;
}

// --- Tool ---

/**
 * Create the fetch tool.
 *
 * Fetches the fully-rendered content of a web page using happy-dom, then
 * extracts the main content as Markdown via defuddle. When a `sandbox` is
 * provided in options, the sandbox's network policy (`allowNet`) is enforced
 * in-process — URLs are checked against the policy before any request is made.
 * Otherwise, no network restrictions apply.
 *
 * @param options - Optional configuration (sandbox, search result URL tracker)
 * @returns The fetch AgentTool
 */
export function createFetchTool(
    options?: FetchToolOptions
): AgentTool<typeof fetchSchema, FetchToolDetails> {
    const sandbox = options?.sandbox;
    const searchResultUrls = options?.searchResultUrls;

    return {
        name: "fetch",
        label: "fetch",
        description:
            "Fetch the main content of a web page as Markdown, including any content generated by JavaScript execution. " +
            "This is a SECONDARY fallback tool — prefer using web_search first, as its results typically include " +
            "the full page content and are usually more complete than what this tool can extract. " +
            "Only use this tool when: (1) you need a specific URL that didn't appear in search results, " +
            "(2) a search result's page content was missing or clearly truncated, or " +
            "(3) you need to verify content on a page that had no text in search results. " +
            "This tool handles client-side rendering (SPAs, etc.) and extracts readable content, removing clutter like sidebars, headers, and footers.",
        parameters: fetchSchema,

        async execute(
            _toolCallId: string,
            params: FetchToolInput,
            _signal?: AbortSignal
        ): Promise<AgentToolResult<FetchToolDetails>> {
            const { url, timeout } = params;
            const effectiveTimeout = timeout ?? 30;

            const validated = validateFetchUrl(url);
            if (!(validated instanceof URL)) return validated;

            if (searchResultUrls?.has(url)) {
                return buildErrorResult(
                    url,
                    `This page (${url}) was already included in previous search results. The page content from the search results is typically more complete and higher quality than what a separate fetch would return. Review the search result content for this page — it should contain everything you need. If it seemed incomplete, try a more specific search query instead.`,
                    true
                );
            }

            let content: string;
            let title: string;
            let httpStatus: number;

            try {
                const result = await executeFetch(url, effectiveTimeout, sandbox);
                content = result.content;
                title = result.title;
                httpStatus = result.httpStatus;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return buildErrorResult(url, "Error fetching " + url + ": " + message);
            }

            void httpStatus; // Used implicitly via executeFetch validation
            const { content: truncatedContent, truncated } =
                truncateContent(content);

            return {
                content: [{ type: "text", text: truncatedContent }],
                details: {
                    url,
                    title,
                    contentLength: content.length,
                    truncated,
                    content: truncatedContent,
                },
            };
        },
    };
}
