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

// The pi-coding-agent SDK reads package.json at module-evaluation time. Handler is imported
// dynamically so we can set PI_PACKAGE_DIR first to something we control.
let getHandler: () => { fetch: ReturnType<typeof Bun.serve>["fetch"]; websocket?: any };

// --- Help message ---

const HELP = `
Vessel — AI coding agent with a chat UI

USAGE
  vessel [options]

OPTIONS
  -h, --help    Show this help message

ENVIRONMENT VARIABLES

  VESSEL_DATA_DIR      Directory for the SQLite database, session
                       files, agent workspace, and MCP config.
                       Default: <cwd>/data

  VESSEL_PORT          Port the server listens on.
                       Default: 3000

  VESSEL_HOST          Hostname the server binds to.
                       Default: 0.0.0.0

  VESSEL_IN_MEMORY_DB  Set to "1" to use an in-memory SQLite database
                       instead of the on-disk file. Intended for E2E
                       testing only — data is lost on process exit.
                       Default: (unset, uses on-disk DB)

  JWT_SECRET           Secret key for signing JWT session tokens.
                       If unset, a random secret is generated on each
                       startup (tokens won't survive restarts).

  LOG_LEVEL            Logging verbosity. One of: trace, debug, info,
                       warn, error, fatal. Default: debug (dev),
                       error (production)

  PI_PACKAGE_DIR      Directory where package.json lives for the
                       pi-coding-agent SDK. Set automatically in
                       standalone mode.

  ZEROBOX_BIN          Path to the zerobox binary for sandboxed
                       code execution. Set automatically in
                       standalone mode.
`;

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

// --- Zerobox binary extraction ---

/**
 * Extract the embedded zerobox binary to disk if not already present.
 *
 * $bunfs files can't be exec'd by child processes, so zerobox must
 * be extracted to a real filesystem path. The filename includes a
 * content hash so upgrades trigger re-extraction.
 *
 * @param dataDir - The data directory to extract the binary into
 */
async function extractZerobox(dataDir: string): Promise<void> {
    if (!zeroboxBinPath) return;

    try {
        const hashMatch = zeroboxBinPath.match(/zerobox-([a-z0-9]+)/);
        const hash = hashMatch?.[1] ?? "unknown";
        const extractedBin = resolve(dataDir, `.zerobox-bin-${hash}`);
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

// --- Start the server ---

// Check for --help / -h before any I/O
if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP);
    process.exit(0);
}

void (async () => {
    const dataDir = resolve(process.env.VESSEL_DATA_DIR || resolve(process.cwd(), "data"));
    mkdirSync(dataDir, { recursive: true });

    // Set PI_PACKAGE_DIR before loading pi-coding-agent, which does a top-level
    // readFileSync(getPackageJsonPath()) that fails in compiled binaries.
    if (!process.env.PI_PACKAGE_DIR) {
        const packageJsonPath = resolve(dataDir, "package.json");
        if (!existsSync(packageJsonPath)) {
            writeFileSync(
                packageJsonPath,
                JSON.stringify({ name: "vessel", version: "0.0.1" }),
                "utf-8",
            );
        }
        process.env.PI_PACKAGE_DIR = dataDir;
    }

    await extractZerobox(dataDir);

    // Dynamic import: pi-coding-agent reads package.json at module-evaluation time,
    // so PI_PACKAGE_DIR must already be set (done above).
    const handlerModule = await import("../../build/handler.js");
    getHandler = handlerModule.getHandler;

    const { fetch: svelteFetch, websocket } = getHandler();
    const port = process.env.VESSEL_PORT ?? "3000";
    const host = process.env.VESSEL_HOST ?? "0.0.0.0";

    let bunServer: ReturnType<typeof Bun.serve>;

    const server = Bun.serve({
        port,
        hostname: host,
        idleTimeout: 30,
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
