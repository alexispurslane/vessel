/**
 * Fetch tool — fetches the fully-rendered content of any web page using
 * happy-dom, then extracts the main content as Markdown via defuddle.
 *
 * Two execution modes:
 *
 * **Sandboxed** (preferred): Pass a zerobox `Sandbox` instance to
 * `createFetchTool({ sandbox })`. The tool builds an inline JS string
 * containing the fetch logic, injects it into
 * `sandbox.exec("node", ["-e", code])`, and the browser runs entirely inside
 * the sandbox. Network and filesystem access are governed by the sandbox
 * policy — the agent can only reach domains that `allowNet` permits.
 *
 * **Local** (fallback): Call `createFetchTool()` with no options. Runs
 * happy-dom directly in the main process — NOT sandboxed. Only use when
 * sandboxing is disabled.
 *
 * Inline string template vs. `Function.toString()` / `import()`:
 *
 * The sandboxed path writes the fetch function as an inline string template
 * (in `buildFetchJs`) using `require()` for module loading. This is necessary
 * because: (a) Vite's SSR transform rewrites `import()` into
 * `__vite_ssr_dynamic_import__()` — even with `@vite-ignore` — which fails
 * in a standalone Node process; and (b) ESM `import()` doesn't use NODE_PATH
 * for resolution, so modules in the sandbox deps dir can't be found.
 * `require()` solves both problems: it's not transformed by Vite, and it
 * respects NODE_PATH.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import type { Sandbox, CommandOutput } from "zerobox";

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
}

// --- Tool options ---

export interface FetchToolOptions {
    /**
     * A zerobox Sandbox to run happy-dom inside.
     * When provided, the fetch executes inside the sandbox.
     * When omitted, happy-dom runs locally in the main process.
     */
    sandbox?: Sandbox;
}

// --- CAPTCHA detection ---

/**
 * Check the rendered document for signs of a CAPTCHA or anti-bot challenge page.
 *
 * Detects common indicators across major providers:
 * - **Cloudflare**: "Just a moment" title, `#challenge-running`, `#challenge-stage`
 * - **reCAPTCHA**: `.g-recaptcha`, Google recaptcha iframes
 * - **hCaptcha**: `.h-captcha`, hcaptcha iframes
 * - **Turnstile**: `.cf-turnstile`, `[data-sitekey]` on Turnstile containers
 * - **Generic**: very short body with keywords like "captcha", "verify", "access denied"
 */
function detectCaptcha(document: any): boolean {
    // --- Cloudflare challenge page ---
    const title = (document.title || "").toLowerCase();
    if (title.includes("just a moment") || title.includes("attention required")) return true;

    if (document.querySelector("#challenge-running") || document.querySelector("#challenge-stage")) return true;

    // Cloudflare Turnstile widget
    if (document.querySelector(".cf-turnstile")) return true;

    // --- reCAPTCHA ---
    if (document.querySelector(".g-recaptcha")) return true;
    if (document.querySelector('iframe[src*="google.com/recaptcha"]')) return true;

    // --- hCaptcha ---
    if (document.querySelector(".h-captcha")) return true;
    if (document.querySelector('iframe[src*="hcaptcha.com"]')) return true;

    // --- Generic heuristics ---
    // If the body is very short and contains captcha/verification keywords,
    // it's likely a challenge page rather than real content.
    const bodyText = (document.body?.textContent || "").trim();
    if (bodyText.length > 0 && bodyText.length < 500) {
        const lower = bodyText.toLowerCase();
        if (
            lower.includes("captcha") ||
            lower.includes("verify you") ||
            lower.includes("verify you are human") ||
            lower.includes("are you a robot") ||
            lower.includes("are you human") ||
            lower.includes("access denied") ||
            lower.includes("blocked") && lower.includes("bot")
        ) {
            return true;
        }
    }

    return false;
}

// --- Sandboxed fetch function (injected as inline JS string) ---

