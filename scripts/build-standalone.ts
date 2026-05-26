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
 *   4. Compile `src/standalone/entry.ts` + the generated assets into a standalone binary
 *   5. UPX compression is no longer supported — it corrupts Bun's $bunfs
 *      virtual filesystem, causing all embedded assets to fail with ENOENT.
 *      The --upx flag is retained for backwards compatibility but exits with
 *      an error message. Use zstd or gzip on the uncompressed binary instead.
 *
 * Usage:
 *   bun run scripts/build-standalone.ts [--upx [/path/to/upx]]
 *
 * Flags:
 *   --target <target>   Bun compile target (e.g. bun-linux-x64)
 *   --outfile <path>    Output binary path (defaults to build/standalone/vessel)
 *   --zerobox-bin <path> Path to zerobox binary to embed
 *   --upx [/path/to/upx] DEPRECATED — exits with error. UPX compression
 *                       corrupts Bun's $bunfs embedded filesystem, causing
 *                       all static assets to fail with ENOENT at runtime.
 *                       Use zstd or gzip on the uncompressed binary instead.
 *
 * @see src/standalone/entry.ts — the persistent entry point that loads the
 *   generated asset module and serves embedded assets in compiled mode.
 */

import { join, resolve } from "path";
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from "node:fs";

const projectRoot = import.meta.dir.replace(/\/scripts$/, "");

const BUILD_DIR = "build";
const CLIENT_DIR = join(BUILD_DIR, "client");
const STANDALONE_DIR = join(BUILD_DIR, "standalone");
const ENTRY_POINT = "src/standalone/entry.ts";
const ASSETS_MODULE = join(STANDALONE_DIR, "assets.ts");

// Parse --target, --outfile, --zerobox-bin, and --upx CLI arguments.
// --target sets the Bun compile target (e.g. bun-windows-x64, bun-darwin-arm64, bun-linux-x64).
// --outfile sets the output binary path (defaults to build/standalone/vessel).
// --zerobox-bin sets the path to the zerobox binary to embed (auto-detected if omitted).
// --upx enables UPX compression of the compiled binary (auto-detects or accepts a path).
const cliArgs = process.argv.slice(2);
let targetFlag = "bun";
let outputFileOverride: string | null = null;
let zeroboxBinOverride: string | null = null;
let upxPath: string | null = null;
for (let i = 0; i < cliArgs.length; i++) {
    if (cliArgs[i] === "--target" && cliArgs[i + 1]) {
        targetFlag = cliArgs[i + 1];
        i++;
    } else if (cliArgs[i] === "--outfile" && cliArgs[i + 1]) {
        outputFileOverride = cliArgs[i + 1];
        i++;
    } else if (cliArgs[i] === "--zerobox-bin" && cliArgs[i + 1]) {
        zeroboxBinOverride = cliArgs[i + 1];
        i++;
    } else if (cliArgs[i] === "--upx") {
        // --upx with no argument → auto-detect; --upx /path/to/upx → use that path
        upxPath = cliArgs[i + 1] && !cliArgs[i + 1].startsWith("--") ? cliArgs[i + 1] : "upx";
        if (upxPath !== "upx") i++;
    }
}

const OUTPUT_BINARY = outputFileOverride ?? join(STANDALONE_DIR, "vessel");

// --- Step 1: Vite build ---

console.log("[1/4] Running vite build (adapter-bun)...");
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

// Create standalone dir AFTER vite build (vite may clean build/)
mkdirSync(STANDALONE_DIR, { recursive: true });

// --- Step 2: Collect files ---

console.log("[2/4] Scanning client assets...");

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

console.log("[3/4] Generating build/standalone/assets.ts...");

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

// --- Step 3b: Embed zerobox binary ---

// Map Bun compile targets to @zerobox/cli-* package names.
const ZEROBOX_PLATFORM_MAP: Record<string, string> = {
    "darwin-arm64": "@zerobox/cli-darwin-arm64",
    "darwin-x64": "@zerobox/cli-darwin-x64",
    "linux-arm64": "@zerobox/cli-linux-arm64",
    "linux-x64": "@zerobox/cli-linux-x64",
};

/**
 * Resolve the zerobox binary path for the compile target platform.
 *
 * @param target - Bun compile target (e.g. "bun-darwin-arm64", "bun", or bare "bun-linux-x64")
 * @param override - Explicit --zerobox-bin path from CLI
 * @returns Absolute path to the zerobox binary, or null if not found
 */
