// Build modules only exist after `vite build`; suppress TS errors.
// oxlint-disable-next-line typescript/ban-ts-comment
// @ts-nocheck
/**
 * @file Entry point for self-contained Vessel executable.
 *
 * This file is compiled into a standalone binary by
 * `scripts/build-standalone.ts`. It embeds all client-side static assets
 * (CSS, JS, fonts, images) via Bun's `import ... with { type: "file" }`
 * mechanism and serves them from memory — bypassing sirv's filesystem
 * reads, which don't work inside a compiled binary's virtual filesystem
 * (`/$bunfs/`).
 *
 * For non-standalone usage, use the regular vite commands:
 *   `bun run dev` / `bun run build && bun run preview`
 *
 * @see scripts/build-standalone.ts — the build script that generates the
 *   auto-imported asset module and compiles this file into a standalone binary.
 */

import { file as bunFile } from "bun";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assetMap, zeroboxBinPath } from "../../build/standalone/assets.js";

import { getHandler } from "../../build/handler.js";
import { env } from "../../build/env.js";

// --- MIME types ---

const MIME_TYPES: Record<string, string> = {
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".eot": "application/vnd.ms-fontobject",
    ".webmanifest": "application/manifest+json",
    ".map": "application/json",
    ".txt": "text/plain",
    ".xml": "application/xml",
    ".wasm": "application/wasm",
    ".br": "application/octet-stream",
    ".gz": "application/octet-stream",
};

/**
 * Resolve MIME type from a URL pathname's file extension.
 *
 * @param pathname - The URL pathname (e.g. `/_app/immutable/assets/app.abc123.js`)
 * @returns The MIME type string
 */
function getMimeType(pathname: string): string {
    const dot = pathname.lastIndexOf(".");
    if (dot === -1) return "application/octet-stream";
    return MIME_TYPES[pathname.substring(dot)] ?? "application/octet-stream";
}

/**
 * Serve an embedded static asset for the given URL pathname.
 *
 * @param pathname - The URL pathname
 * @returns A Response if the asset exists, or null
 */
function serveEmbeddedAsset(pathname: string): Response | null {
    const embeddedPath = assetMap[pathname];
    if (!embeddedPath) return null;

    return new Response(bunFile(embeddedPath), {
        headers: {
            "Content-Type": getMimeType(pathname),
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    });
}

// --- Start the server ---

void (async () => {
    // $bunfs files can't be exec'd by child processes — extract zerobox
    // to disk. Filename includes content hash for upgrade re-extraction.
    if (zeroboxBinPath) {
        try {
            const dataDir = resolve(process.env.VESSEL_DATA_DIR || resolve(process.cwd(), "data"));
            const hashMatch = zeroboxBinPath.match(/zerobox-([a-z0-9]+)/);
            const hash = hashMatch?.[1] ?? "unknown";
            const extractedBin = resolve(dataDir, `.zerobox-bin-${hash}`);
            mkdirSync(dataDir, { recursive: true });
            if (!existsSync(extractedBin)) {
                // 50 MiB max — zerobox binaries are ~18 MiB
                const MAX_ZEROBOX_SIZE = 50 * 1024 * 1024;
                const embeddedFile = Bun.file(zeroboxBinPath);
                if ((embeddedFile.size ?? 0) > MAX_ZEROBOX_SIZE) {
                    throw new Error(`Embedded zerobox binary too large: ${embeddedFile.size} bytes`);
                }
                // size checked above against MAX_ZEROBOX_SIZE
                // oxlint-disable-next-line secure-coding/no-unlimited-resource-allocation
                const bytes = await embeddedFile.arrayBuffer();
                writeFileSync(extractedBin, Buffer.from(bytes));
                chmodSync(extractedBin, 0o755);
            }
            process.env.ZEROBOX_BIN = extractedBin;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[zerobox] Failed to extract embedded binary: ${msg}`);
        }
    }

    const { fetch: svelteFetch, websocket } = await getHandler();
    const port = env("PORT", "3000");
    const host = env("HOST", "0.0.0.0");

    let bunServer: ReturnType<typeof Bun.serve>;

    const server = Bun.serve({
        port,
        hostname: host,
        fetch(req: Request): Response | Promise<Response> {
            // Embedded assets bypass sirv (which can't readdirSync
            // inside $bunfs) in compiled mode.
            const url = new URL(req.url);
            const asset = serveEmbeddedAsset(url.pathname);
            if (asset) return asset;

            return svelteFetch(req, bunServer);
        },
        ...(websocket ? { websocket } : {}),
    });

    bunServer = server;
    console.log(`Listening on ${server.url}`);
})();
