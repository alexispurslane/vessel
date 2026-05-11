// Bun APIs (Bun.spawnSync, import.meta.dir) don't resolve for the
// TypeScript checker since this is a build-only script.
// oxlint-disable-next-line typescript/ban-ts-comment
// @ts-nocheck
/**
 * @file Build script for self-contained Vessel executable.
 *
 * Produces a single binary that contains the Bun runtime, all server code,
 * and all client-side static assets (CSS, JS, fonts, images). The only
 * external requirement at runtime is a `data/` directory for the SQLite
 * database and session JSONL files.
 *
 * Steps:
 *   1. Run `vite build` (adapter-bun) to produce the standard build output
 *   2. Scan `build/client/` for every static asset
 *   3. Auto-generate `build/standalone/assets.ts` with `import ... with { type: "file" }`
 *      for each asset and a URL→path mapping
 *   4. Swap pi-tui with stub (excludes ~400KB of TUI code + koffi from binary)
 *   5. Compile `src/standalone/entry.ts` + the generated assets into a standalone binary
 *
 * Usage:
 *   bun run scripts/build-standalone.ts
 *
 * @see src/standalone/entry.ts — the persistent entry point that loads the
 *   generated asset module and serves embedded assets in compiled mode.
 */

import { join } from "path";
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";

const BUILD_DIR = "build";
const CLIENT_DIR = join(BUILD_DIR, "client");
const STANDALONE_DIR = join(BUILD_DIR, "standalone");
const ENTRY_POINT = "src/standalone/entry.ts";
const ASSETS_MODULE = join(STANDALONE_DIR, "assets.ts");
const OUTPUT_BINARY = join(STANDALONE_DIR, "vessel");

// --- Step 1: Vite build ---

console.log("[1/5] Running vite build (adapter-bun)...");
// Set VESSEL_STANDALONE so svelte.config.js can disable precompression
// (the binary doesn't need .br/.gz files — it serves from memory).
const viteResult = Bun.spawnSync(["bun", "--bun", "vite", "build"], {
    cwd: import.meta.dir.replace(/\/scripts$/, ""),
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, VESSEL_STANDALONE: "1" },
});
if (viteResult.exitCode !== 0) {
    console.error("vite build failed — aborting.");
    process.exit(1);
}

// --- Step 1b: Patch handler.js for bytecode compatibility ---
//
// svelte-adapter-bun's handler.js uses top-level `await server.init(...)`,
// which Bun's bytecode compiler doesn't support ("await can only be used
// inside an async function"). We wrap it in an async IIFE and make
// getHandler() await the init promise before returning.