function resolveZeroboxBinary(target: string, override: string | null): string | null {
    if (override) {
        if (!existsSync(override)) {
            console.error(`  --zerobox-bin path does not exist: ${override}`);
            process.exit(1);
        }
        return resolve(projectRoot, override);
    }

    // Extract platform key from target (e.g. "bun-darwin-arm64" → "darwin-arm64")
    // Default target "bun" means current host platform.
    let platformKey: string;
    if (target === "bun") {
        platformKey = `${process.platform}-${process.arch}`;
    } else {
        platformKey = target.replace(/^bun-/, "");
    }
    const pkgName = ZEROBOX_PLATFORM_MAP[platformKey];
    if (!pkgName) {
        console.warn(`  No zerobox platform mapping for target "${target}" — sandbox will not work in standalone binary.`);
        console.warn(`  Use --zerobox-bin <path> to specify the binary manually.`);
        return null;
    }

    // Try to find the binary in node_modules
    const pkgDir = join(projectRoot, "node_modules", pkgName);
    const binPath = join(pkgDir, "zerobox");
    if (existsSync(binPath)) {
        return binPath;
    }

    console.warn(`  zerobox binary not found at ${binPath} — sandbox will not work in standalone binary.`);
    console.warn(`  Install the platform package: npm install ${pkgName}`);
    console.warn(`  Or use --zerobox-bin <path> to specify the binary manually.`);
    return null;
}

const zeroboxBinPath = resolveZeroboxBinary(targetFlag, zeroboxBinOverride);
let zeroboxImportLine = "";
let zeroboxExportLine = "";
if (zeroboxBinPath) {
    console.log(`  Embedding zerobox binary: ${zeroboxBinPath}`);
    zeroboxImportLine = `import zeroboxBin from "${zeroboxBinPath}" with { type: "file" };`;
    zeroboxExportLine = `/** Path to the embedded zerobox binary in $bunfs. Set ZEROBOX_BIN to this before using Sandbox. */\nexport const zeroboxBinPath: string = zeroboxBin;`;
} else {
    zeroboxImportLine = `const zeroboxBin: string = "";`;
    zeroboxExportLine = `/** Zerobox binary not embedded — sandbox features will not work. */\nexport const zeroboxBinPath: string = zeroboxBin;`;
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
${zeroboxImportLine}

/**
 * Maps URL paths to embedded file paths in the $bunfs virtual filesystem.
 * Used by src/standalone/entry.ts to serve static assets without sirv.
 */
export const assetMap: Record<string, string> = {};
${mappingEntries.join("\n")}

${zeroboxExportLine}
`;

writeFileSync(ASSETS_MODULE, assetsModuleContent, "utf-8");
console.log(
    `  Generated ${ASSETS_MODULE} (${clientFiles.length + staticFiles.length} asset imports)`,
);

// --- Step 4: Compile ---

console.log("[4/4] Compiling standalone binary...");

const compileResult = Bun.spawnSync(
    [
        "bun",
        "build",
        "--compile",
        `--target=${targetFlag}`,
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
    console.error("Compilation failed — aborting.");
    process.exit(1);
}

// --- Step 5: UPX compression (disabled) ---
// UPX compression is fundamentally incompatible with Bun's compiled binary
// format. Bun stores embedded assets (imported via `import ... with { type: "file" }`)
// in a `.bun` ELF section (~54 MB). UPX compresses this section like any other
// data, but on decompression at runtime the internal format no longer matches
// what Bun expects, and every `Bun.file($bunfsPath)` call returns ENOENT.
// There is no UPX flag (--overlay, --keep-resource, etc.) that can preserve
// this section correctly. See: https://github.com/alexispurslane/vessel/issues/41

let compressedMb: string | null = null;
if (upxPath) {
    console.error(
        "❌  --upx is no longer supported. " +
        "UPX compression corrupts Bun's embedded filesystem ($bunfs), " +
        "causing all static assets (CSS, JS, images) to fail with ENOENT at runtime. " +
        "Use an alternative like zstd or gzip on the uncompressed binary instead.",
    );
    process.exit(1);
} else {
    console.log("[5/5] UPX compression skipped (not compatible with $bunfs).");
}

// --- Report ---

const binaryStat = statSync(join(projectRoot, OUTPUT_BINARY));
const mb = (binaryStat.size / 1024 / 1024).toFixed(1);
const sizeLine = `${mb} MB`;

console.log(`
✅ Standalone Vessel binary built successfully!

   Binary:  ${OUTPUT_BINARY} (${sizeLine})
   Assets:  ${clientFiles.length + staticFiles.length} embedded

   Usage:
     mkdir -p data && ./${OUTPUT_BINARY}

   The binary only needs a data/ directory (for the SQLite DB and
   session JSONL files). All server code, client assets, the Bun
   runtime, and native addons are embedded in the binary.
`);