/**
 * Build the inline JS string to execute inside the sandbox.
 *
 * This generates a self-contained async function that runs inside a
 * standalone Node process (via sandbox.exec). It uses `require()` for
 * module resolution, which respects the NODE_PATH env var set by the
 * sandbox (pointing to data/deps/node_modules).
 *
 * Previous approach used dynamic `import()`, but this had two problems:
 * 1. Vite's SSR transform rewrites `import()` into `__vite_ssr_dynamic_import__()`
 *    — even with `@vite-ignore` — and Function.toString() captured the
 *    transformed source, which fails in a standalone Node process.
 * 2. ESM `import()` does NOT use NODE_PATH for resolution (only `require()`
 *    does), so modules installed in the sandbox deps dir weren't found.
 *
 * `require()` can't load `defuddle/node` via subpath because package exports
 * block it (ESM-only). Instead, we construct the absolute path to
 * `defuddle/dist/node.js` using the NODE_PATH env var and require it by
 * file path — this bypasses the package exports restriction.
 *
 * After happy-dom renders the page, the live Document object is passed
 * straight to defuddle which extracts the main content as Markdown.
 */
function buildFetchJs(url: string, timeoutSeconds: number): string {
    const urlJson = JSON.stringify(url);
    const uaJson = JSON.stringify(CHROME_WINDOWS_UA);
    const timeoutMs = timeoutSeconds * 1000;
    const clientHintHeadersJson = JSON.stringify(CHROME_CLIENT_HINT_HEADERS);
    const secChUaJson = JSON.stringify(CHROME_SEC_CH_UA);
    const platformJson = JSON.stringify(CHROME_PLATFORM);
    const profileJson = JSON.stringify(IMPIT_BROWSER_PROFILE);
    // The promise rejection is handled by the process — unhandled rejections
    // cause a non-zero exit code, which we catch in fetchPageInSandbox.
    //
    // Fetch strategy: use impit (with browser: "chrome131") for the initial HTTP
    // request so that the TLS handshake and HTTP/2 frames match a real Chrome
    // browser. The chrome131 profile sets Sec-CH-UA brands correctly; we override
    // User-Agent and Sec-CH-UA-Platform via instance headers to match our Windows
    // UA string. Then we inject the fetched HTML into happy-dom via page.content /
    // page.url setters instead of page.goto(), which would use Node's built-in
    // fetch (and its generic TLS fingerprint that gets flagged by anti-bot
    // services). A fetch.interceptor.beforeAsyncRequest hook routes all
    // sub-requests made by happy-dom (JS, CSS, XHR, etc.) through impit too.
    //
    // Navigator patching: happy-dom's Navigator defaults are Firefox-like
    // (vendor="", productSub="20100101"). We use beforeContentCallback to
    // patch navigator.vendor, navigator.productSub, navigator.platform, and
    // inject navigator.userAgentData so JS-level client hints match the
    // HTTP-level Sec-CH-UA headers that impit sends.
    return `
const path = require("path");
const { Browser, BrowserErrorCaptureEnum } = require("happy-dom");
const { Defuddle } = require(path.join(process.env.NODE_PATH, "defuddle", "dist", "node.js"));
const { Impit } = require(path.join(process.env.NODE_PATH, "impit"));
(async function __fetchPage() {
    let browser;
    try {
        // Use impit to fetch the page with Chrome 131's TLS fingerprint and HTTP headers.
        // The chrome131 profile gives us the right Sec-CH-UA brands; we override
        // User-Agent and Sec-CH-UA-Platform via instance-level headers to match Windows.
        const impit = new Impit({ browser: ${profileJson}, timeout: ${timeoutMs}, headers: ${clientHintHeadersJson} });
        const impitResponse = await impit.fetch(${urlJson});
        const httpStatus = impitResponse.status;
        const html = await impitResponse.text();
        browser = new Browser({
            settings: {
                errorCapture: BrowserErrorCaptureEnum.processLevel,
                navigator: { userAgent: ${uaJson} },
                navigation: {
                    beforeContentCallback: (win) => {
                        // Patch Navigator properties that happy-dom gets wrong for Chrome.
                        // Missing or mismatched values are a common anti-bot detection signal.
                        //
                        // navigator.vendor: Chrome returns "Google Inc.", happy-dom defaults to "" (Firefox)
                        // navigator.productSub: Chrome returns "20030107", happy-dom defaults to "20100101" (Firefox)
                        // navigator.platform: Should be "Win32" on 64-bit Windows, but happy-dom parses
                        //   it from the UA string and gets "Windows NT 10.0; Win64; x64" instead.
                        // navigator.userAgentData: Chrome implements the User-Agent Client Hints JS API
                        //   (navigator.userAgentData.brands, .mobile, .platform), but happy-dom
                        //   doesn't implement it at all. We inject a matching stub.
                        Object.defineProperty(win.Navigator.prototype, 'vendor', { get: () => 'Google Inc.', configurable: true });
                        Object.defineProperty(win.Navigator.prototype, 'productSub', { get: () => '20030107', configurable: true });
                        Object.defineProperty(win.Navigator.prototype, 'platform', { get: () => 'Win32', configurable: true });
                        // Inject navigator.userAgentData to match the Sec-CH-UA headers impit sends.
                        // Parse the Sec-CH-UA value into brand objects: "Google Chrome";v="131" → {brand:"Google Chrome",version:"131"}
                        const brands = ${secChUaJson}.split(', ').map(part => {
                            const m = part.match(/"([^"]+)";v="([^"]+)"/);
                            return m ? { brand: m[1], version: m[2] } : null;
                        }).filter(Boolean);
                        Object.defineProperty(win.Navigator.prototype, 'userAgentData', {
                            get: () => ({
                                brands: brands,
                                mobile: false,
                                platform: ${platformJson},
                                getHighEntropyValues: async (hints) => {
                                    const result = { brands: brands, mobile: false, platform: ${platformJson} };
                                    if (hints.includes('platformVersion')) result.platformVersion = '15.0.0';
                                    if (hints.includes('architecture')) result.architecture = 'x86';
                                    if (hints.includes('model')) result.model = '';
                                    if (hints.includes('bitness')) result.bitness = '64';
                                    if (hints.includes('fullVersionList')) result.fullVersionList = brands.map(b => ({ brand: b.brand, version: b.version }));
                                    return result;
                                },
                            }),
                            configurable: true,
                        });
                    },
                },
                fetch: {
                    interceptor: {
                        beforeAsyncRequest: async ({ request, window: win }) => {
                            // Route all sub-requests through impit so they also have
                            // Chrome's TLS fingerprint instead of Node's default
                            try {
                                const subImpit = new Impit({ browser: ${profileJson}, timeout: ${timeoutMs}, headers: ${clientHintHeadersJson} });
                                const subResponse = await subImpit.fetch(request.url, {
                                    method: request.method,
                                    headers: Object.fromEntries(request.headers.entries()),
                                    body: request.method !== "GET" && request.method !== "HEAD" ? await request.text() : undefined,
                                });
                                const body = await subResponse.text();
                                const headerEntries = [];
                                subResponse.headers.forEach((value, key) => headerEntries.push([key, value]));
                                return new win.Response(body, {
                                    status: subResponse.status,
                                    statusText: subResponse.statusText,
                                    headers: headerEntries,
                                });
                            } catch {
                                // Let happy-dom handle the error (return void = no interception)
                            }
                        },
                    },
                },
            },
        });
        const page = browser.newPage();
        // Inject the impit-fetched HTML directly instead of using page.goto(),
        // which would make a separate HTTP request with Node's generic TLS fingerprint
        page.url = ${urlJson};
        page.content = html;
        await page.waitUntilComplete();
        const document = page.mainFrame.document;
        // --- CAPTCHA detection ---
        let captchaDetected = false;
        const docTitle = (document.title || "").toLowerCase();
        if (docTitle.includes("just a moment") || docTitle.includes("attention required")) captchaDetected = true;
        if (document.querySelector("#challenge-running") || document.querySelector("#challenge-stage")) captchaDetected = true;
        if (document.querySelector(".cf-turnstile")) captchaDetected = true;
        if (document.querySelector(".g-recaptcha")) captchaDetected = true;
        if (document.querySelector('iframe[src*="google.com/recaptcha"]')) captchaDetected = true;
        if (document.querySelector(".h-captcha")) captchaDetected = true;
        if (document.querySelector('iframe[src*="hcaptcha.com"]')) captchaDetected = true;
        if (!captchaDetected) {
            const bodyText = (document.body?.textContent || "").trim();
            if (bodyText.length > 0 && bodyText.length < 500) {
                const lower = bodyText.toLowerCase();
                if (lower.includes("captcha") || lower.includes("verify you") || lower.includes("are you a robot") || lower.includes("are you human") || lower.includes("access denied") || (lower.includes("blocked") && lower.includes("bot"))) captchaDetected = true;
            }
        }
        // Replace img and SVG elements with paragraphs containing their alt text
        // before passing to defuddle. Huge SVGs (diagrams, icons, charts) dump
        // pages of markup into the output. For <img>, use the alt attribute.
        // For <svg>, check aria-label, title attribute, or <title> child.
        // If no descriptive text is found, remove the element entirely.
        document.querySelectorAll("img").forEach(el => {
            const alt = el.getAttribute("alt");
            if (alt && alt.trim()) {
                const p = document.createElement("p");
                p.textContent = "[Image: " + alt.trim() + "]";
                el.parentNode.replaceChild(p, el);
            } else {
                el.remove();
            }
        });
        document.querySelectorAll("svg").forEach(el => {
            const ariaLabel = el.getAttribute("aria-label");
            const titleAttr = el.getAttribute("title");
            const titleEl = el.querySelector("title");
            const titleText = titleEl ? titleEl.textContent : null;
            const label = (ariaLabel && ariaLabel.trim()) || (titleAttr && titleAttr.trim()) || (titleText && titleText.trim());
            if (label) {
                const p = document.createElement("p");
                p.textContent = "[Image: " + label + "]";
                el.parentNode.replaceChild(p, el);
            } else {
                el.remove();
            }
        });
        const defuddleResult = await Defuddle(document, ${urlJson}, { markdown: true, removeImages: true });
        const content = defuddleResult.content;
        const title = defuddleResult.title || document.title;
        const result = JSON.stringify({ content, title, captchaDetected, httpStatus });
        console.log(result);
    } finally {
        if (browser) await browser.close();
    }
})().catch(e => { console.error(e.message || e); process.exit(1); });`;
}