const HANDLER_FILE = join(BUILD_DIR, "handler.js");
if (existsSync(HANDLER_FILE)) {
    console.log("  Patching handler.js for bytecode compatibility...");
    let handlerSrc = readFileSync(HANDLER_FILE, "utf-8");

    // Wrap:  await server.init({...});
    // Into:  const __initPromise = (async () => { await server.init({...}); })();
    const initPattern =
        /await server\.init\(\{\s*env:\s*Bun\.env,\s*read:\s*\(file\)\s*=>\s*Bun\.file\(`[^`]+`\)\.stream\(\)\s*\}\);/;
    handlerSrc = handlerSrc.replace(
        initPattern,
        (match) => `const __initPromise = (async () => { ${match} })();`,
    );

    // Make getHandler() async and await the init promise
    handlerSrc = handlerSrc.replace(
        "var getHandler = () => {",
        "var getHandler = async () => {\n  await __initPromise;",
    );

    writeFileSync(HANDLER_FILE, handlerSrc, "utf-8");
}

// Create standalone dir AFTER vite build (vite may clean build/)
mkdirSync(STANDALONE_DIR, { recursive: true });

// --- Step 2: Collect files ---

console.log("[2/5] Scanning client assets...");

/**
 * Collect all file paths under a directory using depth-first search.
 *
 * @param rootDir - Directory to scan
 * @returns Array of file paths relative to rootDir
 */
function collectFiles(rootDir: string): string[] {
    if (!existsSync(rootDir)) return [];
    const files: string[] = [];
    const stack: { dir: string; prefix: string }[] = [
        { dir: rootDir, prefix: "" },
    ];
    while (stack.length > 0) {
        const { dir, prefix } = stack.pop()!;
        for (const entry of readdirSync(dir)) {
            const fullPath = join(dir, entry);
            const relPath = prefix ? `${prefix}/${entry}` : entry;
            if (statSync(fullPath).isDirectory()) {
                stack.push({ dir: fullPath, prefix: relPath });
            } else {
                files.push(relPath);
            }
        }
    }
    return files;
}

const allClientFiles = collectFiles(CLIENT_DIR);
const allStaticFiles = collectFiles("static");

/** KaTeX font families only used for rare LaTeX commands (\mathfrak, etc.).
 *  Dropping these saves ~90KB — browsers fall back to Main for missing glyphs. */
const KATEX_RARE_FONTS = /KaTeX_(Caligraphic|Fraktur|SansSerif|Script|Typewriter)/;

/** Font subsets for scripts unlikely to appear in Vessel's target audience. */
const NON_LATIN_SUBSETS = /-(cyrillic|greek|vietnamese)-/;

/**
 * Filter assets to exclude files that bloat the standalone binary
 * without being needed at runtime.
 *
 * @param relPath - File path relative to the client/static directory
 * @returns True if the file should be embedded in the binary
 */
function shouldEmbedAsset(relPath: string): boolean {
    // Pre-compressed (.br/.gz) files — the standalone server serves
    // from memory and can compress on-the-fly.
    if (relPath.endsWith(".br") || relPath.endsWith(".gz")) return false;

    // KaTeX TTF and WOFF fonts — WOFF2 is sufficient for all modern
    // browsers and is ~50% smaller than TTF/woff equivalents.
    if (/KaTeX.*\.(ttf|woff)$/.test(relPath)) return false;

    // Rare KaTeX WOFF2 variants — only needed for \mathfrak, \mathscr, etc.
    // Browsers fall back to KaTeX_Main for missing glyphs.
    if (KATEX_RARE_FONTS.test(relPath) && relPath.endsWith(".woff2")) return false;

    // Non-Latin font subsets (cyrillic, greek, vietnamese) — rarely needed
    // for Vessel's primary English-speaking audience.
    if (NON_LATIN_SUBSETS.test(relPath)) return false;

    return true;
}

const clientFiles = allClientFiles.filter(shouldEmbedAsset);
const staticFiles = allStaticFiles.filter(shouldEmbedAsset);

const skippedTotal =
    allClientFiles.length +
    allStaticFiles.length -
    clientFiles.length -
    staticFiles.length;
if (skippedTotal > 0) {
    console.log(
        `  Filtered out ${skippedTotal} unnecessary asset files (pre-compressed, redundant fonts)`,
    );
}

console.log(
    `  Found ${allClientFiles.length} client files + ${allStaticFiles.length} static files`,
);

// --- Step 3: Generate assets.ts ---

console.log("[3/5] Generating build/standalone/assets.ts...");

const importLines: string[] = [];
const mappingEntries: string[] = [];

// Client assets: URL path = /${relPath}
for (let i = 0; i < clientFiles.length; i++) {
    const relPath = clientFiles[i];
    const varName = `a${i}`;
    importLines.push(
        `import ${varName} from "../client/${relPath}" with { type: "file" };`,
    );
    mappingEntries.push(`  assetMap["/${relPath}"] = ${varName};`);
}

// Static files: URL path = /${relPath}
for (let i = 0; i < staticFiles.length; i++) {
    const relPath = staticFiles[i];
    const varName = `s${i}`;
    importLines.push(
        `import ${varName} from "../../static/${relPath}" with { type: "file" };`,
    );
    mappingEntries.push(`  assetMap["/${relPath}"] = ${varName};`);
}

const assetsModuleContent = `/**
 * @file Auto-generated embedded asset map for standalone Vessel binary.
 *
 * Generated by scripts/build-standalone.ts — DO NOT EDIT.
 * Each import uses Bun's \`with { type: "file" }\` to embed the file
 * into the compiled binary's virtual filesystem.
 *
 * @see src/standalone/entry.ts — the entry point that loads this module.
 */

${importLines.join("\n")}

/**
 * Maps URL paths to embedded file paths in the $bunfs virtual filesystem.
 * Used by src/standalone/entry.ts to serve static assets without sirv.
 */
export const assetMap: Record<string, string> = {};
${mappingEntries.join("\n")}
`;

writeFileSync(ASSETS_MODULE, assetsModuleContent, "utf-8");
console.log(
    `  Generated ${ASSETS_MODULE} (${clientFiles.length + staticFiles.length} asset imports)`,
);

// --- Step 4: Stub pi-tui for compile ---

// bun build --compile resolves @mariozechner/pi-tui from node_modules,
// pulling in the full ~2.4MB terminal UI library + koffi FFI addon.
// We swap the real package with our stub before compiling, then restore it.
const projectRoot = import.meta.dir.replace(/\/scripts$/, "");
const PI_TUI_DIR = join(projectRoot, "node_modules/@mariozechner/pi-tui");
const PI_TUI_BACKUP = join(
    projectRoot,
    "node_modules/@mariozechner/.pi-tui-real",
);
const PI_TUI_STUB = join(projectRoot, "src/lib/server/stubs/pi-tui.ts");

/**
 * Restore the real pi-tui package from backup (used in error paths).
 */
function restorePiTui(): void {
    if (existsSync(PI_TUI_BACKUP)) {
        rmSync(PI_TUI_DIR, { recursive: true, force: true });
        renameSync(PI_TUI_BACKUP, PI_TUI_DIR);
    }
}

let swappedPiTui = false;
if (existsSync(PI_TUI_DIR)) {
    console.log("[4/5] Swapping pi-tui with stub for compile...");
    renameSync(PI_TUI_DIR, PI_TUI_BACKUP);
    mkdirSync(PI_TUI_DIR, { recursive: true });
    writeFileSync(
        join(PI_TUI_DIR, "package.json"),
        JSON.stringify({
            name: "@mariozechner/pi-tui",
            version: "0.0.0-stub",
            type: "module",
            main: "index.js",
            exports: { ".": "./index.js" },
        }),
        "utf-8",
    );
    // Export only value exports (no `export type` — JS files can't use that).
    // Type-only imports from pi-tui will be erased by the bundler.
    const stubExports = [
        "getSegmenter",
        "visibleWidth",
        "truncateFragmentToWidth",
        "truncateToWidth",
        "matchesKey",
        "parseKey",
        "isKeyRelease",
        "isKeyRepeat",
        "isKittyProtocolActive",
        "setKittyProtocolActive",
        "decodeKittyPrintable",
        "TUI_KEYBINDINGS",
        "KeybindingsManager",
        "getKeybindings",
        "setKeybindings",
        "fuzzyFilter",
        "fuzzyMatch",
        "getCapabilities",
        "setCapabilities",
        "resetCapabilitiesCache",
        "detectCapabilities",
        "getImageDimensions",
        "getPngDimensions",
        "getJpegDimensions",
        "getWebpDimensions",
        "getGifDimensions",
        "getCellDimensions",
        "setCellDimensions",
        "calculateImageRows",
        "allocateImageId",
        "deleteKittyImage",
        "deleteAllKittyImages",
        "encodeKitty",
        "encodeITerm2",
        "hyperlink",
        "imageFallback",
        "renderImage",
        "StdinBuffer",
        "Container",
        "isFocusable",
        "CURSOR_MARKER",
        "TUI",
        "ProcessTerminal",
        "Box",
        "CancellableLoader",
        "Editor",
        "Image",
        "Input",
        "Loader",
        "Markdown",
        "SelectList",
        "SettingsList",
        "Spacer",
        "Text",
        "TruncatedText",
        "Key",
        "CombinedAutocompleteProvider",
    ].join(", ");
    writeFileSync(
        join(PI_TUI_DIR, "index.js"),
        `export { ${stubExports} } from ${JSON.stringify(PI_TUI_STUB)};\n`,
        "utf-8",
    );
    swappedPiTui = true;
}

// --- Step 5: Compile ---

console.log("[5/5] Compiling standalone binary...");

const compileResult = Bun.spawnSync(
    [
        "bun",
        "build",
        "--compile",
        "--target=bun",
        "--minify",
        join(projectRoot, ENTRY_POINT),
        "--outfile",
        join(projectRoot, OUTPUT_BINARY),
    ],
    {
        cwd: projectRoot,
        stdout: "inherit",
        stderr: "inherit",
    },
);

if (compileResult.exitCode !== 0) {
    restorePiTui();
    console.error("Compilation failed — aborting.");
    process.exit(1);
}

// Restore real pi-tui
if (swappedPiTui) {
    restorePiTui();
    console.log("  Restored real pi-tui package.");
}

// --- Report ---

const binaryStat = statSync(join(projectRoot, OUTPUT_BINARY));
const mb = (binaryStat.size / 1024 / 1024).toFixed(1);

console.log(`
✅ Standalone Vessel binary built successfully!

   Binary:  ${OUTPUT_BINARY} (${mb} MB)
   Assets:  ${clientFiles.length + staticFiles.length} embedded

   Usage:
     mkdir -p data && ./${OUTPUT_BINARY}

   The binary only needs a data/ directory (for the SQLite DB and
   session JSONL files). All server code, client assets, the Bun
   runtime, and native addons are embedded in the binary.
`);