/**
 * Replace `<img>` and `<svg>` elements in a document with `<p>` elements
 * containing their alt text (or remove them if no alt text is available).
 *
 * This prevents huge SVG markup from polluting the defuddle output while
 * preserving image descriptions where available.
 *
 * - `<img>`: uses the `alt` attribute
 * - `<svg>`: tries `aria-label`, then `title` attribute, then `<title>` child
 */
function replaceImagesWithAltText(document: any): void {
    document.querySelectorAll("img").forEach((el: any) => {
        const alt = el.getAttribute("alt");
        if (alt && alt.trim()) {
            const p = document.createElement("p");
            p.textContent = "[Image: " + alt.trim() + "]";
            el.parentNode.replaceChild(p, el);
        } else {
            el.remove();
        }
    });
    document.querySelectorAll("svg").forEach((el: any) => {
        const ariaLabel = el.getAttribute("aria-label");
        const titleAttr = el.getAttribute("title");
        const titleEl = el.querySelector("title");
        const titleText = titleEl ? titleEl.textContent : null;
        const label = (ariaLabel && ariaLabel.trim()) || (titleAttr && titleAttr.trim()) || (titleText && titleText.trim());
        if (label) {
            const p = document.createElement("p");
            p.textContent = "[Image: " + label + "]";
            el.parentNode.replaceChild(p, el);
        } else {
            el.remove();
        }
    });
}

// --- Local (non-sandboxed) fetch ---

async function fetchPageLocally(url: string, timeout: number = 30): Promise<{ content: string; title: string; captchaDetected: boolean; httpStatus: number }> {
    const { Browser, BrowserErrorCaptureEnum } = await import(/* @vite-ignore */ "happy-dom");
    const { Defuddle } = await import(/* @vite-ignore */ "defuddle/node");
    const { Impit } = await import(/* @vite-ignore */ "impit");
    let browser: InstanceType<typeof Browser> | undefined;
    try {
        // Use impit to fetch the page with Chrome 131's TLS fingerprint and HTTP headers.
        // The chrome131 profile gives us the right Sec-CH-UA brands; we override
        // User-Agent and Sec-CH-UA-Platform via instance-level headers to match Windows.
        const impit = new Impit({ browser: IMPIT_BROWSER_PROFILE, timeout: timeout * 1000, headers: CHROME_CLIENT_HINT_HEADERS });
        const impitResponse = await impit.fetch(url);
        const httpStatus = impitResponse.status;
        const html = await impitResponse.text();

        browser = new Browser({
            settings: {
                errorCapture: BrowserErrorCaptureEnum.processLevel,
                navigator: { userAgent: CHROME_WINDOWS_UA },
                navigation: {
                    beforeContentCallback: (win: any) => {
                        // Patch Navigator properties that happy-dom gets wrong for Chrome.
                        // Missing or mismatched values are a common anti-bot detection signal.
                        //
                        // navigator.vendor: Chrome returns "Google Inc.", happy-dom defaults to "" (Firefox)
                        // navigator.productSub: Chrome returns "20030107", happy-dom defaults to "20100101" (Firefox)
                        // navigator.platform: Should be "Win32" on 64-bit Windows, but happy-dom parses
                        //   it from the UA string and gets "Windows NT 10.0; Win64; x64" instead.
                        // navigator.userAgentData: Chrome implements the User-Agent Client Hints JS API
                        //   (navigator.userAgentData.brands, .mobile, .platform), but happy-dom
                        //   doesn't implement it at all. We inject a matching stub.
                        Object.defineProperty(win.Navigator.prototype, 'vendor', { get: () => 'Google Inc.', configurable: true });
                        Object.defineProperty(win.Navigator.prototype, 'productSub', { get: () => '20030107', configurable: true });
                        Object.defineProperty(win.Navigator.prototype, 'platform', { get: () => 'Win32', configurable: true });
                        // Inject navigator.userAgentData to match the Sec-CH-UA headers impit sends.
                        // Parse the Sec-CH-UA value into brand objects.
                        const brands = CHROME_SEC_CH_UA.split(', ').map((part: string) => {
                            const m = part.match(/"([^"]+)";v="([^"]+)"/);
                            return m ? { brand: m[1], version: m[2] } : null;
                        }).filter(Boolean);
                        Object.defineProperty(win.Navigator.prototype, 'userAgentData', {
                            get: () => ({
                                brands,
                                mobile: false,
                                platform: CHROME_PLATFORM,
                                getHighEntropyValues: async (hints: string[]) => {
                                    const result: Record<string, unknown> = { brands, mobile: false, platform: CHROME_PLATFORM };
                                    if (hints.includes('platformVersion')) result.platformVersion = '15.0.0';
                                    if (hints.includes('architecture')) result.architecture = 'x86';
                                    if (hints.includes('model')) result.model = '';
                                    if (hints.includes('bitness')) result.bitness = '64';
                                    if (hints.includes('fullVersionList')) result.fullVersionList = brands.map((b: any) => ({ brand: b.brand, version: b.version }));
                                    return result;
                                },
                            }),
                            configurable: true,
                        });
                    },
                },
                fetch: {
                    interceptor: {
                        beforeAsyncRequest: async ({ request, window: win }) => {
                            // Route all sub-requests through impit so they also have
                            // Chrome's TLS fingerprint instead of Node's default
                            try {
                                const subImpit = new Impit({ browser: IMPIT_BROWSER_PROFILE, timeout: timeout * 1000, headers: CHROME_CLIENT_HINT_HEADERS });
                                const subResponse = await subImpit.fetch(request.url, {
                                    method: request.method as any,
                                    headers: Object.fromEntries(request.headers.entries()),
                                    body: request.method !== "GET" && request.method !== "HEAD" ? await request.text() : undefined,
                                });
                                const body = await subResponse.text();
                                const headerEntries: [string, string][] = [];
                                subResponse.headers.forEach((value, key) => headerEntries.push([key, value]));
                                return new win.Response(body, {
                                    status: subResponse.status,
                                    statusText: subResponse.statusText,
                                    headers: headerEntries,
                                });
                            } catch {
                                // Let happy-dom handle the error (return void = no interception)
                            }
                        },
                    },
                },
            },
        }) as InstanceType<typeof Browser>;
        const page = browser.newPage();
        // Inject the impit-fetched HTML directly instead of using page.goto(),
        // which would make a separate HTTP request with Node's generic TLS fingerprint
        page.url = url;
        page.content = html;
        await page.waitUntilComplete();
        const document = page.mainFrame.document;
        // Check for CAPTCHA/anti-bot challenge pages before extracting content
        const captchaDetected = detectCaptcha(document as any);
        // Replace img and SVG elements with paragraphs containing their alt text
        // before passing to defuddle. Huge SVGs (diagrams, icons, charts) dump
        // pages of markup into the output. For <img>, use the alt attribute.
        // For <svg>, check aria-label, title attribute, or <title> child.
        // If no descriptive text is found, remove the element entirely.
        replaceImagesWithAltText(document as any);
        const defuddleResult = await Defuddle(document as any, url, { markdown: true, removeImages: true });
        const content = defuddleResult.content;
        const title = defuddleResult.title || document.title;
        return { content, title, captchaDetected, httpStatus };
    } finally {
        if (browser) await browser.close();
    }
}

// --- Sandboxed fetch ---

async function fetchPageInSandbox(sandbox: Sandbox, url: string, timeout: number = 30): Promise<{ content: string; title: string; captchaDetected: boolean; httpStatus: number }> {
    const jsCode = buildFetchJs(url, timeout);
    // sandbox.exec is used instead of sandbox.js because we need to pass
    // --use-env-proxy to the Node process. Node.js fetch doesn't respect
    // HTTPS_PROXY by default — zerobox sets up the proxy for allowed domains
    // and injects HTTPS_PROXY as an env var, but Node needs this flag to
    // actually use it. Without it, Node tries to connect directly, DNS fails,
    // and you get ENOTFOUND. sandbox.js doesn't support custom node flags.
    const result: CommandOutput = await sandbox.exec("node", ["--use-env-proxy", "-e", jsCode]).output();

    // Always include stderr in errors — happy-dom/defuddle logs diagnostics there
    // (navigation errors, network failures, script errors, etc.).
    const stderrSummary = result.stderr?.trim()
        ? " (" + result.stderr.trim().split("\n").slice(-3).join("; ") + ")"
        : "";

    if (result.code !== 0) {
        throw new Error("Failed to fetch " + url + ": exit code " + result.code + stderrSummary);
    }

    if (!result.stdout?.trim()) {
        throw new Error("Failed to fetch " + url + ": empty response" + stderrSummary);
    }

    try {
        const parsed = JSON.parse(result.stdout.trim());
        return { content: parsed.content, title: parsed.title ?? "", captchaDetected: !!parsed.captchaDetected, httpStatus: parsed.httpStatus ?? 200 };
    } catch {
        // If JSON parsing fails, return raw stdout as the content
        return { content: result.stdout, title: "", captchaDetected: false, httpStatus: 200 };
    }
}

// --- Truncation ---

const DEFAULT_MAX_CONTENT_CHARS = 500_000;

/**
 * Truncate content to a maximum character count, appending a notice
 * if truncation occurred. Tries to truncate at a newline boundary for
 * cleaner output.
 */
function truncateContent(content: string, maxChars: number = DEFAULT_MAX_CONTENT_CHARS): {
    content: string;
    truncated: boolean;
} {
    if (content.length <= maxChars) {
        return { content, truncated: false };
    }

    // Find a safe truncation point near the limit
    let cutPoint = content.lastIndexOf("\n", maxChars);
    if (cutPoint < maxChars * 0.8) {
        // No good newline boundary — hard truncate
        cutPoint = maxChars;
    }

    const notice = "\n\n[Output truncated: showing " + cutPoint + " of " + content.length + " characters]";
    return { content: content.slice(0, cutPoint) + notice, truncated: true };
}

// --- Tool ---

/**
 * Create the fetch tool.
 *
 * Fetches the fully-rendered content of a web page using happy-dom, then
 * extracts the main content as Markdown via defuddle. When a `sandbox` is
 * provided in options, the browser runs inside the zerobox sandbox with its
 * network/filesystem policies enforced. Otherwise, runs directly in the
 * main process.
 */
export function createFetchTool(options?: FetchToolOptions): AgentTool<typeof fetchSchema, FetchToolDetails> {
    const sandbox = options?.sandbox;

    return {
        name: "fetch",
        label: "fetch",
        description:
            "Fetch the main content of a web page as Markdown, including any content generated by JavaScript execution. " +
            "Use this when you need to read the contents of a web page — it handles client-side rendering (SPAs, etc.) " +
            "and extracts the readable content, removing clutter like sidebars, headers, and footers. ",
        parameters: fetchSchema,

        async execute(
            _toolCallId: string,
            params: FetchToolInput,
            _signal?: AbortSignal
        ): Promise<AgentToolResult<FetchToolDetails>> {
            const { url, timeout } = params;
            const effectiveTimeout = timeout ?? 30;

            // Basic URL validation
            let parsedUrl: URL;
            try {
                parsedUrl = new URL(url);
            } catch {
                return {
                    content: [
                        { type: "text", text: "Invalid URL: " + url + ". Make sure to include the protocol (e.g. https://)." },
                    ],
                    details: { url, title: "", contentLength: 0, truncated: false, content: "" },
                };
            }

            if (!["http:", "https:"].includes(parsedUrl.protocol)) {
                return {
                    content: [
                        { type: "text", text: "Unsupported protocol: " + parsedUrl.protocol + ". Only http: and https: are supported." },
                    ],
                    details: {
                        url,
                        title: "",
                        contentLength: 0,
                        truncated: false,
                        content: "",
                    },
                };
            }

            let content: string;
            let title: string;
            let captchaDetected: boolean;
            let httpStatus: number;

            try {
                const result = sandbox
                    ? await fetchPageInSandbox(sandbox, url, effectiveTimeout)
                    : await fetchPageLocally(url, effectiveTimeout);
                content = result.content;
                title = result.title;
                captchaDetected = result.captchaDetected;
                httpStatus = result.httpStatus;
            } catch (err) {
                // Network/parse errors from the fetch itself — return as tool error
                // so the model sees what went wrong without the whole tool call failing.
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [
                        { type: "text", text: "Error fetching " + url + ": " + message },
                    ],
                    details: { url, title: "", contentLength: 0, truncated: false, content: "" },
                };
            }

            // Throwing causes the agent loop to mark the tool call as isError,
            // which is the correct semantic for a semantically failed fetch.
            if (httpStatus >= 400) {
                throw new Error(
                    "The page returned HTTP " + httpStatus + ". " +
                    "The site may be blocking automated access or the page may not exist."
                );
            }

            if (captchaDetected) {
                throw new Error(
                    "CAPTCHA or anti-bot challenge page detected. " +
                    "The site is blocking automated access and the page content could not be retrieved."
                );
            }

            // Treat effectively empty content as a failure too — the page didn't
            // return usable text, so the agent should know it got nothing.
            if (!content || content.trim().length === 0) {
                throw new Error(
                    "The page returned no readable content. " +
                    "The site may be blocking automated access, require JavaScript that happy-dom doesn't support, " +
                    "or the page may be empty."
                );
            }

            const { content: truncatedContent, truncated } = truncateContent(content);

            const textContent: TextContent[] = [
                { type: "text", text: truncatedContent },
            ];

            return {
                content: textContent,
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
