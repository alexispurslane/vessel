## User

on linux, with sandboxing enabled, when the agent runs commands, they always fail — there's some kind of horrible sandbox misconfiguration.

`ls` fails with "path not found" for the workspace (it does exist, I checked via docker exec)
`uname`, `whoami`, `pwd`, basically everything else fails with:

```
thread 'main' (94) panicked at upstream/linux-sandbox/src/linux_run_main.rs:395:9:
split sandbox policies requiring direct runtime enforcement are incompatible with --use-legacy-landlock
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
snapshot: no changes detected
```

## Assistant

<thinking>
The user is describing a Linux sandboxing issue where commands fail in their agent setup. Let me understand the problem:

1. `ls` fails with "path not found" for the workspace
2. Other commands like `uname`, `whoami`, `pwd` fail with a panic about split sandbox policies being incompatible with `--use-legacy-landlock`

This looks like it's related to the Zed agent sandbox configuration on Linux. The error message is clear:

> "split sandbox policies requiring direct runtime enforcement are incompatible with --use-legacy-landlock"

This suggests the sandbox is configured with split policies AND `--use-legacy-landlock` is enabled, but these two are incompatible.

Let me look at the project to understand how sandboxing is configured.
</thinking>

This error message is very clear — the sandbox configuration is passing `--use-legacy-landlock` while also using split sandbox policies that require direct runtime enforcement. These two features are incompatible.

Let me dig into how the sandbox is configured in this project.

**Tool Call: Search files for regex `use-legacy-landlock|legacy.landlock|landlock`**
Status: Completed

No matches found

**Tool Call: Search files for regex `sandbox`**
Status: Completed

Showing matches 1-20 (there were more matches found; use offset: 20 to see next page):

## Matches in talkai/CANVAS.md

### # Canvas — Collaborative File Editing › ## Concept › L5-6
```
Files in the agent's sandbox can be designated as "canvases" — shared collaborative documents edited by both the user and agent, reconciled via CodeMirror 6's built-in operational transforms (`@codemirror/collab`).

```

### # Canvas — Collaborative File Editing › ## Canvas Tracking › L54-55
```
A file becomes a canvas when the user clicks "edit" on its sandbox file pill. Track which files are canvases per conversation — a simple JSON file in the conversation dir (`canvases.json`) listing file paths. The agent can also designate a canvas via a tool (V2).

```

### # Canvas — Collaborative File Editing › ## Frontend › L63-64
```
- **File pills**: Add an edit/pencil icon to sandbox file chips. Clicking it toggles the file as a canvas and opens the canvas editor showing that file. Clicking it again just re-opens it.
- **Push timing**: 200ms debounce after user stops typing, then `sendableUpdates()` → POST.
```

### # Canvas — Collaborative File Editing › ## Server State › L73-75
```
- On change: apply to in-memory `doc`, write to sandbox file on disk, broadcast via SSE, notify agent.

Persist updates to disk (append-only log per canvas file) so the server can reconstruct state after restart without requiring client re-push.
```

## Matches in talkai/README.md

### ## Philosophy › L11-12
```
- **A safe realization of the agentic chat ideal** — Not just a chatbot, but a full agentic harness at its heart: any tools you expose, MCP servers you configure, all running inside per-conversation [zerobox](https://github.com/nicobailon/zerobox) sandboxes with configurable filesystem isolation, network allowlists, secrets management, and per-conversation overrides. The power of OpenClaw or the agentic features of claude.ai/gemini app — with real security.
- **Elegant, mobile-friendly UI** — Good typography, a design that gets out of your way, and full mobile support.
```

### ## Features › ### Coding Agent › L23-24
```
Powered by [pi-coding-agent](https://github.com/mariozechner/pi): bash execution, file read/write/edit, web fetch, and web search — all inside a [zerobox](https://github.com/nicobailon/zerobox) sandbox.

```

### ## Features › ### CodeMirror 6 Editor › L63-64
```
- Autocomplete for files uploaded to the agent's sandbox
- Full Emacs keybindings
```

### ## Tech Stack › L77-86
```
| Layer | Technology |
|---|---|
| Framework | [Svelte 5](https://svelte.dev/) (runes mode, SvelteKit) |
| Runtime | [Bun](https://bun.sh/) (including `bun:sqlite` for the database) |
| UI | [Shadcn](https://next.shadcn-svelte.com/) |
| AI Engine | [Pi](https://github.com/mariozechner/pi) (pi-coding-agent, pi-ai, pi-agent-core) |
| Sandbox | [Zerobox](https://github.com/nicobailon/zerobox) |
| Editor | [CodeMirror 6](https://codemirror.net/) |
| Linting | [OxLint](https://oxc.rs/docs/guide/usage/linter.html) (security, JSDoc, SonarJS plugins) |

```

### ## Architecture › L144-145
```
Vessel is a **monolithic SvelteKit app** where the server handles all AI inference and tool execution. Model API calls happen in the main process (not inside the sandbox), while agent tool execution (bash, read, write, etc.) runs inside a zerobox sandbox with configurable filesystem and network restrictions.

```

## Matches in talkai/scripts/build-standalone.ts

### function resolveZeroboxBinary( ) › L250-254
```
    if (!pkgName) {
        console.warn(`  No zerobox platform mapping for target "${target}" — sandbox will not work in standalone binary.`);
        console.warn(`  Use --zerobox-bin <path> to specify the binary manually.`);
        return null;
    }
```

### function resolveZeroboxBinary( ) › L261-265
```
    }

    console.warn(`  zerobox binary not found at ${binPath} — sandbox will not work in standalone binary.`);
    console.warn(`  Install the platform package: npm install ${pkgName}`);
    console.warn(`  Or use --zerobox-bin <path> to specify the binary manually.`);
```

### L272-279
```
if (zeroboxBinPath) {
    console.log(`  Embedding zerobox binary: ${zeroboxBinPath}`);
    zeroboxImportLine = `import zeroboxBin from "${zeroboxBinPath}" with { type: "file" };`;
    zeroboxExportLine = `/** Path to the embedded zerobox binary in $bunfs. Set ZEROBOX_BIN to this before using Sandbox. */\nexport const zeroboxBinPath: string = zeroboxBin;`;
} else {
    zeroboxImportLine = `const zeroboxBin: string = "";`;
    zeroboxExportLine = `/** Zerobox binary not embedded — sandbox features will not work. */\nexport const zeroboxBinPath: string = zeroboxBin;`;
}
```

## Matches in talkai/src/lib/api.ts

### L231-236
```
/**
 * Get per-conversation settings (sandbox, network, MCP, etc.).
 *
 * @param id - The conversation ID
 * @returns Partial conversation settings (may be empty if no custom settings)
 */
```

### L370-376
```
/**
 * List files in the agent's sandbox workspace.
 * Returns an array of file paths relative to the workspace root.
 *
 * @param conversationId - The conversation ID
 * @returns Object with array of workspace file paths
 */
```

### L381-386
```
/**
 * Download a file from the agent's sandbox workspace.
 * Triggers a browser download of the file at the given path.
 * @param conversationId - The conversation/session ID
 * @param path - File path relative to the workspace root
 */
```

### L398-404
```
/**
 * Delete a file from the agent's sandbox workspace.
 *
 * @param conversationId - The conversation ID
 * @param path - File path relative to the workspace root
 * @returns Whether the deletion succeeded
 */
```

### L415-424
```
/**
 * Upload a file to the agent's sandbox workspace using streaming (no size limits).
 * Uses XMLHttpRequest to support upload progress reporting.
 * No encoding overhead — bytes go straight to disk.
 *
 * @param conversationId - The conversation ID
 * @param file - The file to upload
 * @param onProgress - Optional callback for upload progress
 * @returns Upload result with filename and path
 */
```

## Matches in talkai/src/lib/components/chat/chat-input.svelte

### <script lang="ts"> › interface Props › L72-81
```
        /** Pending files to upload (two-way bindable) */
        pendingFiles?: PendingFile[];
        /** Names of files already uploaded to the sandbox (read-only display) */
        sandboxFiles?: string[];
        /** Callback when user clicks a sandbox file to download it */
        ondownloadsandboxfile?: (path: string) => void;
        /** Callback when user removes an uploaded sandbox file */
        onremovesandboxfile?: (path: string) => void;
        /** Whether there are pending invisible status updates to send (enables send with empty text) */
        hasPendingStatus?: boolean;
```

### <script lang="ts"> › L105-111
```
        globalDefaultModelId = "",
        pendingFiles = $bindable<PendingFile[]>([]),
        sandboxFiles = [],
        ondownloadsandboxfile,
        onremovesandboxfile,
        hasPendingStatus = false,
        onsend,
```

### <div › L322-342
```
        </button>
    {/if}
    <!-- File chips: sandbox files (subdued) + pending files (outlined) -->
    {#if sandboxFiles.length > 0 || pendingFiles.length > 0}
        <div class="flex flex-wrap gap-1.5 pb-2">
            <!-- Sandbox files: already uploaded, subdued style -->
            {#each sandboxFiles as filename (filename)}
                <div
                    class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground bg-muted/50 max-w-50 hover:bg-muted/70 cursor-pointer transition-colors"
                    role="button"
                    tabindex="0"
                    onclick={() => ondownloadsandboxfile?.(filename)}
                    onkeydown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            ondownloadsandboxfile?.(filename);
                        }
                    }}
                    aria-label="Download {filename} from sandbox"
                >
                    <Check class="size-3 shrink-0 text-green-600" />
```


**Tool Call: Search files for regex `legacy.landlock|use-legacy-landlock|legacyLandlock|legacy_landlock`**
Status: Completed

No matches found

**Tool Call: Search files for regex `zerobox|Sandbox`**
Status: Completed

Showing matches 1-20 (there were more matches found; use offset: 20 to see next page):

## Matches in talkai/scripts/build-standalone.ts

### L25-29
```
 *   --target <target>   Bun compile target (e.g. bun-linux-x64)
 *   --outfile <path>    Output binary path (defaults to build/standalone/vessel)
 *   --zerobox-bin <path> Path to zerobox binary to embed
 *   --upx [/path/to/upx] Compress the binary with UPX after compilation.
 *                       If a path is given it is used directly; otherwise
```

### L52-59
```
const ASSETS_MODULE = join(STANDALONE_DIR, "assets.ts");

// Parse --target, --outfile, --zerobox-bin, and --upx CLI arguments.
// --target sets the Bun compile target (e.g. bun-windows-x64, bun-darwin-arm64, bun-linux-x64).
// --outfile sets the output binary path (defaults to build/standalone/vessel).
// --zerobox-bin sets the path to the zerobox binary to embed (auto-detected if omitted).
// --upx enables UPX compression of the compiled binary (auto-detects or accepts a path).
const cliArgs = process.argv.slice(2);
```

### let zeroboxBinOverride › L60-64
```
let targetFlag = "bun";
let outputFileOverride: string | null = null;
let zeroboxBinOverride: string | null = null;
let upxPath: string | null = null;
for (let i = 0; i < cliArgs.length; i++) {
```

### L68-74
```
    } else if (cliArgs[i] === "--outfile" && cliArgs[i + 1]) {
        outputFileOverride = cliArgs[i + 1];
        i++;
    } else if (cliArgs[i] === "--zerobox-bin" && cliArgs[i + 1]) {
        zeroboxBinOverride = cliArgs[i + 1];
        i++;
    } else if (cliArgs[i] === "--upx") {
```

4 lines remaining in ancestor node. Read the file to see all.

### L213-223
```
}

// --- Step 3b: Embed zerobox binary ---

// Map Bun compile targets to @zerobox/cli-* package names.
const ZEROBOX_PLATFORM_MAP: Record<string, string> = {
    "darwin-arm64": "@zerobox/cli-darwin-arm64",
    "darwin-x64": "@zerobox/cli-darwin-x64",
    "linux-arm64": "@zerobox/cli-linux-arm64",
    "linux-x64": "@zerobox/cli-linux-x64",
};
```

### L225-231
```
/**
 * Resolve the zerobox binary path for the compile target platform.
 *
 * @param target - Bun compile target (e.g. "bun-darwin-arm64", "bun", or bare "bun-linux-x64")
 * @param override - Explicit --zerobox-bin path from CLI
 * @returns Absolute path to the zerobox binary, or null if not found
 */
```

### function resolveZeroboxBinary( ) › L232-237
```
function resolveZeroboxBinary(target: string, override: string | null): string | null {
    if (override) {
        if (!existsSync(override)) {
            console.error(`  --zerobox-bin path does not exist: ${override}`);
            process.exit(1);
        }
```

30 lines remaining in ancestor node. Read the file to see all.

### function resolveZeroboxBinary( ) › const pkgName › L247-254
```
        platformKey = target.replace(/^bun-/, "");
    }
    const pkgName = ZEROBOX_PLATFORM_MAP[platformKey];
    if (!pkgName) {
        console.warn(`  No zerobox platform mapping for target "${target}" — sandbox will not work in standalone binary.`);
        console.warn(`  Use --zerobox-bin <path> to specify the binary manually.`);
        return null;
    }
```

### function resolveZeroboxBinary( ) › const binPath › L256-260
```
    // Try to find the binary in node_modules
    const pkgDir = join(projectRoot, "node_modules", pkgName);
    const binPath = join(pkgDir, "zerobox");
    if (existsSync(binPath)) {
        return binPath;
```

### function resolveZeroboxBinary( ) › L261-279
```
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
```

### const assetsModuleContent › L290-294
```

${importLines.join("\n")}
${zeroboxImportLine}

/**
```

### const assetsModuleContent › L299-303
```
${mappingEntries.join("\n")}

${zeroboxExportLine}
`;

```

## Matches in talkai/src/lib/api.ts

### L231-236
```
/**
 * Get per-conversation settings (sandbox, network, MCP, etc.).
 *
 * @param id - The conversation ID
 * @returns Partial conversation settings (may be empty if no custom settings)
 */
```

### L370-376
```
/**
 * List files in the agent's sandbox workspace.
 * Returns an array of file paths relative to the workspace root.
 *
 * @param conversationId - The conversation ID
 * @returns Object with array of workspace file paths
 */
```

### L381-386
```
/**
 * Download a file from the agent's sandbox workspace.
 * Triggers a browser download of the file at the given path.
 * @param conversationId - The conversation/session ID
 * @param path - File path relative to the workspace root
 */
```

### L398-404
```
/**
 * Delete a file from the agent's sandbox workspace.
 *
 * @param conversationId - The conversation ID
 * @param path - File path relative to the workspace root
 * @returns Whether the deletion succeeded
 */
```

### L415-424
```
/**
 * Upload a file to the agent's sandbox workspace using streaming (no size limits).
 * Uses XMLHttpRequest to support upload progress reporting.
 * No encoding overhead — bytes go straight to disk.
 *
 * @param conversationId - The conversation ID
 * @param file - The file to upload
 * @param onProgress - Optional callback for upload progress
 * @returns Upload result with filename and path
 */
```

## Matches in talkai/src/lib/components/conversation-settings/useConversationSecuritySettings.svelte.ts

### L1-3
```
/**
 * @file Reactive store for per-conversation security and sandbox settings.
 */
```

### interface ConversationSecuritySettingsState › L20-30
```
export interface ConversationSecuritySettingsState {
    loading: boolean;
    saving: boolean;
    saved: boolean;
    error: string | null;
    sandboxEnabledState: TriState;
    allowNetState: TriState;
    allowAllDomainsState: TriState;
    deleteWorkspaceWithConversation: boolean;
    useCustomReadPaths: boolean;
    readPaths: Array<{ path: string; editing?: boolean }>;
```

17 lines remaining in ancestor node. Read the file to see all.

### function createConversationSecuritySettings() › sandboxEnabledState › L185-195
```
    return {
        loading: false,
        saving: false,
        saved: false,
        error: null as string | null,
        sandboxEnabledState: null as TriState,
        allowNetState: null as TriState,
        allowAllDomainsState: null as TriState,
        deleteWorkspaceWithConversation: true,
        useCustomReadPaths: false,
        readPaths: [] as Array<{ path: string; editing?: boolean }>,
```

29 lines remaining in ancestor node. Read the file to see all.


**Tool Call: 5 matches**
Status: Completed

file:///Users/alexispurslane/Development/talkai/src/lib/server/agent/sandbox-factory.ts

file:///Users/alexispurslane/Development/talkai/src/lib/server/agent/sandboxed-fetch-tool.ts

file:///Users/alexispurslane/Development/talkai/src/lib/server/agent/sandboxed-ops.ts

file:///Users/alexispurslane/Development/talkai/src/lib/server/agent/sandboxed-search-tool.ts

file:///Users/alexispurslane/Development/talkai/src/lib/server/agent/sandboxed-tools.ts

**Tool Call: No matches**
Status: Completed

```json
{
  "offset": 0,
  "current_matches_page": [],
  "all_matches_len": 0
}
```

**Tool Call: Read file `src/lib/server/agent/sandbox-factory.ts`**
Status: Completed

```talkai/src/lib/server/agent/sandbox-factory.ts
SUCCESS: File outline retrieved. This file is too large to read all at once, so the outline below shows the file's structure with line numbers.

IMPORTANT: Do NOT retry this call without line numbers - you will get the same outline.
Instead, use the line numbers below to read specific sections by calling this tool again with start_line and end_line parameters.

# File outline for /Users/alexispurslane/Development/talkai/src/lib/server/agent/sandbox-factory.ts

const IS_LINUX [L30]
const LINUX_SYSTEM_BASH_CONFIGS [L39-43]
const USER_BASH_CONFIG_BASENAMES [L50-56]
function linuxBashConfigPaths() [L73-82]
 const home [L76]
 const userPaths [L77-79]
const SANDBOX_SETTINGS_KEYS [L87-108]
 ENABLED [L89]
 EXTRA_READ_PATHS [L91]
 EXTRA_WRITE_PATHS [L93]
 ALLOW_NET [L95]
 ALLOW_ALL_DOMAINS [L97]
 ALLOWED_NET_DOMAINS [L99]
 SECRETS [L103]
 SNAPSHOT_ENABLED [L105]
 ALLOW_ENV [L107]
interface SandboxPolicy [L112-127]
function getSetting( ) [L137-143]
 const db [L138]
 const row [L139-141]
function getJsonSetting ( ) [L152-161]
 const raw [L153]
function resolveOverride ( ) [L173-177]
interface ResolveAllowNetInput [L180-191]
function resolveAllowNet( ) [L205-227]
 const conversationAllowNet [L206]
 const conversationAllowedNetDomains [L206]
 const globalAllowNetRaw [L206]
 const globalAllowedNetDomains [L206]
 const allowAllDomains [L206]
 let result [L207]
function resolveNetDomains( ) [L235-237]
function loadSandboxPolicyFromDb( ) [L250-308]
 const globalEnabled [L252]
 const enabled [L253]
 const globalExtraReadPaths [L257-260]
 const globalExtraWritePaths [L261-264]
 const globalAllowNetRaw [L265]
 const globalAllowAllDomains [L266]
 const globalAllowedNetDomains [L267-270]
 const globalSecrets [L271-274]
 const snapshotEnabled [L275]
 const globalAllowEnv [L276-279]
 const extraReadPaths [L282]
 const extraWritePaths [L283]
 const allowEnv [L284]
 const secrets [L285]
 const allowAllDomains [L288]
 const allowNet [L291-297]
  conversationAllowNet [L292]
  conversationAllowedNetDomains [L293]
 snapshot [L304]
 secrets [L305]
async function createSessionSandbox( ) [L327-359]
 const policy [L331]
 const sessionWorkDir [L336]
 recursive [L337]
 const sandbox [L339-356]
  cwd [L340]
  allowRead [L343]
  allowWrite [L345]
  allowNet [L347]
  snapshot [L349]
  snapshotPaths [L350]
  snapshotExclude [L351]
  allowEnv [L353]
  secrets [L355]
async function createFileManagementSandbox( ) [L381-408]
 const policy [L385]
 const sessionWorkDir [L390]
 recursive [L391]
 cwd [L394]
 allowRead [L397]
 allowWrite [L398]
 allowNet [L400]
 snapshot [L402]
 snapshotPaths [L403]
 snapshotExclude [L404]
 allowEnv [L406]
function getSessionWorkDir( ) [L417-419]
function loadConversationSettingsFromDb( ) [L428-439]
 const db [L429]
 const row [L430-432]
function isNetworkAllowed( ) [L452-456]
 const globalAllowNetRaw [L453]
 const effectiveAllowNet [L454]
function getEffectiveAgentMode( ) [L468-471]
 const globalMode [L469]
function saveConversationSettingsToDb( ) [L479-485]
 const db [L480]

Showing symbols 1-90 (total symbols: 90)


NEXT STEPS: To read a specific symbol's implementation, call read_file with the same path plus start_line and end_line from the outline above.
For example, to read a function shown as [L100-150], use start_line: 100 and end_line: 150.
```


**Tool Call: Read file `src/lib/server/agent/sandboxed-ops.ts`**
Status: Completed

```talkai/src/lib/server/agent/sandboxed-ops.ts
/**
 * @file Sandboxed tool operations backed by zerobox.
 *
 * Each operations interface wraps a zerobox Sandbox instance so that
 * tool execution (bash, read, write, edit, find, ls) is confined
 * to the sandbox's filesystem and network policies.
 *
 * The agent process itself runs unsandboxed — only tool-side effects are
 * intercepted. This means the model and pi's agentic loop run normally,
 * but every file access and shell command from tools goes through zerobox.
 *
 * Note: The grep tool is NOT included because its GrepOperations interface
 * only exposes helper hooks (isDirectory, readFile) — the actual ripgrep
 * search execution runs directly on the host and can't be intercepted.
 * The agent can use bash with grep/rg commands instead.
 */

import type { Sandbox, CommandOutput } from "zerobox";
import type {
    BashOperations,
    ReadOperations,
    WriteOperations,
    EditOperations,
    FindOperations,
    LsOperations,
} from "@mariozechner/pi-coding-agent";

/** Image MIME types that the pi-coding-agent read tool can send to models. */
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
]);

// --- Bash ---

/**
 * Create sandboxed bash operations.
 * All shell commands execute inside the zerobox sandbox.
 *
 * @param sandbox - The zerobox sandbox instance to route commands through.
 * @returns BashOperations implementation backed by the sandbox.
 */
export function createSandboxedBashOps(sandbox: Sandbox): BashOperations {
    return {
        async exec(command, _cwd, options) {
            // Run the command inside the sandbox, collect all output
            const result: CommandOutput = await sandbox.exec("sh", ["-c", command]).output();

            // Dump full output as one stream — the model gets it all at once anyway.
            // onData is for TUI rendering; in our web app it just buffers into the result.
            const combined = result.stdout + result.stderr;
            if (combined) {
                options.onData(Buffer.from(combined));
            }

            return { exitCode: result.code };
        },
    };
}

// --- Read ---

/**
 * Create sandboxed read operations.
 * File reads go through zerobox so the sandbox's allowRead/denyRead policies apply.
 *
 * @param sandbox - The zerobox sandbox instance to route reads through.
 * @returns ReadOperations implementation backed by the sandbox.
 */
export function createSandboxedReadOps(sandbox: Sandbox): ReadOperations {
    return {
        async readFile(absolutePath: string): Promise<Buffer> {
            // macOS base64 needs stdin, not positional args.
            // Pipe via cat with single-quote escaping for spaces.
            const escaped = absolutePath.replace(/'/g, "'\\''");
            const output = await sandbox.exec("sh", ["-c", `cat '${escaped}' | base64`]).output();
            if (output.code !== 0) {
                throw new Error(`Failed to read ${absolutePath}: ${output.stderr}`);
            }
            return Buffer.from(output.stdout, "base64");
        },
        async access(absolutePath: string): Promise<void> {
            // oxlint-disable-next-line secure-coding/no-hardcoded-credentials
            const result = await sandbox.exec("test", ["-r", absolutePath]).output();
            if (result.code !== 0) {
                throw new Error(`File not readable: ${absolutePath}`);
            }
        },
        async detectImageMimeType(absolutePath: string): Promise<string | null> {
            // Use the file command inside the sandbox to detect MIME type.
            const output = await sandbox
                .exec("file", ["--mime-type", "-b", absolutePath])
                .output();
            if (output.code !== 0) {
                return null;
            }
            const mime = output.stdout.trim();
            return SUPPORTED_IMAGE_MIME_TYPES.has(mime) ? mime : null;
        },
    };
}

// --- Write ---

/**
 * Create sandboxed write operations.
 * File writes go through zerobox so the sandbox's allowWrite/denyWrite policies apply.
 *
 * @param sandbox - The zerobox sandbox instance to route writes through.
 * @returns WriteOperations implementation backed by the sandbox.
 */
export function createSandboxedWriteOps(sandbox: Sandbox): WriteOperations {
    return {
        async writeFile(absolutePath: string, content: string): Promise<void> {
            // Use a heredoc to safely pass content through the sandbox shell.
            // The ZEROSANDBOX_EOF delimiter is unlikely to appear in file content.
            const cmd = `cat > '${absolutePath}' << 'ZEROSANDBOX_EOF'\n${content}\nZEROSANDBOX_EOF`;
            const result = await sandbox.exec("sh", ["-c", cmd]).output();
            if (result.code !== 0) {
                throw new Error(`Failed to write ${absolutePath}: ${result.stderr}`);
            }
        },
        async mkdir(dir: string): Promise<void> {
            const result = await sandbox.exec("mkdir", ["-p", dir]).output();
            if (result.code !== 0) {
                throw new Error(`Failed to mkdir ${dir}: ${result.stderr}`);
            }
        },
    };
}

// --- Edit ---

/**
 * Create sandboxed edit operations.
 * Combines read + write through the sandbox so edits are also confined.
 *
 * @param sandbox - The zerobox sandbox instance to route edits through.
 * @returns EditOperations implementation backed by the sandbox.
 */
export function createSandboxedEditOps(sandbox: Sandbox): EditOperations {
    return {
        async readFile(absolutePath: string): Promise<Buffer> {
            const output = await sandbox.exec("cat", [absolutePath]).output();
            if (output.code !== 0) {
                throw new Error(`Failed to read ${absolutePath}: ${output.stderr}`);
            }
            return Buffer.from(output.stdout);
        },
        async writeFile(absolutePath: string, content: string): Promise<void> {
            const cmd = `cat > '${absolutePath}' << 'ZEROSANDBOX_EOF'\n${content}\nZEROSANDBOX_EOF`;
            const result = await sandbox.exec("sh", ["-c", cmd]).output();
            if (result.code !== 0) {
                throw new Error(`Failed to write ${absolutePath}: ${result.stderr}`);
            }
        },
        async access(absolutePath: string): Promise<void> {
            // oxlint-disable-next-line secure-coding/no-hardcoded-credentials
            const result = await sandbox.exec("test", ["-r", absolutePath]).output();
            if (result.code !== 0) {
                throw new Error(`File not accessible: ${absolutePath}`);
            }
        },
    };
}

// --- Find ---

/**
 * Create sandboxed find operations.
 * File existence and glob matching go through the sandbox.
 *
 * @param sandbox - The zerobox sandbox instance to route finds through.
 * @returns FindOperations implementation backed by the sandbox.
 */
export function createSandboxedFindOps(sandbox: Sandbox): FindOperations {
    return {
        exists(absolutePath: string): Promise<boolean> | boolean {
            // oxlint-disable secure-coding/no-hardcoded-credentials
            return sandbox
                .exec("test", ["-e", absolutePath])
                .output()
                .then((r) => r.code === 0);
            // oxlint-enable secure-coding/no-hardcoded-credentials
        },
        async glob(pattern: string, cwd: string, options: { ignore: string[]; limit: number }) {
            const findArgs: string[] = [cwd, "-name", pattern, "-type", "f"];
            for (const ignore of options.ignore) {
                findArgs.push("-not", "-path", `*/${ignore}/*`);
            }
            const r = await sandbox
                .exec("find", findArgs)
                .output();
            if (r.code !== 0 && !r.stdout) return [];
            return r.stdout
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
                .slice(0, options.limit);
        },
    };
}

// --- Ls ---

/**
 * Create sandboxed ls operations.
 * Directory listing and stat go through the sandbox.
 *
 * @param sandbox - The zerobox sandbox instance to route ls through.
 * @returns LsOperations implementation backed by the sandbox.
 */
export function createSandboxedLsOps(sandbox: Sandbox): LsOperations {
    return {
        exists(absolutePath: string): Promise<boolean> | boolean {
            // oxlint-disable secure-coding/no-hardcoded-credentials
            return sandbox
                .exec("test", ["-e", absolutePath])
                .output()
                .then((r) => r.code === 0);
            // oxlint-enable secure-coding/no-hardcoded-credentials
        },
        async stat(absolutePath: string) {
            // oxlint-disable-next-line secure-coding/no-hardcoded-credentials
            const dirResult = await sandbox.exec("test", ["-d", absolutePath]).output();
            const isDir = dirResult.code === 0;
            // oxlint-disable-next-line secure-coding/no-hardcoded-credentials
            const existsResult = await sandbox.exec("test", ["-e", absolutePath]).output();
            if (existsResult.code !== 0) {
                throw new Error(`path does not exist: ${absolutePath}`);
            }
            return { isDirectory: () => isDir };
        },
        readdir(absolutePath: string): Promise<string[]> | string[] {
            return sandbox
                .exec("ls", ["-1", absolutePath])
                .output()
                .then((r) => {
                    if (r.code !== 0) return [];
                    return r.stdout
                        .split("\n")
                        .map((l) => l.trim())
                        .filter(Boolean);
                });
        },
    };
}

```


**Tool Call: Read file `src/lib/server/agent/sandbox-factory.ts` (lines 1-130)**
Status: Completed

```talkai/src/lib/server/agent/sandbox-factory.ts
/**
 * @file Per-session zerobox sandbox factory.
 *
 * Each conversation gets an isolated sandbox that controls:
 * - Filesystem: agent can only read/write within its workspace
 * - Network: denied by default (tools shouldn't need network; AI inference runs outside the sandbox)
 * - Snapshots: filesystem changes are recorded for audit and undo
 *
 * Note: pi-coding-agent's model inference runs in the main process, NOT inside
 * the sandbox. Only tool execution (bash, read, write, etc.) goes through zerobox.
 * So AI provider domains and API keys are irrelevant here — they never traverse
 * the sandbox boundary.
 *
 * Settings are stored in the DB `settings` table under keys prefixed with `sandbox.`
 * and are loaded when creating a new sandbox. See the "Sandbox" tab in Settings
 * for the UI to configure these.
 */

import { Sandbox, type SecretConfig } from "zerobox";
import { resolve } from "path";
import { mkdir } from "node:fs/promises";
import { getDb } from "../db/index.js";
import { tryJsonParse } from "$lib/utils.js";
import { type ConversationSettings, conversationSettingsSchema } from "$lib/types.js";
import { log } from "$lib/server/logger.js";
import { SESSIONS_DIR } from "$lib/server/data-dir.js";

// --- Constants ---

const IS_LINUX = process.platform === "linux";

// --- Linux bash config workaround ---

/**
 * System-level bash config paths on Linux.
 *
 * These are always available at fixed paths regardless of the user's HOME.
 */
const LINUX_SYSTEM_BASH_CONFIGS: readonly string[] = [
    "/etc/profile",
    "/etc/bash.bashrc",
    "/etc/profile.d",
];

/**
 * Basenames of user-level bash config files under $HOME.
 *
 * These are joined with HOME at runtime to produce absolute paths.
 */
const USER_BASH_CONFIG_BASENAMES: readonly string[] = [
    ".bashrc",
    ".bash_profile",
    ".profile",
    ".bash_login",
    ".bash_logout",
];

/**
 * Return bash configuration file paths for the current platform.
 *
 * On Linux, returns system-level paths (e.g. `/etc/profile`) and user-level
 * paths under $HOME (e.g. `$HOME/.bashrc`) so the sandboxed child process
 * can read them directly from the filesystem in read-only mode. This avoids
 * a race condition in Codex's sandbox runtime where file descriptors passed
 * by the parent process can become invalid during the policy handoff
 * (see openai/codex#18337).
 *
 * On non-Linux platforms, returns an empty array — macOS uses Seatbelt which
 * doesn't have this race condition.
 *
 * @returns Array of absolute paths to bash config files (Linux only).
 */
function linuxBashConfigPaths(): string[] {
    if (!IS_LINUX) return [];

    const home = process.env.HOME;
    const userPaths = home
        ? USER_BASH_CONFIG_BASENAMES.map((name) => resolve(home, name))
        : [];

    return [...LINUX_SYSTEM_BASH_CONFIGS, ...userPaths];
}

// --- DB settings keys ---

/** Settings keys used for sandbox configuration. Stored in the `settings` table. */
export const SANDBOX_SETTINGS_KEYS = {
    /** Whether sandboxing is enabled (default: true) */
    ENABLED: "sandbox.enabled",
    /** JSON array of extra readable paths */
    EXTRA_READ_PATHS: "sandbox.extraReadPaths",
    /** JSON array of extra writable paths */
    EXTRA_WRITE_PATHS: "sandbox.extraWritePaths",
    /** Whether network access is allowed ("true"/"false") */
    ALLOW_NET: "sandbox.allowNet",
    /** Whether all domains are allowed when network is on ("true"/"false") */
    ALLOW_ALL_DOMAINS: "sandbox.allowAllDomains",
    /** JSON array of allowed network domains (used when allowNet is true and allowAllDomains is false) */
    ALLOWED_NET_DOMAINS: "sandbox.allowedNetDomains",
    /** JSON object of secrets: { ENV_VAR_NAME: { value: string, hosts: string[] } } */
    // Settings key name, not a real credential
    // oxlint-disable-next-line secure-coding/no-hardcoded-credentials
    SECRETS: "sandbox.secrets",
    /** Whether snapshot is enabled (default: true) */
    SNAPSHOT_ENABLED: "sandbox.snapshotEnabled",
    /** JSON array of environment variable names to allow */
    ALLOW_ENV: "sandbox.allowEnv",
} as const;

// --- Types ---

export interface SandboxPolicy {
    /** Paths the agent can write to (in addition to its session workspace) */
    extraWritePaths?: string[];
    /** Paths the agent can read from (in addition to deps dir and session workspace) */
    extraReadPaths?: string[];
    /** Whether to allow network access for tool execution */
    allowNet?: boolean | string[];
    /** Whether to allow all domains when network is on (false = use specific domains from allowNet) */
    allowAllDomains?: boolean;
    /** Whether to snapshot filesystem changes for audit/undo */
    snapshot: boolean;
    /** Secrets to inject (env var name → { value, hosts }) */
    secrets?: Record<string, SecretConfig>;
    /** Environment variable names to allow in the sandbox */
    allowEnv?: string[];
}

// --- DB helpers ---


```


**Tool Call: Read file `src/lib/server/agent/sandbox-factory.ts` (lines 130-360)**
Status: Completed

```talkai/src/lib/server/agent/sandbox-factory.ts

/**
 * Load a sandbox setting from the DB, returning undefined if not found.
 *
 * @param key - The settings key to look up.
 * @returns The setting value, or undefined if not found.
 */
function getSetting(key: string): string | undefined {
    const db = getDb();
    const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
    return row?.value;
}

/**
 * Parse a JSON setting from the DB, with a fallback default.
 *
 * @param key - The settings key to look up.
 * @param fallback - Default value if the key is missing or unparseable.
 * @returns The parsed setting value, or the fallback.
 */
function getJsonSetting<T>(key: string, fallback: T): T {
    const raw = getSetting(key);
    if (raw === undefined || raw === "") return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch (e) {
        log.debug("sandbox", "Failed to parse sandbox setting JSON, using fallback", e);
        return fallback;
    }
}

/**
 * Resolve a per-conversation override, falling back to the global default.
 *
 * Returns the conversation value if it is non-null and non-undefined;
 * otherwise returns the global value.
 *
 * @param conversationValue - Per-conversation override (null/undefined = use global).
 * @param globalValue - The global default value.
 * @returns The resolved value.
 */
function resolveOverride<T>(conversationValue: T | null | undefined, globalValue: T): T {
    return conversationValue !== null && conversationValue !== undefined
        ? conversationValue
        : globalValue;
}

/** Input for resolving the `allowNet` policy from conversation overrides and global settings. */
interface ResolveAllowNetInput {
    /** Per-conversation allowNet override (null/undefined = use global). */
    conversationAllowNet: boolean | null | undefined;
    /** Per-conversation allowed domains (used when conversation allowNet is true). */
    conversationAllowedNetDomains: string[] | null | undefined;
    /** Global raw allowNet setting string ("true"/"false"/undefined). */
    globalAllowNetRaw: string | undefined;
    /** Global allowed domains list. */
    globalAllowedNetDomains: string[];
    /** Whether all domains are allowed when net is on. */
    allowAllDomains: boolean;
}

/**
 * Resolve the `allowNet` policy from conversation overrides and global settings.
 *
 * Per-conversation `allowNet` takes precedence; if not set, the global raw
 * string value ("true"/"false"/undefined) is used.  When network access is
 * granted and `allowAllDomains` is true the result is `true`; otherwise a
 * specific domain list is returned (or `true` if no domains are configured,
 * which effectively means allow-all as a fallback).
 *
 * @param input - The resolved network policy input.
 * @returns The resolved network policy: false, true, or a domain list.
 */
function resolveAllowNet(input: ResolveAllowNetInput): boolean | string[] {
    const { conversationAllowNet, conversationAllowedNetDomains, globalAllowNetRaw, globalAllowedNetDomains, allowAllDomains } = input;
    let result: boolean | string[];

    // Per-conversation override takes precedence
    if (conversationAllowNet !== null && conversationAllowNet !== undefined) {
        if (!conversationAllowNet) {
            result = false;
        } else {
            result = allowAllDomains
                ? true
                : resolveNetDomains(conversationAllowedNetDomains ?? globalAllowedNetDomains);
        }
    } else if (globalAllowNetRaw === "true") {
        result = allowAllDomains
            ? true
            : resolveNetDomains(globalAllowedNetDomains);
    } else {
        result = false;
    }

    return result;
}

/**
 * Return the net domain list, or `true` (allow-all) as a fallback when empty.
 *
 * @param domains - The list of allowed network domains.
 * @returns The domain list, or true if empty (allow-all fallback).
 */
function resolveNetDomains(domains: string[]): boolean | string[] {
    return domains.length > 0 ? domains : true;
}

/**
 * Load the full sandbox policy from DB settings, with optional per-conversation overrides.
 *
 * Per-conversation settings (from `conversation_settings` table) override global settings.
 * A null value in the conversation settings means "use the global default."
 *
 * Returns null if sandboxing is disabled (either globally or per-conversation).
 *
 * @param conversationSettings - Optional per-conversation settings overrides.
 * @returns The resolved sandbox policy, or null if sandboxing is disabled.
 */
export function loadSandboxPolicyFromDb(conversationSettings?: ConversationSettings | null): SandboxPolicy | null {
    // Per-conversation sandboxEnabled takes precedence; null = use global default
    const globalEnabled = getSetting(SANDBOX_SETTINGS_KEYS.ENABLED);
    const enabled = conversationSettings?.sandboxEnabled ?? (globalEnabled !== "false");
    if (!enabled) return null;

    // Per-conversation overrides: null = use global, otherwise use conversation value
    const globalExtraReadPaths = getJsonSetting<string[]>(
        SANDBOX_SETTINGS_KEYS.EXTRA_READ_PATHS,
        []
    );
    const globalExtraWritePaths = getJsonSetting<string[]>(
        SANDBOX_SETTINGS_KEYS.EXTRA_WRITE_PATHS,
        []
    );
    const globalAllowNetRaw = getSetting(SANDBOX_SETTINGS_KEYS.ALLOW_NET);
    const globalAllowAllDomains = getSetting(SANDBOX_SETTINGS_KEYS.ALLOW_ALL_DOMAINS) === "true";
    const globalAllowedNetDomains = getJsonSetting<string[]>(
        SANDBOX_SETTINGS_KEYS.ALLOWED_NET_DOMAINS,
        []
    );
    const globalSecrets = getJsonSetting<Record<string, SecretConfig>>(
        SANDBOX_SETTINGS_KEYS.SECRETS,
        {}
    );
    const snapshotEnabled = getSetting(SANDBOX_SETTINGS_KEYS.SNAPSHOT_ENABLED) !== "false";
    const globalAllowEnv = getJsonSetting<string[]>(
        SANDBOX_SETTINGS_KEYS.ALLOW_ENV,
        ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "NODE_ENV"]
    );

    // Merge per-conversation overrides with global defaults
    const extraReadPaths = resolveOverride(conversationSettings?.extraReadPaths, globalExtraReadPaths);
    const extraWritePaths = resolveOverride(conversationSettings?.extraWritePaths, globalExtraWritePaths);
    const allowEnv = resolveOverride(conversationSettings?.allowEnv, globalAllowEnv);
    const secrets = resolveOverride(conversationSettings?.secrets, globalSecrets);

    // Determine allowAllDomains: conversation override takes precedence
    const allowAllDomains = resolveOverride(conversationSettings?.allowAllDomains, globalAllowAllDomains);

    // Determine allowNet: conversation override takes precedence
    const allowNet = resolveAllowNet({
        conversationAllowNet: conversationSettings?.allowNet,
        conversationAllowedNetDomains: conversationSettings?.allowedNetDomains,
        globalAllowNetRaw,
        globalAllowedNetDomains,
        allowAllDomains,
    });

    return {
        extraReadPaths,
        extraWritePaths,
        allowNet,
        allowAllDomains,
        snapshot: snapshotEnabled,
        secrets: Object.keys(secrets).length > 0 ? secrets : undefined,
        allowEnv,
    };
}

// --- Public API ---

/**
 * Create a per-session zerobox sandbox for a conversation.
 *
 * The sandbox isolates the agent's tool execution so that:
 * - Writes are confined to the session workspace
 * - Reads are allowed only from the session workspace
 * - Network is denied by default (AI inference runs outside the sandbox)
 * - Filesystem changes are snapshotted for audit
 *
 * Returns null if sandboxing is disabled in settings.
 *
 * @param conversationId - The conversation ID to create a sandbox for.
 * @param conversationSettings - Optional per-conversation settings overrides.
 * @returns A configured Sandbox instance, or null if sandboxing is disabled.
 */
export async function createSessionSandbox(
    conversationId: string,
    conversationSettings?: ConversationSettings | null
): Promise<Sandbox | null> {
    const policy = loadSandboxPolicyFromDb(conversationSettings);

    // If policy is null, sandboxing is disabled
    if (policy === null) return null;

    const sessionWorkDir = resolve(SESSIONS_DIR, conversationId, "workspace");
    await mkdir(sessionWorkDir, { recursive: true });

    const sandbox = Sandbox.create({
        cwd: sessionWorkDir,
        // Allow reads from session workspace only (not Vessel source).
        // Linux: bash configs read directly to avoid parent-FD race (openai/codex#18337).
        allowRead: [sessionWorkDir, ...linuxBashConfigPaths(), ...(policy.extraReadPaths ?? [])],
        // Allow writes only to the session workspace (plus any extra paths)
        allowWrite: [sessionWorkDir, ...(policy.extraWritePaths ?? [])],
        // Network: configured by policy (false, true, or specific domains)
        allowNet: policy.allowNet ?? false,
        // Snapshot filesystem changes for audit/undo
        snapshot: policy.snapshot,
        snapshotPaths: [sessionWorkDir],
        snapshotExclude: ["node_modules", ".git", ".upload-tmp"],
        // Environment: configured by policy
        allowEnv: policy.allowEnv ?? ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "NODE_ENV"],
        // Secrets: optional credential injection
        secrets: policy.secrets,
    });

    return sandbox;
}


```


**Tool Call: Read file `src/lib/server/agent/sandbox-factory.ts` (lines 360-410)**
Status: Completed

```talkai/src/lib/server/agent/sandbox-factory.ts

/**
 * Create a sandbox specifically for user-initiated file management operations
 * (upload, delete) on a conversation's workspace.
 *
 * Unlike the agent's sandbox (which applies the agent's read/write/network
 * restrictions), this sandbox always has full read and write access to the
 * session workspace. The user's file operations should never be blocked by
 * the agent's security policy — only the agent is restricted.
 *
 * However, snapshots ARE included (when enabled in settings) so that user
 * file changes are recorded in the same audit trail as agent operations.
 * The snapshotExclude list includes .upload-tmp so that temporary upload
 * staging files don't pollute the snapshot diffs.
 *
 * Returns null if sandboxing is disabled in settings.
 *
 * @param conversationId - The conversation ID to create a sandbox for.
 * @param conversationSettings - Optional per-conversation settings overrides.
 * @returns A configured Sandbox instance, or null if sandboxing is disabled.
 */
export async function createFileManagementSandbox(
    conversationId: string,
    conversationSettings?: ConversationSettings | null
): Promise<Sandbox | null> {
    const policy = loadSandboxPolicyFromDb(conversationSettings);

    // If policy is null, sandboxing is disabled
    if (policy === null) return null;

    const sessionWorkDir = resolve(SESSIONS_DIR, conversationId, "workspace");
    await mkdir(sessionWorkDir, { recursive: true });

    return Sandbox.create({
        cwd: sessionWorkDir,
        // Full read/write access to the workspace — user file ops are never restricted.
        // Linux: include bash config paths for FD-race workaround (openai/codex#18337).
        allowRead: [sessionWorkDir, ...linuxBashConfigPaths()],
        allowWrite: [sessionWorkDir],
        // No network needed for file management
        allowNet: false,
        // Snapshot filesystem changes for audit/undo (same as agent sandbox)
        snapshot: policy.snapshot,
        snapshotPaths: [sessionWorkDir],
        snapshotExclude: ["node_modules", ".git", ".upload-tmp"],
        // Minimal env
        allowEnv: ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG"],
    });
}

/**

```


## Assistant

Now let me look at how the zerobox Sandbox class works and what options it accepts, particularly around landlock:

**Tool Call: No matches**
Status: Completed

```json
{
  "offset": 0,
  "current_matches_page": [],
  "all_matches_len": 0
}
```

**Tool Call: No matches**
Status: Completed

```json
{
  "offset": 0,
  "current_matches_page": [],
  "all_matches_len": 0
}
```

**Tool Call: Search files for regex `from ['\"]zerobox`**
Status: Completed

Found 6 matches:

## Matches in talkai/src/lib/server/agent/sandbox-factory.ts

### L17-21
```
 */

import { Sandbox, type SecretConfig } from "zerobox";
import { resolve } from "path";
import { mkdir } from "node:fs/promises";
```

## Matches in talkai/src/lib/server/agent/sandboxed-fetch-tool.ts

### L26-30
```
import { Type, type Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Sandbox } from "zerobox";
import { Browser, BrowserErrorCaptureEnum } from "happy-dom";
import type BrowserWindow from "happy-dom/lib/window/BrowserWindow.js";
```

## Matches in talkai/src/lib/server/agent/sandboxed-ops.ts

### L16-20
```
 */

import type { Sandbox, CommandOutput } from "zerobox";
import type {
    BashOperations,
```

## Matches in talkai/src/lib/server/agent/sandboxed-tools.ts

### L1-11
```
/**
 * @file Sandboxed coding tools for pi-coding-agent.
 *
 * Builds each tool individually with custom Operations that route
 * through a zerobox Sandbox, instead of using the convenience
 * `createCodingTools()` which doesn't support per-tool operations.
 */

import type { Sandbox } from "zerobox";
import {
    createBashTool,
```

77 lines remaining in ancestor node. Read the file to see all.

## Matches in talkai/src/lib/server/agent/session-store.ts

### L47-51
```
import type { ChatSSEEvent, ActiveSession, CustomModelDef, ModelRow, SessionModelRow } from "./types.js";
import type { ConversationSettings } from "$lib/types.js";
import type { Sandbox } from "zerobox";
import { getToolRegistry, getToolDefinitions, getBaseToolDefinitions, getResourceLoaderAdapter } from "./pi-adapter.js";

```

## Matches in talkai/src/lib/server/agent/types.ts

### L56-60
```
import type { ChatSSEEvent } from "$lib/types.js";
import type { ConversationSettings } from "$lib/types.js";
import type { Sandbox } from "zerobox";

/** Internal: an active session in memory with its SSE subscribers */
```


**Tool Call: Search files for regex `zerobox`**
Status: Completed

Found 1 matches:

## Matches in talkai/package.json

### dependencies › zerobox › L90-94
```
        "pi-mcp-adapter": "^2.6.0",
        "svelte-streamdown": "^3.0.1",
        "zerobox": "^0.2.6",
        "zod": "^4.4.3"
    }
```


**Tool Call: No matches**
Status: Completed

```json
{
  "offset": 0,
  "current_matches_page": [],
  "all_matches_len": 0
}
```

**Tool Call: find talkai/node_modules/zerobox -maxdepth 2 -type f | head -30**
Status: Completed

Terminal:
```
find: talkai/node_modules/zerobox: No such file or directory





```


**Tool Call: find node_modules -maxdepth 1 -name '*zerobox*' -o -name '*zero*box*' | head -20**
Status: Completed

Terminal:
```
node_modules/@zerobox
node_modules/zerobox




```


**Tool Call: ls -la node_modules/zerobox/**
Status: Completed

Terminal:
```
total 48
drwxr-xr-x@   6 alexispurslane  staff    192 Apr 21 09:24 .
drwxr-xr-x@ 649 alexispurslane  staff  20768 May 11 20:11 ..
drwxr-xr-x@  54 alexispurslane  staff   1728 Apr 21 09:24 dist
-rw-r--r--@   1 alexispurslane  staff  11346 Apr 21 09:24 LICENSE
-rw-r--r--@   1 alexispurslane  staff   1638 Apr 21 09:24 package.json
-rw-r--r--@   1 alexispurslane  staff   5573 Apr 21 09:24 README.md

```


**Tool Call: ls node_modules/zerobox/dist/**
Status: Completed

Terminal:
```
bin.d.ts		errors.d.ts.map		flags.test.js		platforms.test.js.map
bin.d.ts.map		errors.js		flags.test.js.map	sandbox.d.ts
bin.js			errors.js.map		index.d.ts		sandbox.d.ts.map
bin.js.map		errors.test.d.ts	index.d.ts.map		sandbox.js
binary.d.ts		errors.test.d.ts.map	index.js		sandbox.js.map
binary.d.ts.map		errors.test.js		index.js.map		sandbox.test.d.ts
binary.js		errors.test.js.map	platforms.d.ts		sandbox.test.d.ts.map
binary.js.map		flags.d.ts		platforms.d.ts.map	sandbox.test.js
command.d.ts		flags.d.ts.map		platforms.js		sandbox.test.js.map
command.d.ts.map	flags.js		platforms.js.map	types.d.ts
command.js		flags.js.map		platforms.test.d.ts	types.d.ts.map
command.js.map		flags.test.d.ts		platforms.test.d.ts.map	types.js
errors.d.ts		flags.test.d.ts.map	platforms.test.js	types.js.map

```


**Tool Call: cat node_modules/zerobox/dist/sandbox.d.ts**
Status: Completed

Terminal:
```
import { ShellCommand } from "./command.js";
import type { SandboxOptions } from "./types.js";
export declare class Sandbox {
    readonly options: Readonly<SandboxOptions>;
    private readonly bin;
    private readonly flags;
    private constructor();
    /** Create a new Sandbox instance. Verifies the binary is reachable. */
    static create(options?: SandboxOptions): Sandbox;
    /**
     * Execute a shell command via tagged template literal.
     *
     * Returns a `ShellCommand` builder. Chain with:
     * - `.text()` — stdout as string (throws on non-zero exit)
     * - `.json()` — parse stdout as JSON (throws on non-zero exit)
     * - `.output()` — raw `{ code, stdout, stderr }` (never throws)
     *
     * @example
     * ```ts
     * const output = await sandbox.sh`echo hello`.text();
     * const data = await sandbox.sh`cat data.json`.json();
     * const raw = await sandbox.sh`ls`.output();
     * ```
     */
    sh(strings: TemplateStringsArray, ...values: unknown[]): ShellCommand;
    /**
     * Execute inline JavaScript via Node.js.
     *
     * Returns a `ShellCommand` builder (same `.text()`, `.json()`, `.output()` API).
     *
     * @example
     * ```ts
     * const output = await sandbox.js`console.log(1 + 1)`.text();
     * const data = await sandbox.js`
     *   const result = { sum: 1 + 1 };
     *   console.log(JSON.stringify(result));
     * `.json();
     * ```
     */
    js(strings: TemplateStringsArray, ...values: unknown[]): ShellCommand;
    /**
     * Execute a command with explicit arguments.
     *
     * Returns a `ShellCommand` builder (same `.text()`, `.json()`, `.output()` API).
     *
     * @example
     * ```ts
     * const result = await sandbox.exec("node", ["-e", "console.log('hi')"]).text();
     * ```
     */
    exec(cmd: string, args?: string[]): ShellCommand;
    /** Support `await using sandbox = Sandbox.create()`. */
    [Symbol.asyncDispose](): Promise<void>;
}
//# sourceMappingURL=sandbox.d.ts.map
```


**Tool Call: cat node_modules/zerobox/dist/types.d.ts**
Status: Completed

Terminal:
```
/** Options for creating a Sandbox instance. Maps to zerobox CLI flags. */
export interface SandboxOptions {
    /**
     * Named profile(s) to use. A list is merged left-to-right; later entries
     * override earlier ones on conflicting fields. Defaults to "workspace"
     * (CWD read/write, no network).
     */
    profile?: string | string[];
    /** Restrict readable paths. System libraries remain accessible. */
    allowRead?: string[];
    /** Block reading from these paths. Takes precedence over allowRead. */
    denyRead?: string[];
    /** Allow writing to these paths. Empty array = allow all writes. */
    allowWrite?: string[];
    /** Block writing to these paths. Takes precedence over allowWrite. */
    denyWrite?: string[];
    /** Allow network. true = all, string[] = specific domains. */
    allowNet?: boolean | string[];
    /** Block network to these domains. Takes precedence over allowNet. */
    denyNet?: string[];
    /** Grant all permissions (no sandbox). */
    allowAll?: boolean;
    /** Working directory for sandboxed commands. */
    cwd?: string;
    /** Disable the sandbox entirely. */
    noSandbox?: boolean;
    /** Require full sandbox. Fail instead of falling back to weaker isolation. */
    strictSandbox?: boolean;
    /** Show sandbox configuration and runtime decisions on stderr. */
    debug?: boolean;
    /** Record filesystem changes during execution. */
    snapshot?: boolean;
    /** Record and restore tracked files to pre-execution state after exit. */
    restore?: boolean;
    /** Paths to track for snapshots (default: cwd). */
    snapshotPaths?: string[];
    /** Exclude patterns from snapshots. */
    snapshotExclude?: string[];
    /** Explicit environment variables for the sandbox. */
    env?: Record<string, string>;
    /** Inherit parent env vars. true = all (default), string[] = only listed keys. */
    allowEnv?: boolean | string[];
    /** Drop these parent env vars. Takes precedence over allowEnv. */
    denyEnv?: string[];
    /**
     * Secrets with host-scoped network access. Each key becomes an env var
     * in the sandbox. The hosts are merged into network permissions.
     */
    secrets?: Record<string, SecretConfig>;
}
/** Configuration for a secret passed to the sandbox. */
export interface SecretConfig {
    /** The secret value (e.g., an API key). */
    value: string;
    /** Domains where this secret is needed. Merged into allowNet. */
    hosts: string[];
}
/** Raw output from a sandboxed command. */
export interface CommandOutput {
    /** Exit code of the process. */
    code: number;
    /** Captured stdout as string. */
    stdout: string;
    /** Captured stderr as string. */
    stderr: string;
}
/** Options for command execution. */
export interface CommandOptions {
    /** Abort signal for cancellation. */
    signal?: AbortSignal;
}
//# sourceMappingURL=types.d.ts.map
```


**Tool Call: cat node_modules/zerobox/dist/flags.d.ts**
Status: Completed

Terminal:
```
import type { SandboxOptions } from "./types.js";
/** Build CLI flags from SandboxOptions. */
export declare function buildFlags(options: SandboxOptions): string[];
//# sourceMappingURL=flags.d.ts.map


```


**Tool Call: cat node_modules/zerobox/dist/flags.js**
Status: Completed

Terminal:
```
/** Build CLI flags from SandboxOptions. */
export function buildFlags(options) {
    const flags = [];
    // Collect secret hosts for network permission merging.
    const secretHosts = [];
    if (options.secrets) {
        for (const [key, config] of Object.entries(options.secrets)) {
            flags.push("--secret", `${key}=${config.value}`);
            if (config.hosts.length > 0) {
                flags.push("--secret-host", `${key}=${config.hosts.join(",")}`);
                secretHosts.push(...config.hosts);
            }
        }
    }
    if (options.strictSandbox) {
        flags.push("--strict-sandbox");
    }
    if (options.debug) {
        flags.push("--debug");
    }
    if (options.allowAll) {
        flags.push("--allow-all");
    }
    else if (options.noSandbox) {
        flags.push("--no-sandbox");
    }
    else {
        const explicit = Array.isArray(options.profile)
            ? options.profile
            : options.profile
                ? [options.profile]
                : [];
        const profiles = explicit.length > 0 ? explicit : ["workspace"];
        for (const p of profiles) {
            flags.push("--profile", p);
        }
        if (options.allowRead?.length) {
            flags.push(`--allow-read=${options.allowRead.join(",")}`);
        }
        if (options.denyRead?.length) {
            flags.push(`--deny-read=${options.denyRead.join(",")}`);
        }
        if (options.allowWrite?.length) {
            flags.push(`--allow-write=${options.allowWrite.join(",")}`);
        }
        if (options.denyWrite?.length) {
            flags.push(`--deny-write=${options.denyWrite.join(",")}`);
        }
        // Merge secret hosts into allowNet (secrets auto-enable network for their hosts).
        // The CLI also does this, but we emit it here so --allow-net reflects the full picture.
        let effectiveAllowNet = options.allowNet;
        if (secretHosts.length > 0) {
            if (effectiveAllowNet === true) {
                // Already allowing all network.
            }
            else if (Array.isArray(effectiveAllowNet)) {
                effectiveAllowNet = [...effectiveAllowNet, ...secretHosts];
            }
            else {
                // Network was not explicitly enabled; secrets handle it via --secret-host.
                // Don't emit --allow-net here — the CLI enables network implicitly for secret hosts.
            }
        }
        if (effectiveAllowNet === true) {
            flags.push("--allow-net");
        }
        else if (Array.isArray(effectiveAllowNet) && effectiveAllowNet.length > 0) {
            flags.push(`--allow-net=${effectiveAllowNet.join(",")}`);
        }
        if (options.denyNet?.length) {
            flags.push(`--deny-net=${options.denyNet.join(",")}`);
        }
    }
    // Env flags — emitted for all modes (including allowAll).
    if (options.allowEnv === true) {
        flags.push("--allow-env");
    }
    else if (Array.isArray(options.allowEnv) && options.allowEnv.length > 0) {
        flags.push(`--allow-env=${options.allowEnv.join(",")}`);
    }
    if (options.denyEnv?.length) {
        flags.push(`--deny-env=${options.denyEnv.join(",")}`);
    }
    if (options.env) {
        for (const [key, value] of Object.entries(options.env)) {
            flags.push("--env", `${key}=${value}`);
        }
    }
    if (options.cwd) {
        flags.push("-C", options.cwd);
    }
    if (options.restore) {
        flags.push("--restore");
    }
    else if (options.snapshot) {
        flags.push("--snapshot");
    }
    if (options.snapshotPaths?.length) {
        flags.push(`--snapshot-path=${options.snapshotPaths.join(",")}`);
    }
    if (options.snapshotExclude?.length) {
        flags.push(`--snapshot-exclude=${options.snapshotExclude.join(",")}`);
    }
    return flags;
}
//# sourceMappingURL=flags.js.map
```


**Tool Call: cat node_modules/zerobox/dist/bin.js**
Status: Completed

Terminal:
```
#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { existsSync, openSync, readSync, closeSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { platformPackage } from "./platforms.js";
const __filename = fileURLToPath(import.meta.url);
function resolveBinary() {
    // 1. Explicit override.
    if (process.env.ZEROBOX_BIN) {
        return process.env.ZEROBOX_BIN;
    }
    // 2. Platform-specific optional dependency.
    const pkg = platformPackage();
    if (pkg) {
        try {
            const nodeRequire = createRequire(import.meta.url);
            const dir = dirname(nodeRequire.resolve(`${pkg}/package.json`));
            const bin = join(dir, "zerobox");
            if (existsSync(bin)) {
                return bin;
            }
        }
        catch {
            // Package not installed.
        }
    }
    // 3. Fall back to PATH, skipping our own shim to avoid infinite recursion.
    const pathDirs = (process.env.PATH ?? "").split(delimiter);
    let selfPath;
    try {
        selfPath = realpathSync(__filename);
    }
    catch {
        // Ignore.
    }
    for (const dir of pathDirs) {
        const candidate = join(dir, "zerobox");
        try {
            if (!existsSync(candidate))
                continue;
            const resolved = realpathSync(candidate);
            if (selfPath && resolved === selfPath)
                continue;
            // Read only the first 64 bytes to check for a Node.js shebang
            // without loading the entire (potentially multi-MB) binary.
            if (isNodeScript(candidate))
                continue;
            return candidate;
        }
        catch {
            continue;
        }
    }
    console.error("error: zerobox binary not found.\n\n" +
        "Install the package to get the binary:\n" +
        "  npm install zerobox\n\n" +
        "Or set the path manually:\n" +
        "  export ZEROBOX_BIN=/path/to/zerobox\n");
    process.exit(1);
}
/** Check if a file starts with a Node.js shebang without reading the whole file. */
function isNodeScript(path) {
    const buf = Buffer.alloc(64);
    let fd;
    try {
        fd = openSync(path, "r");
        readSync(fd, buf, 0, 64, 0);
        const head = buf.toString("utf8");
        return head.startsWith("#!") && head.includes("node");
    }
    catch {
        return false;
    }
    finally {
        if (fd !== undefined)
            closeSync(fd);
    }
}
try {
    execFileSync(resolveBinary(), process.argv.slice(2), {
        stdio: "inherit",
    });
}
catch (e) {
    const err = e;
    if (err.status != null) {
        process.exit(err.status);
    }
    console.error(`error: ${err.message ?? e}`);
    process.exit(1);
}
//# sourceMappingURL=bin.js.map
```


**Tool Call: cat node_modules/zerobox/README.md**
Status: Completed

Terminal:
```
# Zerobox TypeScript SDK

<p>
  <a href="https://www.npmjs.com/package/zerobox" target="_blank">
    <img src="https://img.shields.io/npm/v/zerobox?style=for-the-badge&labelColor=000000&label=npm" alt="Zerobox npm version" />
  </a>
  <a href="https://github.com/afshinm/zerobox/blob/main/LICENSE" target="_blank">
    <img src="https://img.shields.io/github/license/afshinm/zerobox?style=for-the-badge&labelColor=000000" alt="Zerobox license" />
  </a>
</p>

TypeScript / Node SDK for [zerobox](https://github.com/afshinm/zerobox). Sandbox any command with file, network, and credential controls.

```bash
npm install zerobox
```

Installing the package drops the `zerobox` CLI into your `node_modules/.bin/` and exposes a TypeScript SDK.

> For CLI usage, secrets concepts, the full flag reference, performance numbers, and platform support see the [main README](https://github.com/afshinm/zerobox).

## Quick start

```ts
import { Sandbox } from "zerobox";

const sandbox = Sandbox.create({ allowWrite: ["/tmp"] });
const output = await sandbox.sh`echo hello`.text();
```

## Commands

The SDK exposes three ways to run a command. Each returns a `ShellCommand` you terminate with `.text()`, `.json()`, or `.output()`.

### Shell (tagged template)

```ts
const name = "world";
await sandbox.sh`echo hello ${name}`.text();
```

### Inline JavaScript

```ts
const data = await sandbox.js`
  console.log(JSON.stringify({ sum: 1 + 2 }));
`.json<{ sum: number }>();
```

### Explicit command + args

```ts
await sandbox.exec("node", ["-e", "console.log('hi')"]).text();
```

## Results

| Method | On success | On non-zero exit |
| --- | --- | --- |
| `.text()` | Returns stdout as a string | Throws `SandboxCommandError` |
| `.json<T>()` | Parses stdout as JSON (typed) | Throws `SandboxCommandError` |
| `.output()` | Returns `{ code, stdout, stderr }` | Returns the same shape, never throws |

```ts
const data = await sandbox.sh`cat data.json`.json();
const result = await sandbox.sh`exit 42`.output();
// { code: 42, stdout: "", stderr: "" }
```

## Error handling

Non-zero exit codes throw `SandboxCommandError`:

```ts
import { Sandbox, SandboxCommandError } from "zerobox";

const sandbox = Sandbox.create();
try {
  await sandbox.sh`exit 1`.text();
} catch (e) {
  if (e instanceof SandboxCommandError) {
    console.log(e.code);
    console.log(e.stderr);
  }
}
```

## Secrets

Pass API keys that the sandboxed process never sees. The proxy substitutes the real value only for approved hosts.

```ts
const sandbox = Sandbox.create({
  secrets: {
    OPENAI_API_KEY: {
      value: process.env.OPENAI_API_KEY!,
      hosts: ["api.openai.com"],
    },
    GITHUB_TOKEN: {
      value: process.env.GITHUB_TOKEN!,
      hosts: ["api.github.com"],
    },
  },
});

await sandbox.sh`node agent.js`.text();
```

See the [main README](https://github.com/afshinm/zerobox#secrets) for how placeholder substitution works.

## Snapshots

Record filesystem changes and roll them back automatically:

```ts
const sandbox = Sandbox.create({
  allowWrite: ["."],
  restore: true,
});

await sandbox.sh`npm install`.text();
```

Record without rolling back:

```ts
const sandbox = Sandbox.create({
  allowWrite: ["."],
  snapshot: true,
  snapshotExclude: ["node_modules"],
});

await sandbox.sh`npm install`.text();
```

## Cancellation

Pass an `AbortSignal` to any terminator:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 1000);
await sandbox.sh`sleep 60`.text({ signal: controller.signal });
```

## Environment variables

```ts
const sandbox = Sandbox.create({
  env: { NODE_ENV: "production" },
  allowEnv: ["PATH", "HOME"],
  denyEnv: ["AWS_SECRET_ACCESS_KEY"],
});
```

See the [main README](https://github.com/afshinm/zerobox#environment-variables) for what's inherited by default and the CLI equivalents.

## Options

`Sandbox.create(options)` accepts a `SandboxOptions` object. All fields are optional.

| Field | Type | Description |
| --- | --- | --- |
| `profile` | `string \| string[]` | Named profile(s). A list merges left-to-right. Default `"workspace"`. |
| `allowRead` / `denyRead` | `string[]` | Readable / blocked paths. |
| `allowWrite` / `denyWrite` | `string[]` | Writable / blocked paths. |
| `allowNet` | `boolean \| string[]` | `true` allows all. A list restricts to those domains. |
| `denyNet` | `string[]` | Blocked domains. |
| `allowAll` | `boolean` | Full filesystem + network access. |
| `noSandbox` | `boolean` | Disable the sandbox entirely. |
| `strictSandbox` | `boolean` | Fail instead of falling back to weaker isolation. |
| `cwd` | `string` | Working directory. |
| `env` | `Record<string, string>` | Explicit env vars. |
| `allowEnv` | `boolean \| string[]` | Inherit parent env vars. |
| `denyEnv` | `string[]` | Blocked env vars. |
| `snapshot` | `boolean` | Record filesystem changes. |
| `restore` | `boolean` | Record and roll back after exit. Implies `snapshot`. |
| `snapshotPaths` / `snapshotExclude` | `string[]` | Tracked paths / excluded patterns. |
| `secrets` | `Record<string, SecretConfig>` | Secrets with per-host scopes. |
| `debug` | `boolean` | Print sandbox config to stderr. |

## Caveats

Node.js `fetch` does not respect `HTTPS_PROXY` by default. When running Node inside a sandbox with secrets, pass `--use-env-proxy` to the sandboxed command.

## Other SDKs

- [Python SDK](https://github.com/afshinm/zerobox/tree/main/sdks/python) (PyPI: `zerobox`)
- [Rust SDK](https://github.com/afshinm/zerobox/tree/main/crates/zerobox) (crates.io: `zerobox`)

## License

Apache-2.0

```


## Assistant

Now let me look at the actual zerobox binary to understand the `--use-legacy-landlock` flag and the "split sandbox policies" issue:

**Tool Call: ls node_modules/@zerobox/**
Status: Completed

Terminal:
```
cli-darwin-arm64





```


**Tool Call: ls node_modules/@zerobox/cli-darwin-arm64/**
Status: Completed

Terminal:
```
LICENSE		package.json	README.md	zerobox





```


## Assistant

So there's only a macOS binary installed locally. The user is running on Linux. Let me look at the zerobox Rust source for the error message:

**Tool Call: cat node_modules/zerobox/dist/platforms.js**
Status: Completed

Terminal:
```
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
const GLIBC_PLATFORMS = {
    "darwin-arm64": "@zerobox/cli-darwin-arm64",
    "darwin-x64": "@zerobox/cli-darwin-x64",
    "linux-arm64": "@zerobox/cli-linux-arm64",
    "linux-x64": "@zerobox/cli-linux-x64",
};
const MUSL_PLATFORMS = {
    "linux-arm64": "@zerobox/cli-linux-arm64-musl",
    "linux-x64": "@zerobox/cli-linux-x64-musl",
};
// Map Node.js arch names to musl dynamic linker filenames.
const MUSL_LINKER = {
    arm64: "/lib/ld-musl-aarch64.so.1",
    x64: "/lib/ld-musl-x86_64.so.1",
};
function realEnv() {
    return {
        platform: process.platform,
        arch: process.arch,
        linkerExists: (path) => existsSync(path),
        glibcVersion: () => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- process.report can be undefined in older Node
                const report = process.report?.getReport();
                return report?.header?.glibcVersionRuntime;
            }
            catch {
                return undefined;
            }
        },
        lddOutput: () => {
            try {
                return execSync("ldd --version 2>&1 || true", {
                    encoding: "utf8",
                    timeout: 3000,
                });
            }
            catch {
                return undefined;
            }
        },
        osRelease: () => {
            try {
                return readFileSync("/etc/os-release", "utf8");
            }
            catch {
                return undefined;
            }
        },
    };
}
/**
 * Detect if the system uses musl libc.
 *
 * Detection order (fastest and most reliable first):
 *   1. Check for musl dynamic linker on disk (no spawning, works on Alpine)
 *   2. Check Node.js process.report for glibc version (no spawning)
 *   3. Fall back to `ldd --version` output (spawns a process)
 *   4. Check /etc/os-release for Alpine (last resort)
 */
export function detectMusl(env) {
    if (env.platform !== "linux")
        return false;
    // 1. Check for musl dynamic linker file.
    const linker = MUSL_LINKER[env.arch];
    if (linker && env.linkerExists(linker)) {
        return true;
    }
    // 2. If Node.js reports a glibc version, it's glibc.
    if (env.glibcVersion()) {
        return false;
    }
    // 3. Check ldd output.
    const ldd = env.lddOutput();
    if (ldd) {
        const lower = ldd.toLowerCase();
        if (lower.includes("musl"))
            return true;
        if (lower.includes("gnu"))
            return false;
    }
    // 4. Check /etc/os-release for Alpine.
    const osRelease = env.osRelease();
    if (osRelease?.toLowerCase().includes("alpine")) {
        return true;
    }
    return false;
}
/** Resolve the platform-specific npm package name for the current system. */
export function platformPackage(env) {
    const e = env ?? realEnv();
    const key = `${e.platform}-${e.arch}`;
    if (e.platform === "linux" && detectMusl(e)) {
        return MUSL_PLATFORMS[key] ?? GLIBC_PLATFORMS[key];
    }
    return GLIBC_PLATFORMS[key];
}
//# sourceMappingURL=platforms.js.map
```


**Tool Call: cat node_modules/zerobox/dist/sandbox.js**
Status: Completed

Terminal:
```
import { verifyBinary } from "./binary.js";
import { ShellCommand } from "./command.js";
import { buildFlags } from "./flags.js";
export class Sandbox {
    options;
    bin;
    flags;
    constructor(options, bin) {
        this.options = Object.freeze({ ...options });
        this.bin = bin;
        this.flags = buildFlags(this.options);
    }
    /** Create a new Sandbox instance. Verifies the binary is reachable. */
    static create(options = {}) {
        const bin = verifyBinary();
        return new Sandbox(options, bin);
    }
    /**
     * Execute a shell command via tagged template literal.
     *
     * Returns a `ShellCommand` builder. Chain with:
     * - `.text()` — stdout as string (throws on non-zero exit)
     * - `.json()` — parse stdout as JSON (throws on non-zero exit)
     * - `.output()` — raw `{ code, stdout, stderr }` (never throws)
     *
     * @example
     * ```ts
     * const output = await sandbox.sh`echo hello`.text();
     * const data = await sandbox.sh`cat data.json`.json();
     * const raw = await sandbox.sh`ls`.output();
     * ```
     */
    sh(strings, ...values) {
        const command = strings.reduce((acc, str, i) => acc + str + (i < values.length ? String(values[i]) : ""), "");
        return new ShellCommand(this.bin, this.flags, "sh", ["-c", command]);
    }
    /**
     * Execute inline JavaScript via Node.js.
     *
     * Returns a `ShellCommand` builder (same `.text()`, `.json()`, `.output()` API).
     *
     * @example
     * ```ts
     * const output = await sandbox.js`console.log(1 + 1)`.text();
     * const data = await sandbox.js`
     *   const result = { sum: 1 + 1 };
     *   console.log(JSON.stringify(result));
     * `.json();
     * ```
     */
    js(strings, ...values) {
        const code = strings.reduce((acc, str, i) => acc + str + (i < values.length ? String(values[i]) : ""), "");
        return new ShellCommand(this.bin, this.flags, "node", ["-e", code]);
    }
    /**
     * Execute a command with explicit arguments.
     *
     * Returns a `ShellCommand` builder (same `.text()`, `.json()`, `.output()` API).
     *
     * @example
     * ```ts
     * const result = await sandbox.exec("node", ["-e", "console.log('hi')"]).text();
     * ```
     */
    exec(cmd, args = []) {
        return new ShellCommand(this.bin, this.flags, cmd, args);
    }
    /** Support `await using sandbox = Sandbox.create()`. */
    async [Symbol.asyncDispose]() {
        // No-op. Each command is a fresh process, nothing to clean up.
    }
}
//# sourceMappingURL=sandbox.js.map
```


**Tool Call: cat node_modules/zerobox/dist/command.js**
Status: Completed

Terminal:
```
import { execFile } from "node:child_process";
import { SandboxCommandError } from "./errors.js";
/** Execute a command and return a promise of the raw output. */
function run(bin, argv, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (fn, value) => {
            if (!settled) {
                settled = true;
                fn(value);
            }
        };
        if (signal?.aborted) {
            reject(new DOMException("The operation was aborted.", "AbortError"));
            return;
        }
        const child = execFile(bin, argv, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error && error.code === "ENOENT") {
                settle(reject, new Error(`zerobox binary not found at "${bin}". Set ZEROBOX_BIN or install it.`));
                return;
            }
            let code = 0;
            if (error) {
                code = typeof error.code === "number" ? error.code : 1;
            }
            settle(resolve, { code, stdout, stderr });
        });
        if (signal) {
            const onAbort = () => {
                child.kill();
                settle(reject, new DOMException("The operation was aborted.", "AbortError"));
            };
            signal.addEventListener("abort", onAbort, { once: true });
            child.on("close", () => {
                signal.removeEventListener("abort", onAbort);
            });
        }
    });
}
/**
 * A builder returned by `sandbox.sh` or `sandbox.exec`.
 * Chain with `.text()`, `.json()`, or `.output()` to execute.
 */
export class ShellCommand {
    bin;
    argv;
    constructor(bin, flags, cmd, args) {
        this.bin = bin;
        this.argv = [...flags, "--", cmd, ...args];
    }
    /** Execute and return stdout as a string. Throws on non-zero exit. */
    async text(options) {
        const result = await run(this.bin, this.argv, options?.signal);
        if (result.code !== 0) {
            throw new SandboxCommandError(result);
        }
        return result.stdout;
    }
    /** Execute and parse stdout as JSON. Throws on non-zero exit. */
    async json(options) {
        const text = await this.text(options);
        return JSON.parse(text);
    }
    /** Execute and return raw output. Does NOT throw on non-zero exit. */
    async output(options) {
        return run(this.bin, this.argv, options?.signal);
    }
}
//# sourceMappingURL=command.js.map
```


## Assistant

Now I understand the architecture. The TS SDK builds CLI flags and passes them to the zerobox binary. The error about `--use-legacy-landlock` and "split sandbox policies" comes from the zerobox binary itself (Rust code). Let me look at the zerobox GitHub repo for this:

**Tool Call: Fetch https://github.com/afshinm/zerobox**
Status: Completed

Skip to content                                                                         

## Navigation Menu

      Toggle navigation                                                                                                                Sign in                                         Appearance settings                                                                                                                         Search or jump to...                                                      

# Search code, repositories, users, issues, pull requests...

                                                           Search                                                                                                                                             Clear                                                                        

                                                                                  Search syntax tips                                                              

#         Provide feedback       

                                                                   

We read every piece of feedback, and take your input very seriously.                              Include my email address so I can be contacted                          Cancel              Submit feedback                          

#         Saved searches       

        

## Use saved searches to filter your results more quickly

                                                                                                          Name                                                                                    Query                                

            To see all available qualifiers, see our documentation.                                                                       Cancel              Create saved search                                                Sign in                                                         Sign up                                               Appearance settings                      Resetting focus                                                 You signed in with another tab or window. Reload to refresh your session.        You signed out in another tab or window. Reload to refresh your session.        You switched accounts on another tab or window. Reload to refresh your session.          Dismiss alert                                                                                                                               afshinm        /    **      zerobox    **    Public                              
               -                     Notifications    You must be signed in to change notification settings  
  -                   Fork     33  
  -                                   Star          583  

                                                                          

# afshinm/zerobox

 mainBranchesTagsGo to fileCodeOpen more actions menu

## Folders and files

| Name | Name | Last commit message | Last commit date |
| --- | --- | --- | --- |
| 

## Latest commit

 

## History

238 Commits238 Commits |
| .changeset | .changeset |   |   |
| .github/workflows | .github/workflows |   |   |
| bench | bench |   |   |
| crates | crates |   |   |
| examples | examples |   |   |
| packages | packages |   |   |
| scripts | scripts |   |   |
| sdks/python | sdks/python |   |   |
| .gitignore | .gitignore |   |   |
| Cargo.lock | Cargo.lock |   |   |
| Cargo.toml | Cargo.toml |   |   |
| LICENSE | LICENSE |   |   |
| README.md | README.md |   |   |
| SECURITY.md | SECURITY.md |   |   |
| UPSTREAM_VERSION | UPSTREAM_VERSION |   |   |
| deny.toml | deny.toml |   |   |
| dist-workspace.toml | dist-workspace.toml |   |   |
| install.sh | install.sh |   |   |
| package.json | package.json |   |   |
| pnpm-lock.yaml | pnpm-lock.yaml |   |   |
| pnpm-workspace.yaml | pnpm-workspace.yaml |   |   |
| tsconfig.base.json | tsconfig.base.json |   |   |
| View all files |

## Repository files navigation

  

# 🫙 Zerobox

  

**Sandbox any command with file, network, and credential controls.**  

                                                                        

Lightweight, cross-platform process sandboxing powered by OpenAI Codex's sandbox runtime.
- **Deny by default:** Writes, network, and environment variables are blocked unless you allow them
- **Credential injection:** Pass API keys that the process never sees. Zerobox injects real values only for approved hosts
- **File access control:** Allow or deny reads and writes to specific paths
- **Network filtering:** Allow or deny outbound traffic by domain
- **Clean environment:** Only essential env vars (PATH, HOME, etc.) are inherited by default
- **SDKs for Rust, TypeScript, and Python** with a consistent API across languages
- **Cross-platform:** macOS and Linux. Windows support planned
- **Single binary:** No Docker, no VMs, ~10ms overhead

        

## Install

| Channel | Command |
| --- | --- |
| Shell (macOS / Linux) | `curl -fsSL https://raw.githubusercontent.com/afshinm/zerobox/main/install.sh | sh` |
| npm | `npm install -g zerobox` |
| PyPI | `pip install zerobox` |
| Cargo | `cargo install zerobox` |
| From source | `git clone https://github.com/afshinm/zerobox && cd zerobox && ./scripts/sync.sh && cargo build --release -p zerobox` |

## Quick start

Run a command with no writes and no network access:

```
zerobox -- node -e "console.log('hello')"
```

Allow writes to a specific directory:

```
zerobox --allow-write=. -- node script.js
```

Allow network to a specific domain:

```
zerobox --allow-net=api.openai.com -- node agent.js
```

Pass a secret to a specific host and the inner process never sees the real value:

```
zerobox --secret OPENAI_API_KEY=sk-proj-123 --secret-host OPENAI_API_KEY=api.openai.com -- node agent.js
```

Record filesystem changes and undo them after execution:

```
zerobox --restore --allow-write=. -- npm install
```

Or record without restoring, then inspect and undo later:

```
zerobox --snapshot --allow-write=. -- npm install
zerobox snapshot list
zerobox snapshot diff <session-id>
zerobox snapshot restore <session-id>
```

For programmatic usage jump to the SDK that matches your stack:
- Rust SDK
- TypeScript SDK
- Python SDK

## Architecture

  

## Secrets

Secrets are API keys, tokens, or credentials that should never be visible inside the sandbox. The sandboxed process sees a placeholder in the environment variable and the real value is substituted at the network proxy level only for requested hosts.

```
sandbox process: echo $OPENAI_API_KEY
  -> ZEROBOX_SECRET_a1b2c3d4e5...  (placeholder)

sandbox process: curl -H "Authorization: Bearer $OPENAI_API_KEY" https://api.openai.com/...
  -> proxy intercepts, replaces placeholder with real key
  -> server receives: Authorization: Bearer sk-proj-123

```

Pass a secret with `--secret` and restrict it to a specific domain with `--secret-host`:

```
zerobox --secret OPENAI_API_KEY=sk-proj-123 --secret-host OPENAI_API_KEY=api.openai.com -- node app.js
```

Without `--secret-host`, the secret is passed to all domains:

```
zerobox --secret TOKEN=abc123 -- node app.js
```

Multiple secrets with different hosts:

```
zerobox \
  --secret OPENAI_API_KEY=sk-proj-123 --secret-host OPENAI_API_KEY=api.openai.com \
  --secret GITHUB_TOKEN=ghp-456 --secret-host GITHUB_TOKEN=api.github.com \
  -- node app.js
```

Node.js `fetch` does not respect `HTTPS_PROXY` by default. When running Node.js inside a sandbox with secrets, make sure to pass the `--use-env-proxy` argument.

For SDK code examples, see the Rust, TypeScript, or Python README.

## Environment variables

By default only essential variables are passed to the sandbox, e.g. `PATH`, `HOME`, `USER`, `SHELL`, `TERM`, `LANG`.

Inherit all parent env vars:

```
zerobox --allow-env -- node app.js
```

Inherit specific env vars only:

```
zerobox --allow-env=PATH,HOME,DATABASE_URL -- node app.js
```

Block specific env vars:

```
zerobox --allow-env --deny-env=AWS_SECRET_ACCESS_KEY -- node app.js
```

Or set explicit variables:

```
zerobox --env NODE_ENV=production --env DEBUG=false -- node app.js
```

## Examples

### Run AI-generated code safely

Run AI-generated code without risking file corruption or data leaks:

```
zerobox -- python3 /tmp/task.py
```

Or allow writes only to an output directory:

```
zerobox --allow-write=/tmp/output -- python3 /tmp/task.py
```

### Restrict LLM tool calls

Each AI tool call can be sandboxed individually. The parent agent process runs normally and only some operations are sandboxed. Full working examples:
- `examples/ai-agent-sandboxed` wraps the entire agent process with secrets so the API key is never visible
- `examples/ai-agent` uses the Vercel AI SDK with per-tool sandboxing and secrets
- `examples/workflow` runs Vercel Workflow with sandboxed durable steps

### Protect your repo during builds

Run a build with network access but writes confined to `./dist`:

```
zerobox --allow-write=./dist --allow-net -- npm run build
```

Run tests with no network and catch accidental external calls:

```
zerobox --allow-write=/tmp -- npm test
```

## Performance

Sandbox overhead is minimal, typically ~10ms and ~7MB:

| Command | Bare | Sandboxed | Overhead | Bare Mem | Sandbox Mem |
| --- | --- | --- | --- | --- | --- |
| `echo hello` | <1ms | 10ms | +10ms | 1.2 MB | 8.4 MB |
| `node -e '...'` | 10ms | 20ms | +10ms | 39.3 MB | 39.1 MB |
| `python3 -c '...'` | 10ms | 20ms | +10ms | 12.9 MB | 13.0 MB |
| `cat 10MB file` | <1ms | 10ms | +10ms | 1.9 MB | 8.4 MB |
| `curl https://...` | 50ms | 60ms | +10ms | 7.2 MB | 8.4 MB |

Best of 10 runs with warmup on Apple M5 Pro. Run `./bench/run.sh` to reproduce.

## Platform support

| Platform | Backend | Status |
| --- | --- | --- |
| macOS | Seatbelt (`sandbox-exec`) | Fully supported |
| Linux | Bubblewrap + Seccomp + Namespaces | Fully supported |
| Windows | Restricted Tokens + ACLs + Firewall | Planned |

## CLI reference

| Flag | Example | Description |
| --- | --- | --- |
| `--allow-read <paths>` | `--allow-read=/tmp,/data` | Restrict readable user data to listed paths. System libraries remain accessible. Default: all reads allowed. |
| `--deny-read <paths>` | `--deny-read=/secret` | Block reading from these paths. Takes precedence over `--allow-read`. |
| `--allow-write [paths]` | `--allow-write=.` | Allow writing to these paths. Without a value, allows writing everywhere. Default: no writes. |
| `--deny-write <paths>` | `--deny-write=./.git` | Block writing to these paths. Takes precedence over `--allow-write`. |
| `--allow-net [domains]` | `--allow-net=example.com` | Allow outbound network. Without a value, allows all domains. Default: no network. |
| `--deny-net <domains>` | `--deny-net=evil.com` | Block network to these domains. Takes precedence over `--allow-net`. |
| `--env <KEY=VALUE>` | `--env NODE_ENV=prod` | Set env var in the sandbox. Can be repeated. |
| `--allow-env [keys]` | `--allow-env=PATH,HOME` | Inherit parent env vars. Without a value, inherits all. Default: only PATH, HOME, USER, SHELL, TERM, LANG. |
| `--deny-env <keys>` | `--deny-env=SECRET` | Drop these parent env vars. Takes precedence over `--allow-env`. |
| `--secret <KEY=VALUE>` | `--secret API_KEY=sk-123` | Pass a secret. The process sees a placeholder. The real value is injected at the proxy for approved hosts. |
| `--secret-host <KEY=HOSTS>` | `--secret-host API_KEY=api.openai.com` | Restrict a secret to specific hosts. Without this, the secret is substituted for all hosts. |
| `-A`, `--allow-all` | `-A` | Grant all filesystem and network permissions. Env and secrets still apply. |
| `--no-sandbox` | `--no-sandbox` | Disable the sandbox entirely. |
| `--strict-sandbox` | `--strict-sandbox` | Require full sandbox (bubblewrap). Fail instead of falling back to weaker isolation. |
| `--debug` | `--debug` | Print sandbox config and proxy decisions to stderr. |
| `--snapshot` | `--snapshot` | Record filesystem changes during execution. |
| `--restore` | `--restore` | Record and restore tracked files to pre-execution state after exit. Implies `--snapshot`. |
| `--snapshot-path <paths>` | `--snapshot-path=./src` | Paths to track for snapshots (default: cwd). |
| `--snapshot-exclude <patterns>` | `--snapshot-exclude=build` | Exclude patterns from snapshots. |
| `-C <dir>` | `-C /workspace` | Set working directory for the sandboxed command. |
| `-V`, `--version` | `--version` | Print version. |
| `-h`, `--help` | `--help` | Print help. |

### Snapshot subcommands

| Command | Description |
| --- | --- |
| `zerobox snapshot list` | List recorded sessions. |
| `zerobox snapshot diff <id>` | Show changes from a session. |
| `zerobox snapshot restore <id>` | Restore filesystem to a session's baseline. |
| `zerobox snapshot clean --older-than=<days>` | Remove old snapshot sessions. |

## SDKs

| Language | Package | README |
| --- | --- | --- |
| Rust | `zerobox` on crates.io | crates/zerobox/README.md |
| TypeScript / Node | `zerobox` on npm | packages/zerobox/README.md |
| Python | `zerobox` on PyPI | sdks/python/README.md |

## License

Apache-2.0              

## About

      

        Lightweight, cross-platform process sandboxing powered by OpenAI Codex's runtime. Sandbox any command with file, network, and credential controls.           

### Topics

                    rust        cli        security        vault        mcp        sandbox        process-isolation        security-tools        ai-agents        llm        llm-sandbox        mcp-security        openclaw          

### Resources

                              Readme           

### License

                     Apache-2.0 license           

### Security policy

                              Security policy                                           

###         Uh oh!

      

        

There was an error while loading. Please reload this page.

                          Activity        

### Stars

                      **583**        stars        

### Watchers

                      **3**        watching        

### Forks

                      **33**        forks                        Report repository                                     

##   Releases       18

                            v0.2.6                  Latest            Apr 19, 2026              + 17 releases                                                    

##   Packages       0

                                                                                                                 

###         Uh oh!

      

        

There was an error while loading. Please reload this page.

                                                                           

###         Uh oh!

      

        

There was an error while loading. Please reload this page.

                                            

##     Contributors  

  
      -               
      -               
      -               
  
                          

###         Uh oh!

      

        

There was an error while loading. Please reload this page.

                                         

## Languages

                      
    -                                 Rust          74.8%            
    -                                 TypeScript          10.0%            
    -                                 Python          9.6%            
    -                                 Shell          4.9%            
    -                                 JavaScript          0.7%            

                                            

## Footer

                                           © 2026 GitHub, Inc.                                                     You can’t perform that action at this time.

**Tool Call: Fetch https://raw.githubusercontent.com/afshinm/zerobox/main/crates/zerobox/src/linux\_sandbox.rs**
Status: Failed

status error 404, response: "404: Not Found"

**Tool Call: Fetch https://api.github.com/repos/afshinm/zerobox/git/trees/main?recursive\=1**
Status: Failed

status error 403, response: "{\"message\":\"API rate limit exceeded for 74.109.221.153. (But here's the good news: Authenticated requests get a higher rate limit. Check out the documentation for more details.)\",\"documentation_url\":\"https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting\"}\n"

**Tool Call: Fetch https://github.com/nicobailon/zerobox**
Status: Failed

status error 404, response: "\n\n\n\n\n\n\n\n<!DOCTYPE html>\n<html\n  lang=\"en\"\n  \n  data-color-mode=\"auto\" data-light-theme=\"light\" data-dark-theme=\"dark\"\n  data-a11y-animated-images=\"system\" data-a11y-link-underlines=\"true\"\n  \n  >\n\n\n\n\n  <head>\n    <meta charset=\"utf-8\">\n  <link rel=\"dns-prefetch\" href=\"https://github.githubassets.com\">\n  <link rel=\"dns-prefetch\" href=\"https://avatars.githubusercontent.com\">\n  <link rel=\"dns-prefetch\" href=\"https://github-cloud.s3.amazonaws.com\">\n  <link rel=\"dns-prefetch\" href=\"https://user-images.githubusercontent.com/\">\n  <link rel=\"preconnect\" href=\"https://github.githubassets.com\" crossorigin>\n  <link rel=\"preconnect\" href=\"https://avatars.githubusercontent.com\">\n\n      <link crossorigin=\"anonymous\" rel=\"preload\" as=\"script\" href=\"https://github.githubassets.com/assets/global-banner-disable-7f8c9b12bd1db3c7.js\" />\n\n  <link rel=\"preload\" href=\"https://github.githubassets.com/assets/MonaSansVF-wdth-wght-opsz-902d64c7ad02.woff2\" as=\"font\" type=\"font/woff2\" crossorigin>\n\n\n  <link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/light-2ff56e1b36116ee2.css\" /><link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/light_high_contrast-f7f95d7633592089.css\" /><link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/dark-2d1fe43dbc9adf1f.css\" /><link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/dark_high_contrast-d530ee188d165539.css\" /><link data-color-theme=\"light\" crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" data-href=\"https://github.githubassets.com/assets/light-2ff56e1b36116ee2.css\" /><link data-color-theme=\"light_high_contrast\" crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" data-href=\"https://github.githubassets.com/assets/light_high_contrast-f7f95d7633592089.css\" /><link data-color-theme=\"light_colorblind\" crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" data-href=\"https://github.githubassets.com/assets/light_colorblind-e4bbc49fc7b82570.css\" /><link data-color-theme=\"light_colorblind_high_contrast\" crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" data-href=\"https://github.githubassets.com/assets/light_colorblind_high_contrast-cc3f126b45166b83.css\" /><link data-color-theme=\"light_tritanopia\" crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" data-href=\"https://github.githubassets.com/assets/light_tritanopia-652ca611ea4e33fe.css\" /><link data-color-theme=\"light_tritanopia_high_contrast\" crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" data-href=\"https://github.githubassets.com/assets/light_tritanopia_high_contrast-9e82d635cb6c3f49.css\" /><link data-color-theme=\"dark\" crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" data-href=\"https://github.githubassets.com/assets/dark-2d1fe43dbc9adf1f.css\" /><link data-color-theme=\"dark_high_contrast\" crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" data-href=\"https://github.githubassets.com/assets/dark_high_contrast-d530ee188d165539.css\" /><link data-color-theme=\"dark_colorblind\" crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" data-href=\"https://github.githubassets.com/assets/dark_colorblind-3ad0ec21150df75b.css\" /><link data-color-theme=\"dark_colorblind_high_contrast\" crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" data-href=\"https://github.githubassets.com/assets/dark_colorblind_high_contrast-5691ff467f71a3f6.css\" /><link data-color-theme=\"dark_tritanopia\" crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" data-href=\"https://github.githubassets.com/assets/dark_tritanopia-abee7710893cd168.css\" /><link data-color-theme=\"dark_tritanopia_high_contrast\" crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" data-href=\"https://github.githubassets.com/assets/dark_tritanopia_high_contrast-eafcf6cd46158360.css\" /><link data-color-theme=\"dark_dimmed\" crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" data-href=\"https://github.githubassets.com/assets/dark_dimmed-c7974682a1a84c8d.css\" /><link data-color-theme=\"dark_dimmed_high_contrast\" crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" data-href=\"https://github.githubassets.com/assets/dark_dimmed_high_contrast-f8dab3e04f94c501.css\" />\n\n  <style type=\"text/css\">\n    :root {\n      --tab-size-preference: 4;\n    }\n\n    pre, code {\n      tab-size: var(--tab-size-preference);\n    }\n  </style>\n\n    <link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/primer-primitives-7f694b60439d06c0.css\" />\n    <link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/primer-bf8570e4081bd07e.css\" />\n    <link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/global-f0dadf51b5aa5881.css\" />\n    <link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/github-f825c0edd7ad57f8.css\" />\n  \n\n  \n\n  <script type=\"application/json\" id=\"client-env\">{\"locale\":\"en\",\"featureFlags\":[\"actions_custom_images_storage_billing_ui_visibility\",\"actions_image_version_event\",\"actions_workflow_language_service_allow_concurrency_queue\",\"agent_conflict_resolution\",\"alternate_user_config_repo\",\"arianotify_comprehensive_migration\",\"artifact_ui_v2\",\"billing_discount_threshold_notification\",\"code_scanning_dfa_degraded_experience_notice\",\"codeowners_validation_in_diff\",\"codespaces_prebuild_region_target_update\",\"codespaces_tab_react\",\"coding_agent_model_selection\",\"coding_agent_model_selection_all_skus\",\"comment_viewer_copy_raw_markdown\",\"contentful_primer_code_blocks\",\"copilot_agent_snippy\",\"copilot_api_agentic_issue_marshal_yaml\",\"copilot_ask_mode_dropdown\",\"copilot_automation_session_author\",\"copilot_chat_attach_multiple_images\",\"copilot_chat_category_rate_limit_messages\",\"copilot_chat_clear_model_selection_for_default_change\",\"copilot_chat_contextual_suggestions_updated\",\"copilot_chat_enable_tool_call_logs\",\"copilot_chat_file_redirect\",\"copilot_chat_input_commands\",\"copilot_chat_opening_thread_switch\",\"copilot_chat_prettify_pasted_code\",\"copilot_chat_reduce_quota_checks\",\"copilot_chat_search_bar_redirect\",\"copilot_chat_vision_in_claude\",\"copilot_chat_vision_preview_gate\",\"copilot_custom_copilots\",\"copilot_custom_copilots_feature_preview\",\"copilot_diff_explain_conversation_intent\",\"copilot_diff_reference_context\",\"copilot_duplicate_thread\",\"copilot_extensions_hide_in_dotcom_chat\",\"copilot_extensions_removal_on_marketplace\",\"copilot_features_sql_server_logo\",\"copilot_file_block_ref_matching\",\"copilot_ftp_hyperspace_upgrade_prompt\",\"copilot_icebreakers_experiment_dashboard\",\"copilot_icebreakers_experiment_hyperspace\",\"copilot_immersive_code_block_transition_wrap\",\"copilot_immersive_embedded\",\"copilot_immersive_embedded_deferred_payload\",\"copilot_immersive_embedded_draggable\",\"copilot_immersive_embedded_header_button\",\"copilot_immersive_embedded_implicit_references\",\"copilot_immersive_embedded_skip_copilot_api_token_for_dotcom_context\",\"copilot_immersive_file_block_transition_open\",\"copilot_immersive_file_preview_keep_mounted\",\"copilot_immersive_job_result_preview\",\"copilot_immersive_structured_model_picker\",\"copilot_immersive_task_hyperlinking\",\"copilot_immersive_task_within_chat_thread\",\"copilot_mc_cli_resume_any_users_task\",\"copilot_mission_control_agent_filtering\",\"copilot_mission_control_always_send_integration_id\",\"copilot_mission_control_cli_session_status\",\"copilot_mission_control_initial_data_spinner\",\"copilot_mission_control_logs_incremental\",\"copilot_mission_control_task_alive_updates\",\"copilot_mission_control_tasks_repo_filter\",\"copilot_org_policy_page_focus_mode\",\"copilot_redirect_header_button_to_agents\",\"copilot_resource_panel\",\"copilot_scroll_preview_tabs\",\"copilot_share_active_subthread\",\"copilot_spaces_ga\",\"copilot_spaces_individual_policies_ga\",\"copilot_spaces_pagination\",\"copilot_spark_empty_state\",\"copilot_spark_handle_nil_friendly_name\",\"copilot_swe_agent_hide_model_picker_if_only_auto\",\"copilot_swe_agent_pr_comment_model_picker\",\"copilot_swe_agent_use_subagents\",\"copilot_task_api_github_rest_style\",\"copilot_unconfigured_is_inherited\",\"copilot_upgrade_freeze\",\"copilot_usage_metrics_ga\",\"copilot_workbench_slim_line_top_tabs\",\"custom_instructions_file_references\",\"dashboard_indexeddb_caching\",\"dashboard_lists_max_age_filter\",\"dashboard_universe_2025_feedback_dialog\",\"dotgithub_fork_warning\",\"enterprise_managed_settings_for_copilot_clients\",\"flex_cta_groups_mvp\",\"global_nav_react\",\"hyperspace_2025_logged_out_batch_1\",\"hyperspace_2025_logged_out_batch_2\",\"hyperspace_2025_logged_out_batch_3\",\"ipm_global_transactional_message_agents\",\"ipm_global_transactional_message_copilot\",\"ipm_global_transactional_message_issues\",\"ipm_global_transactional_message_prs\",\"ipm_global_transactional_message_repos\",\"ipm_global_transactional_message_spaces\",\"issue_cca_modal_open\",\"issue_cca_multi_assign_modal\",\"issue_cca_task_side_panel\",\"issue_cca_visualization\",\"issue_cca_visualization_session_panel\",\"issue_fields_global_search\",\"issue_type_filter_no_relay\",\"issues_expanded_file_types\",\"issues_lazy_load_comment_box_suggestions\",\"issues_react_chrome_container_query_fix\",\"issues_search_type_gql\",\"landing_pages_ninetailed\",\"landing_pages_web_vitals_tracking\",\"lifecycle_label_name_updates\",\"low_quality_classifier\",\"marketing_pages_search_explore_provider\",\"memex_default_issue_create_repository\",\"memex_live_update_hovercard\",\"memex_mwl_filter_field_delimiter\",\"memex_remove_deprecated_type_issue\",\"merge_status_header_feedback\",\"notifications_menu_defer_labels\",\"oauth_authorize_clickjacking_protection\",\"octocaptcha_origin_optimization\",\"project_picker_null_safety\",\"prs_conversations_react\",\"prs_css_anchor_positioning\",\"repos_contributors_limited_default_range\",\"rules_insights_filter_bar_created\",\"sample_network_conn_type\",\"secret_scanning_pattern_alerts_link\",\"security_center_artifact_filters_popover\",\"session_logs_ungroup_reasoning_text\",\"site_features_copilot_universe\",\"site_homepage_collaborate_video\",\"spark_prompt_secret_scanning\",\"spark_server_connection_status\",\"suppress_automated_browser_vitals\",\"user_bypass_actors\",\"viewscreen_sandbox\",\"warn_inaccessible_attachments\",\"webp_support\",\"workbench_store_readonly\"],\"copilotApiOverrideUrl\":\"https://api.githubcopilot.com\"}</script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/high-contrast-cookie-218067197ba03c91.js\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/wp-runtime-9f72a7a8983aa17f.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/fetch-utilities-3140609b5732710f.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/28839-7adfdde5afeb1a03.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/85924-f9b9156c785c7366.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/34646-4c7883eb242d5210.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/environment-8e8857b66d545299.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/runtime-helpers-cb4dfbc9d23f30be.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/2966-d68f2b4558d86113.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/96232-540ff5f81016a9ca.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/41013-647932573fc130af.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/51210-45dfb7dd106f6b96.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/81058-fc9ccbdd06141af8.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/81683-382ccc88e034ea1d.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/46740-5a373320e5ef9c01.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/82097-11971d9e2549fcf1.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/67466-79abcbf599986a00.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/github-elements-928ee121cbc88eff.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/element-registry-85994af5a31837a5.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/react-core-cc5c797fbab53ca1.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/react-lib-1353f2cef82bcdc0.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/79039-69acf717ffc901a4.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/61110-073153e0413daf3a.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/2887-91b9c645d570616a.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/26533-f22c29ae5e9b1ed2.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/86483-c3a819d46503a3da.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/49521-3b553cd29062db6a.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/60481-24b13ea726837f7b.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/46287-8c3fcf55b906a24b.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/33805-da9f821452a32f15.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/89627-40275597692dc855.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/79087-4f706db8aa2ec0fb.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/71410-874f65a04c129aeb.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/99328-a2c6b180d25cb160.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/behaviors-6c881a3a24cb6b06.js\" defer=\"defer\"></script>\n<link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/react-core.c6d2f524ac823a99.module.css\" />\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/4244-97fb660009234136.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/notifications-global-442a23b66c306470.js\" defer=\"defer\"></script>\n  \n\n  <title>Page not found · GitHub · GitHub</title>\n\n\n\n  <meta name=\"route-pattern\" content=\"/:user_id/:repository\" data-turbo-transient>\n  <meta name=\"route-controller\" content=\"files\" data-turbo-transient>\n  <meta name=\"route-action\" content=\"disambiguate\" data-turbo-transient>\n  <meta name=\"fetch-nonce\" content=\"v2:8437dce0-4125-e9d5-4fe3-a8638b453d10\">\n\n    \n  <meta name=\"current-catalog-service-hash\" content=\"f3abb0cc802f3d7b95fc8762b94bdcb13bf39634c40c357301c4aa1d67a256fb\">\n\n\n  <meta name=\"request-id\" content=\"DEE9:3DC0E0:AFB14:D801F:6A03ACF5\" data-pjax-transient=\"true\"/><meta name=\"html-safe-nonce\" content=\"42ff8579f2f5d20cde178554d0ebdec7b857526f777a786d98f0f436b10b5e23\" data-pjax-transient=\"true\"/><meta name=\"visitor-payload\" content=\"eyJyZWZlcnJlciI6IiIsInJlcXVlc3RfaWQiOiJERUU5OjNEQzBFMDpBRkIxNDpEODAxRjo2QTAzQUNGNSIsInZpc2l0b3JfaWQiOiI4NzIyMTM3OTk4MTI0NDMzODkiLCJyZWdpb25fZWRnZSI6ImlhZCIsInJlZ2lvbl9yZW5kZXIiOiJpYWQifQ==\" data-pjax-transient=\"true\"/><meta name=\"visitor-hmac\" content=\"d6c05a7fe9baf8bea33b772a6a29af45bee46fc53269a7ab54fc6c156a56bb9b\" data-pjax-transient=\"true\"/>\n\n\n\n\n  <meta name=\"github-keyboard-shortcuts\" content=\"copilot\" data-turbo-transient=\"true\" />\n  \n\n  <meta name=\"selected-link\" value=\"/nicobailon/zerobox\" data-turbo-transient>\n  <link rel=\"assets\" href=\"https://github.githubassets.com/\">\n\n    <meta name=\"google-site-verification\" content=\"Apib7-x98H0j5cPqHWwSMm6dNU4GmODRoqxLiDzdx9I\">\n\n<meta name=\"octolytics-url\" content=\"https://collector.github.com/github/collect\" />\n\n<meta name=\"octolytics-page-type\" content=\"marketing\" />\n\n\n\n  \n\n  \n\n\n\n\n    <meta name=\"user-login\" content=\"\">\n\n  \n\n    <meta name=\"viewport\" content=\"width=device-width\">\n\n    \n\n      <meta name=\"description\" content=\"GitHub is where people build software. More than 150 million people use GitHub to discover, fork, and contribute to over 420 million projects.\">\n\n      <link rel=\"search\" type=\"application/opensearchdescription+xml\" href=\"/opensearch.xml\" title=\"GitHub\">\n\n    <link rel=\"fluid-icon\" href=\"https://github.com/fluidicon.png\" title=\"GitHub\">\n    <meta property=\"fb:app_id\" content=\"1401488693436528\">\n    <meta name=\"apple-itunes-app\" content=\"app-id=1477376905, app-argument=https://github.com/nicobailon/zerobox\" />\n\n      <meta property=\"og:url\" content=\"https://github.com\">\n  <meta property=\"og:site_name\" content=\"GitHub\">\n  <meta property=\"og:title\" content=\"Build software better, together\">\n  <meta property=\"og:description\" content=\"GitHub is where people build software. More than 150 million people use GitHub to discover, fork, and contribute to over 420 million projects.\">\n  <meta property=\"og:image\" content=\"https://github.githubassets.com/assets/github-logo-55c5b9a1fe52.png\">\n  <meta property=\"og:image:type\" content=\"image/png\">\n  <meta property=\"og:image:width\" content=\"1200\">\n  <meta property=\"og:image:height\" content=\"1200\">\n  <meta property=\"og:image\" content=\"https://github.githubassets.com/assets/github-mark-57519b92ca4e.png\">\n  <meta property=\"og:image:type\" content=\"image/png\">\n  <meta property=\"og:image:width\" content=\"1200\">\n  <meta property=\"og:image:height\" content=\"620\">\n  <meta property=\"og:image\" content=\"https://github.githubassets.com/assets/github-octocat-13c86b8b336d.png\">\n  <meta property=\"og:image:type\" content=\"image/png\">\n  <meta property=\"og:image:width\" content=\"1200\">\n  <meta property=\"og:image:height\" content=\"620\">\n\n  <meta property=\"twitter:site\" content=\"github\">\n  <meta property=\"twitter:site:id\" content=\"13334762\">\n  <meta property=\"twitter:creator\" content=\"github\">\n  <meta property=\"twitter:creator:id\" content=\"13334762\">\n  <meta property=\"twitter:card\" content=\"summary_large_image\">\n  <meta property=\"twitter:title\" content=\"GitHub\">\n  <meta property=\"twitter:description\" content=\"GitHub is where people build software. More than 150 million people use GitHub to discover, fork, and contribute to over 420 million projects.\">\n  <meta property=\"twitter:image\" content=\"https://github.githubassets.com/assets/github-logo-55c5b9a1fe52.png\">\n  <meta property=\"twitter:image:width\" content=\"1200\">\n  <meta property=\"twitter:image:height\" content=\"1200\">\n\n\n\n\n      <meta name=\"hostname\" content=\"github.com\">\n\n\n\n        <meta name=\"expected-hostname\" content=\"github.com\">\n\n\n  <meta http-equiv=\"x-pjax-version\" content=\"f839f028e32d31d7450c8548af96fc9c7275b85a34aa34fd1598dc7f07def125\" data-turbo-track=\"reload\">\n  <meta http-equiv=\"x-pjax-csp-version\" content=\"568c098497d98702bac1642a2a853732a047a6ced28eabd3e15d50041a890235\" data-turbo-track=\"reload\">\n  <meta http-equiv=\"x-pjax-css-version\" content=\"9695003a10fec48a1692d370b1f03f13920bd410ad5994754dc4fc90e1b8214a\" data-turbo-track=\"reload\">\n  <meta http-equiv=\"x-pjax-js-version\" content=\"cc874e65b3a6b641f7c5db762acecd66d9926ea5464e1e454447faae164fed6d\" data-turbo-track=\"reload\">\n\n  <meta name=\"turbo-cache-control\" content=\"no-preview\" data-turbo-transient=\"\">\n\n      <link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/site-8e580c38ab6535be.css\" />\n  <link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/error-8456319999cfe62d.css\" />\n  <meta name=\"is_logged_out_page\" content=\"true\">\n\n  \n\n\n\n      <link rel=\"canonical\" href=\"https://github.com/nicobailon/zerobox\" data-turbo-transient>\n\n\n    <meta name=\"turbo-body-classes\" content=\"logged-out env-production page-responsive min-height-full d-flex flex-column\">\n  <meta name=\"disable-turbo\" content=\"false\">\n\n\n  <meta name=\"browser-stats-url\" content=\"https://api.github.com/_private/browser/stats\">\n\n  <meta name=\"browser-errors-url\" content=\"https://api.github.com/_private/browser/errors\">\n\n    <meta name=\"release\" content=\"e3156a4191d153a27b2b3ba4a69385a7cebdbe83\">\n  <meta name=\"ui-target\" content=\"full\">\n\n  <link rel=\"mask-icon\" href=\"https://github.githubassets.com/assets/pinned-octocat-093da3e6fa40.svg\" color=\"#000000\">\n  <link rel=\"alternate icon\" class=\"js-site-favicon\" type=\"image/png\" href=\"https://github.githubassets.com/favicons/favicon.png\">\n  <link rel=\"icon\" class=\"js-site-favicon\" type=\"image/svg+xml\" href=\"https://github.githubassets.com/favicons/favicon.svg\" data-base-href=\"https://github.githubassets.com/favicons/favicon\">\n\n<meta name=\"theme-color\" content=\"#1e2327\">\n<meta name=\"color-scheme\" content=\"light dark\" />\n\n\n  <link rel=\"manifest\" href=\"/manifest.json\" crossOrigin=\"use-credentials\">\n\n  </head>\n\n  <body class=\"logged-out env-production page-responsive min-height-full d-flex flex-column\" style=\"word-wrap: break-word;\" >\n    <div data-turbo-body class=\"logged-out env-production page-responsive min-height-full d-flex flex-column\" style=\"word-wrap: break-word;\" >\n      <div id=\"__primerPortalRoot__\" style=\"z-index: 1000; position: absolute; width: 100%;\" data-turbo-permanent></div>\n      \n\n    <div class=\"position-relative header-wrapper js-header-wrapper \">\n      <a href=\"#start-of-content\" data-skip-target-assigned=\"false\" class=\"px-2 tmp-py-4 color-bg-accent-emphasis color-fg-on-emphasis show-on-focus js-skip-to-content\">Skip to content</a>\n\n      <span data-view-component=\"true\" class=\"progress-pjax-loader Progress position-fixed width-full\">\n    <span style=\"width: 0%;\" data-view-component=\"true\" class=\"Progress-item progress-pjax-loader-bar left-0 top-0 color-bg-accent-emphasis\"></span>\n</span>      \n      \n      <link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/primer-react-css.feac881557adad02.module.css\" />\n<link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/keyboard-shortcuts-dialog.9a0f7faf332568b4.module.css\" />\n\n<react-partial\n  partial-name=\"keyboard-shortcuts-dialog\"\n  data-ssr=\"false\"\n  data-attempted-ssr=\"false\"\n  data-react-profiling=\"false\"\n>\n  \n  <script type=\"application/json\" data-target=\"react-partial.embeddedData\">{\"props\":{\"docsUrl\":\"https://docs.github.com/get-started/accessibility/keyboard-shortcuts\"}}</script>\n  <div data-target=\"react-partial.reactRoot\"></div>\n</react-partial>\n\n\n\n\n\n      \n\n          \n\n              \n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/46752-7bd8967216f7ea42.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/90350-551d81ec6eef68a3.js\" defer=\"defer\"></script>\n<script crossorigin=\"anonymous\" type=\"application/javascript\" src=\"https://github.githubassets.com/assets/sessions-e0da6ce03532723c.js\" defer=\"defer\"></script>\n\n<style>\n  /* Override primer focus outline color for marketing header dropdown links for better contrast */\n  [data-color-mode=\"light\"] .HeaderMenu-dropdown-link:focus-visible,\n  [data-color-mode=\"light\"] .HeaderMenu-trailing-link a:focus-visible {\n    outline-color: var(--color-accent-fg);\n  }\n</style>\n\n<header class=\"HeaderMktg header-logged-out js-details-container js-header Details f4 tmp-py-3\" role=\"banner\" data-is-top=\"true\" data-color-mode=auto data-light-theme=light data-dark-theme=dark>\n  <h2 class=\"sr-only\">Navigation Menu</h2>\n\n  <button type=\"button\" class=\"HeaderMktg-backdrop d-lg-none border-0 position-fixed top-0 left-0 width-full height-full js-details-target\" aria-label=\"Toggle navigation\">\n    <span class=\"d-none\">Toggle navigation</span>\n  </button>\n\n  <div class=\"d-flex flex-column flex-lg-row flex-items-center tmp-px-3 tmp-px-md-4 tmp-px-lg-5 height-full position-relative z-1\">\n    <div class=\"d-flex flex-justify-between flex-items-center width-full width-lg-auto\">\n      <div class=\"flex-1\">\n        <button aria-label=\"Toggle navigation\" aria-expanded=\"false\" type=\"button\" data-view-component=\"true\" class=\"js-details-target js-nav-padding-recalculate js-header-menu-toggle Button--link Button--medium Button d-lg-none color-fg-inherit p-1 tmp-p-1\">  <span class=\"Button-content\">\n    <span class=\"Button-label\"><div class=\"HeaderMenu-toggle-bar rounded my-1\"></div>\n            <div class=\"HeaderMenu-toggle-bar rounded my-1\"></div>\n            <div class=\"HeaderMenu-toggle-bar rounded my-1\"></div></span>\n  </span>\n</button>\n      </div>\n\n      <a class=\"tmp-mr-lg-3 color-fg-inherit flex-order-2 js-prevent-focus-on-mobile-nav\"\n        href=\"/\"\n        aria-label=\"Homepage\"\n        data-analytics-event=\"{&quot;category&quot;:&quot;Marketing nav&quot;,&quot;action&quot;:&quot;click to go to homepage&quot;,&quot;label&quot;:&quot;ref_page:Marketing;ref_cta:Logomark;ref_loc:Header&quot;}\">\n        <svg height=\"32\" aria-hidden=\"true\" data-component=\"Octicon\" viewBox=\"0 0 24 24\" version=\"1.1\" width=\"32\" data-view-component=\"true\" class=\"octicon octicon-mark-github\">\n    <path d=\"M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943\"></path>\n</svg>\n      </a>\n\n      <div class=\"d-flex flex-1 flex-order-2 text-right d-lg-none gap-2 flex-justify-end\">\n          <a\n            href=\"/login?return_to=https%3A%2F%2Fgithub.com%2Fnicobailon%2Fzerobox\"\n            class=\"HeaderMenu-link HeaderMenu-button d-inline-flex f5 no-underline border color-border-default rounded-2 px-2 py-1 color-fg-inherit js-prevent-focus-on-mobile-nav\"\n            data-hydro-click=\"{&quot;event_type&quot;:&quot;authentication.click&quot;,&quot;payload&quot;:{&quot;location_in_page&quot;:&quot;site header menu&quot;,&quot;repository_id&quot;:null,&quot;auth_type&quot;:&quot;SIGN_UP&quot;,&quot;originating_url&quot;:&quot;https://github.com/nicobailon/zerobox&quot;,&quot;user_id&quot;:null}}\" data-hydro-click-hmac=\"e1613288ed18b0e410bf2f4c8eaf0e8c29cb3b6067007ea05bbda0df28c64637\"\n            data-analytics-event=\"{&quot;category&quot;:&quot;Marketing nav&quot;,&quot;action&quot;:&quot;click to Sign in&quot;,&quot;label&quot;:&quot;ref_page:Marketing;ref_cta:Sign in;ref_loc:Header&quot;}\"\n          >\n            Sign in\n          </a>\n              <div class=\"AppHeader-appearanceSettings\">\n    <react-partial-anchor>\n      <button data-target=\"react-partial-anchor.anchor\" id=\"icon-button-0d4ff0d9-2419-44bb-b458-f56dc99c41e9\" aria-labelledby=\"tooltip-dbfcd4bd-5de6-45ab-b701-17d27519db73\" type=\"button\" disabled=\"disabled\" data-view-component=\"true\" class=\"Button Button--iconOnly Button--invisible Button--medium AppHeader-button HeaderMenu-link border cursor-wait\">  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-sliders Button-visual\">\n    <path d=\"M15 2.75a.75.75 0 0 1-.75.75h-4a.75.75 0 0 1 0-1.5h4a.75.75 0 0 1 .75.75Zm-8.5.75v1.25a.75.75 0 0 0 1.5 0v-4a.75.75 0 0 0-1.5 0V2H1.75a.75.75 0 0 0 0 1.5H6.5Zm1.25 5.25a.75.75 0 0 0 0-1.5h-6a.75.75 0 0 0 0 1.5h6ZM15 8a.75.75 0 0 1-.75.75H11.5V10a.75.75 0 1 1-1.5 0V6a.75.75 0 0 1 1.5 0v1.25h2.75A.75.75 0 0 1 15 8Zm-9 5.25v-2a.75.75 0 0 0-1.5 0v1.25H1.75a.75.75 0 0 0 0 1.5H4.5v1.25a.75.75 0 0 0 1.5 0v-2Zm9 0a.75.75 0 0 1-.75.75h-6a.75.75 0 0 1 0-1.5h6a.75.75 0 0 1 .75.75Z\"></path>\n</svg>\n</button><tool-tip id=\"tooltip-dbfcd4bd-5de6-45ab-b701-17d27519db73\" for=\"icon-button-0d4ff0d9-2419-44bb-b458-f56dc99c41e9\" popover=\"manual\" data-direction=\"s\" data-type=\"label\" data-view-component=\"true\" class=\"sr-only position-absolute\">Appearance settings</tool-tip>\n\n      <template data-target=\"react-partial-anchor.template\">\n        <link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/primer-react-css.feac881557adad02.module.css\" />\n<link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/appearance-settings.92e55a4ebdaa3c2e.module.css\" />\n\n<react-partial\n  partial-name=\"appearance-settings\"\n  data-ssr=\"false\"\n  data-attempted-ssr=\"false\"\n  data-react-profiling=\"false\"\n>\n  \n  <script type=\"application/json\" data-target=\"react-partial.embeddedData\">{\"props\":{}}</script>\n  <div data-target=\"react-partial.reactRoot\"></div>\n</react-partial>\n\n\n      </template>\n    </react-partial-anchor>\n  </div>\n\n      </div>\n    </div>\n\n\n    <div class=\"HeaderMenu js-header-menu height-fit position-lg-relative d-lg-flex flex-column flex-auto top-0\">\n      <div class=\"HeaderMenu-wrapper d-flex flex-column flex-self-start flex-lg-row flex-auto rounded rounded-lg-0\">\n            <link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/primer-react-css.feac881557adad02.module.css\" />\n<link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/marketing-navigation.27760cd5a9b488f1.module.css\" />\n\n<react-partial\n  partial-name=\"marketing-navigation\"\n  data-ssr=\"true\"\n  data-attempted-ssr=\"true\"\n  data-react-profiling=\"false\"\n>\n  \n  <script type=\"application/json\" data-target=\"react-partial.embeddedData\">{\"props\":{\"should_use_dotcom_links\":true}}</script>\n  <div data-target=\"react-partial.reactRoot\"><nav class=\"MarketingNavigation-module__nav__W0KYY\" aria-label=\"Global\"><ul class=\"MarketingNavigation-module__list__tFbMb\"><li><div class=\"NavDropdown-module__container__l2YeI js-details-container js-header-menu-item\"><button type=\"button\" class=\"NavDropdown-module__button__PEHWX js-details-target\" aria-expanded=\"false\">Platform<svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-chevron-right NavDropdown-module__buttonIcon__Tkl8_\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z\"></path></svg></button><div class=\"NavDropdown-module__dropdown__xm1jd\"><ul class=\"NavDropdown-module__list__zuCgG\"><li><div class=\"NavGroup-module__group__W8SqJ\"><span class=\"NavGroup-module__title__Wzxz2\" id=\"_R_5hb_\">AI CODE CREATION</span><ul class=\"NavGroup-module__list__UCOFy\" aria-labelledby=\"_R_5hb_\"><li><a href=\"https://github.com/features/copilot\" data-analytics-event=\"{&quot;action&quot;:&quot;github_copilot&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;github_copilot_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><div class=\"NavLink-module__text__XvpLQ\"><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-copilot NavLink-module__icon__ltGNM\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M23.922 16.992c-.861 1.495-5.859 5.023-11.922 5.023-6.063 0-11.061-3.528-11.922-5.023A.641.641 0 0 1 0 16.736v-2.869a.841.841 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.195 10.195 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952 1.399-1.136 3.392-2.093 6.122-2.093 2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.832.832 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256ZM12.172 11h-.344a4.323 4.323 0 0 1-.355.508C10.703 12.455 9.555 13 7.965 13c-1.725 0-2.989-.359-3.782-1.259a2.005 2.005 0 0 1-.085-.104L4 11.741v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.323 4.323 0 0 1-.355-.508h-.016.016Zm.641-2.935c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z\"></path><path d=\"M14.5 14.25a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1Zm-5 0a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1Z\"></path></svg><span class=\"NavLink-module__title__Q7t0p\">GitHub Copilot</span><span class=\"NavLink-module__subtitle__X4gkW\">Write better code with AI</span></div></a></li><li><a href=\"https://github.com/features/spark\" data-analytics-event=\"{&quot;action&quot;:&quot;github_spark&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;github_spark_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><div class=\"NavLink-module__text__XvpLQ\"><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-sparkle-fill NavLink-module__icon__ltGNM\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M11.296 1.924c.24-.656 1.168-.656 1.408 0l.717 1.958a11.25 11.25 0 0 0 6.697 6.697l1.958.717c.657.24.657 1.168 0 1.408l-1.958.717a11.25 11.25 0 0 0-6.697 6.697l-.717 1.958c-.24.657-1.168.657-1.408 0l-.717-1.958a11.25 11.25 0 0 0-6.697-6.697l-1.958-.717c-.656-.24-.656-1.168 0-1.408l1.958-.717a11.25 11.25 0 0 0 6.697-6.697l.717-1.958Z\"></path></svg><span class=\"NavLink-module__title__Q7t0p\">GitHub Spark</span><span class=\"NavLink-module__subtitle__X4gkW\">Build and deploy intelligent apps</span></div></a></li><li><a href=\"https://github.com/features/models\" data-analytics-event=\"{&quot;action&quot;:&quot;github_models&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;github_models_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><div class=\"NavLink-module__text__XvpLQ\"><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-ai-model NavLink-module__icon__ltGNM\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M19.375 8.5a3.25 3.25 0 1 1-3.163 4h-3a3.252 3.252 0 0 1-4.443 2.509L7.214 17.76a3.25 3.25 0 1 1-1.342-.674l1.672-2.957A3.238 3.238 0 0 1 6.75 12c0-.907.371-1.727.97-2.316L6.117 6.846A3.253 3.253 0 0 1 1.875 3.75a3.25 3.25 0 1 1 5.526 2.32l1.603 2.836A3.25 3.25 0 0 1 13.093 11h3.119a3.252 3.252 0 0 1 3.163-2.5ZM10 10.25a1.75 1.75 0 1 0-.001 3.499A1.75 1.75 0 0 0 10 10.25ZM5.125 2a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Zm12.5 9.75a1.75 1.75 0 1 0 3.5 0 1.75 1.75 0 0 0-3.5 0Zm-14.25 8.5a1.75 1.75 0 1 0 3.501-.001 1.75 1.75 0 0 0-3.501.001Z\"></path></svg><span class=\"NavLink-module__title__Q7t0p\">GitHub Models</span><span class=\"NavLink-module__subtitle__X4gkW\">Manage and compare prompts</span></div></a></li><li><a href=\"https://github.com/mcp\" data-analytics-event=\"{&quot;action&quot;:&quot;mcp_registry&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;mcp_registry_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><div class=\"NavLink-module__text__XvpLQ\"><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-mcp NavLink-module__icon__ltGNM\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M9.795 1.694a4.287 4.287 0 0 1 6.061 0 4.28 4.28 0 0 1 1.181 3.819 4.282 4.282 0 0 1 3.819 1.181 4.287 4.287 0 0 1 0 6.061l-6.793 6.793a.249.249 0 0 0 0 .353l2.617 2.618a.75.75 0 1 1-1.061 1.061l-2.617-2.618a1.75 1.75 0 0 1 0-2.475l6.793-6.793a2.785 2.785 0 1 0-3.939-3.939l-5.9 5.9a.734.734 0 0 1-.249.165.749.749 0 0 1-.812-1.225l5.9-5.901a2.785 2.785 0 1 0-3.939-3.939L2.931 10.68A.75.75 0 1 1 1.87 9.619l7.925-7.925Z\"></path><path d=\"M12.42 4.069a.752.752 0 0 1 1.061 0 .752.752 0 0 1 0 1.061L7.33 11.28a2.788 2.788 0 0 0 0 3.94 2.788 2.788 0 0 0 3.94 0l6.15-6.151a.752.752 0 0 1 1.061 0 .752.752 0 0 1 0 1.061l-6.151 6.15a4.285 4.285 0 1 1-6.06-6.06l6.15-6.151Z\"></path></svg><span class=\"NavLink-module__title__Q7t0p\">MCP Registry<sup class=\"NavLink-module__label__bil7n\">New</sup></span><span class=\"NavLink-module__subtitle__X4gkW\">Integrate external tools</span></div></a></li></ul></div></li><li><div class=\"NavGroup-module__group__W8SqJ\"><span class=\"NavGroup-module__title__Wzxz2\" id=\"_R_9hb_\">DEVELOPER WORKFLOWS</span><ul class=\"NavGroup-module__list__UCOFy\" aria-labelledby=\"_R_9hb_\"><li><a href=\"https://github.com/features/actions\" data-analytics-event=\"{&quot;action&quot;:&quot;actions&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;actions_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><div class=\"NavLink-module__text__XvpLQ\"><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-workflow NavLink-module__icon__ltGNM\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M1 3a2 2 0 0 1 2-2h6.5a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H7v4.063C7 16.355 7.644 17 8.438 17H12.5v-2.5a2 2 0 0 1 2-2H21a2 2 0 0 1 2 2V21a2 2 0 0 1-2 2h-6.5a2 2 0 0 1-2-2v-2.5H8.437A2.939 2.939 0 0 1 5.5 15.562V11.5H3a2 2 0 0 1-2-2Zm2-.5a.5.5 0 0 0-.5.5v6.5a.5.5 0 0 0 .5.5h6.5a.5.5 0 0 0 .5-.5V3a.5.5 0 0 0-.5-.5ZM14.5 14a.5.5 0 0 0-.5.5V21a.5.5 0 0 0 .5.5H21a.5.5 0 0 0 .5-.5v-6.5a.5.5 0 0 0-.5-.5Z\"></path></svg><span class=\"NavLink-module__title__Q7t0p\">Actions</span><span class=\"NavLink-module__subtitle__X4gkW\">Automate any workflow</span></div></a></li><li><a href=\"https://github.com/features/codespaces\" data-analytics-event=\"{&quot;action&quot;:&quot;codespaces&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;codespaces_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><div class=\"NavLink-module__text__XvpLQ\"><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-codespaces NavLink-module__icon__ltGNM\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M3.5 3.75C3.5 2.784 4.284 2 5.25 2h13.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 18.75 13H5.25a1.75 1.75 0 0 1-1.75-1.75Zm-2 12c0-.966.784-1.75 1.75-1.75h17.5c.966 0 1.75.784 1.75 1.75v4a1.75 1.75 0 0 1-1.75 1.75H3.25a1.75 1.75 0 0 1-1.75-1.75ZM5.25 3.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h13.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Zm-2 12a.25.25 0 0 0-.25.25v4c0 .138.112.25.25.25h17.5a.25.25 0 0 0 .25-.25v-4a.25.25 0 0 0-.25-.25Z\"></path><path d=\"M10 17.75a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1-.75-.75Zm-4 0a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1-.75-.75Z\"></path></svg><span class=\"NavLink-module__title__Q7t0p\">Codespaces</span><span class=\"NavLink-module__subtitle__X4gkW\">Instant dev environments</span></div></a></li><li><a href=\"https://github.com/features/issues\" data-analytics-event=\"{&quot;action&quot;:&quot;issues&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;issues_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><div class=\"NavLink-module__text__XvpLQ\"><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-issue-opened NavLink-module__icon__ltGNM\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M12 1c6.075 0 11 4.925 11 11s-4.925 11-11 11S1 18.075 1 12 5.925 1 12 1ZM2.5 12a9.5 9.5 0 0 0 9.5 9.5 9.5 9.5 0 0 0 9.5-9.5A9.5 9.5 0 0 0 12 2.5 9.5 9.5 0 0 0 2.5 12Zm9.5 2a2 2 0 1 1-.001-3.999A2 2 0 0 1 12 14Z\"></path></svg><span class=\"NavLink-module__title__Q7t0p\">Issues</span><span class=\"NavLink-module__subtitle__X4gkW\">Plan and track work</span></div></a></li><li><a href=\"https://github.com/features/code-review\" data-analytics-event=\"{&quot;action&quot;:&quot;code_review&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;code_review_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><div class=\"NavLink-module__text__XvpLQ\"><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-code NavLink-module__icon__ltGNM\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M15.22 4.97a.75.75 0 0 1 1.06 0l6.5 6.5a.75.75 0 0 1 0 1.06l-6.5 6.5a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L21.19 12l-5.97-5.97a.75.75 0 0 1 0-1.06Zm-6.44 0a.75.75 0 0 1 0 1.06L2.81 12l5.97 5.97a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215l-6.5-6.5a.75.75 0 0 1 0-1.06l6.5-6.5a.75.75 0 0 1 1.06 0Z\"></path></svg><span class=\"NavLink-module__title__Q7t0p\">Code Review</span><span class=\"NavLink-module__subtitle__X4gkW\">Manage code changes</span></div></a></li></ul></div></li><li><div class=\"NavGroup-module__group__W8SqJ\"><span class=\"NavGroup-module__title__Wzxz2\" id=\"_R_dhb_\">APPLICATION SECURITY</span><ul class=\"NavGroup-module__list__UCOFy\" aria-labelledby=\"_R_dhb_\"><li><a href=\"https://github.com/security/advanced-security\" data-analytics-event=\"{&quot;action&quot;:&quot;github_advanced_security&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;github_advanced_security_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><div class=\"NavLink-module__text__XvpLQ\"><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-shield-check NavLink-module__icon__ltGNM\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M16.53 9.78a.75.75 0 0 0-1.06-1.06L11 13.19l-1.97-1.97a.75.75 0 0 0-1.06 1.06l2.5 2.5a.75.75 0 0 0 1.06 0l5-5Z\"></path><path d=\"m12.54.637 8.25 2.675A1.75 1.75 0 0 1 22 4.976V10c0 6.19-3.771 10.704-9.401 12.83a1.704 1.704 0 0 1-1.198 0C5.77 20.705 2 16.19 2 10V4.976c0-.758.489-1.43 1.21-1.664L11.46.637a1.748 1.748 0 0 1 1.08 0Zm-.617 1.426-8.25 2.676a.249.249 0 0 0-.173.237V10c0 5.46 3.28 9.483 8.43 11.426a.199.199 0 0 0 .14 0C17.22 19.483 20.5 15.461 20.5 10V4.976a.25.25 0 0 0-.173-.237l-8.25-2.676a.253.253 0 0 0-.154 0Z\"></path></svg><span class=\"NavLink-module__title__Q7t0p\">GitHub Advanced Security</span><span class=\"NavLink-module__subtitle__X4gkW\">Find and fix vulnerabilities</span></div></a></li><li><a href=\"https://github.com/security/advanced-security/code-security\" data-analytics-event=\"{&quot;action&quot;:&quot;code_security&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;code_security_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><div class=\"NavLink-module__text__XvpLQ\"><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-code-square NavLink-module__icon__ltGNM\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M10.3 8.24a.75.75 0 0 1-.04 1.06L7.352 12l2.908 2.7a.75.75 0 1 1-1.02 1.1l-3.5-3.25a.75.75 0 0 1 0-1.1l3.5-3.25a.75.75 0 0 1 1.06.04Zm3.44 1.06a.75.75 0 1 1 1.02-1.1l3.5 3.25a.75.75 0 0 1 0 1.1l-3.5 3.25a.75.75 0 1 1-1.02-1.1l2.908-2.7-2.908-2.7Z\"></path><path d=\"M2 3.75C2 2.784 2.784 2 3.75 2h16.5c.966 0 1.75.784 1.75 1.75v16.5A1.75 1.75 0 0 1 20.25 22H3.75A1.75 1.75 0 0 1 2 20.25Zm1.75-.25a.25.25 0 0 0-.25.25v16.5c0 .138.112.25.25.25h16.5a.25.25 0 0 0 .25-.25V3.75a.25.25 0 0 0-.25-.25Z\"></path></svg><span class=\"NavLink-module__title__Q7t0p\">Code security</span><span class=\"NavLink-module__subtitle__X4gkW\">Secure your code as you build</span></div></a></li><li><a href=\"https://github.com/security/advanced-security/secret-protection\" data-analytics-event=\"{&quot;action&quot;:&quot;secret_protection&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;secret_protection_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><div class=\"NavLink-module__text__XvpLQ\"><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-lock NavLink-module__icon__ltGNM\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M6 9V7.25C6 3.845 8.503 1 12 1s6 2.845 6 6.25V9h.5a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 19.5v-8A2.5 2.5 0 0 1 5.5 9Zm-1.5 2.5v8a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-13a1 1 0 0 0-1 1Zm3-4.25V9h9V7.25c0-2.67-1.922-4.75-4.5-4.75-2.578 0-4.5 2.08-4.5 4.75Z\"></path></svg><span class=\"NavLink-module__title__Q7t0p\">Secret protection</span><span class=\"NavLink-module__subtitle__X4gkW\">Stop leaks before they start</span></div></a></li></ul></div></li><li><div class=\"NavGroup-module__group__W8SqJ NavGroup-module__hasSeparator__FnMrN\"><span class=\"NavGroup-module__title__Wzxz2\" id=\"_R_hhb_\">EXPLORE</span><ul class=\"NavGroup-module__list__UCOFy\" aria-labelledby=\"_R_hhb_\"><li><a href=\"https://github.com/why-github\" data-analytics-event=\"{&quot;action&quot;:&quot;why_github&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;why_github_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Why GitHub</span></a></li><li><a href=\"https://docs.github.com\" data-analytics-event=\"{&quot;action&quot;:&quot;documentation&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;documentation_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\" target=\"_blank\" rel=\"noreferrer\"><span class=\"NavLink-module__title__Q7t0p\">Documentation</span><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-link-external NavLink-module__externalIcon__eWIry\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z\"></path></svg></a></li><li><a href=\"https://github.blog\" data-analytics-event=\"{&quot;action&quot;:&quot;blog&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;blog_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\" target=\"_blank\" rel=\"noreferrer\"><span class=\"NavLink-module__title__Q7t0p\">Blog</span><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-link-external NavLink-module__externalIcon__eWIry\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z\"></path></svg></a></li><li><a href=\"https://github.blog/changelog\" data-analytics-event=\"{&quot;action&quot;:&quot;changelog&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;changelog_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\" target=\"_blank\" rel=\"noreferrer\"><span class=\"NavLink-module__title__Q7t0p\">Changelog</span><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-link-external NavLink-module__externalIcon__eWIry\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z\"></path></svg></a></li><li><a href=\"https://github.com/marketplace\" data-analytics-event=\"{&quot;action&quot;:&quot;marketplace&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;marketplace_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Marketplace</span></a></li></ul></div></li></ul><div class=\"NavDropdown-module__trailingLinkContainer__VgJGL\"><a href=\"https://github.com/features\" data-analytics-event=\"{&quot;action&quot;:&quot;view_all_features&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;view_all_features_link_platform_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">View all features</span><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-chevron-right NavLink-module__arrowIcon__amekg\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z\"></path></svg></a></div></div></div></li><li><div class=\"NavDropdown-module__container__l2YeI js-details-container js-header-menu-item\"><button type=\"button\" class=\"NavDropdown-module__button__PEHWX js-details-target\" aria-expanded=\"false\">Solutions<svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-chevron-right NavDropdown-module__buttonIcon__Tkl8_\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z\"></path></svg></button><div class=\"NavDropdown-module__dropdown__xm1jd\"><ul class=\"NavDropdown-module__list__zuCgG\"><li><div class=\"NavGroup-module__group__W8SqJ\"><span class=\"NavGroup-module__title__Wzxz2\" id=\"_R_5ib_\">BY COMPANY SIZE</span><ul class=\"NavGroup-module__list__UCOFy\" aria-labelledby=\"_R_5ib_\"><li><a href=\"https://github.com/enterprise\" data-analytics-event=\"{&quot;action&quot;:&quot;enterprises&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;solutions&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;enterprises_link_solutions_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Enterprises</span></a></li><li><a href=\"https://github.com/team\" data-analytics-event=\"{&quot;action&quot;:&quot;small_and_medium_teams&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;solutions&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;small_and_medium_teams_link_solutions_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Small and medium teams</span></a></li><li><a href=\"https://github.com/enterprise/startups\" data-analytics-event=\"{&quot;action&quot;:&quot;startups&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;solutions&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;startups_link_solutions_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Startups</span></a></li><li><a href=\"https://github.com/solutions/industry/nonprofits\" data-analytics-event=\"{&quot;action&quot;:&quot;nonprofits&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;solutions&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;nonprofits_link_solutions_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Nonprofits</span></a></li></ul></div></li><li><div class=\"NavGroup-module__group__W8SqJ\"><span class=\"NavGroup-module__title__Wzxz2\" id=\"_R_9ib_\">BY USE CASE</span><ul class=\"NavGroup-module__list__UCOFy\" aria-labelledby=\"_R_9ib_\"><li><a href=\"https://github.com/solutions/use-case/app-modernization\" data-analytics-event=\"{&quot;action&quot;:&quot;app_modernization&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;solutions&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;app_modernization_link_solutions_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">App Modernization</span></a></li><li><a href=\"https://github.com/solutions/use-case/devsecops\" data-analytics-event=\"{&quot;action&quot;:&quot;devsecops&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;solutions&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;devsecops_link_solutions_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">DevSecOps</span></a></li><li><a href=\"https://github.com/solutions/use-case/devops\" data-analytics-event=\"{&quot;action&quot;:&quot;devops&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;solutions&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;devops_link_solutions_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">DevOps</span></a></li><li><a href=\"https://github.com/solutions/use-case/ci-cd\" data-analytics-event=\"{&quot;action&quot;:&quot;ci/cd&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;solutions&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;ci/cd_link_solutions_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">CI/CD</span></a></li><li><a href=\"https://github.com/solutions/use-case\" data-analytics-event=\"{&quot;action&quot;:&quot;view_all_use_cases&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;solutions&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;view_all_use_cases_link_solutions_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">View all use cases</span><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-chevron-right NavLink-module__arrowIcon__amekg\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z\"></path></svg></a></li></ul></div></li><li><div class=\"NavGroup-module__group__W8SqJ\"><span class=\"NavGroup-module__title__Wzxz2\" id=\"_R_dib_\">BY INDUSTRY</span><ul class=\"NavGroup-module__list__UCOFy\" aria-labelledby=\"_R_dib_\"><li><a href=\"https://github.com/solutions/industry/healthcare\" data-analytics-event=\"{&quot;action&quot;:&quot;healthcare&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;solutions&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;healthcare_link_solutions_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Healthcare</span></a></li><li><a href=\"https://github.com/solutions/industry/financial-services\" data-analytics-event=\"{&quot;action&quot;:&quot;financial_services&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;solutions&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;financial_services_link_solutions_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Financial services</span></a></li><li><a href=\"https://github.com/solutions/industry/manufacturing\" data-analytics-event=\"{&quot;action&quot;:&quot;manufacturing&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;solutions&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;manufacturing_link_solutions_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Manufacturing</span></a></li><li><a href=\"https://github.com/solutions/industry/government\" data-analytics-event=\"{&quot;action&quot;:&quot;government&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;solutions&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;government_link_solutions_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Government</span></a></li><li><a href=\"https://github.com/solutions/industry\" data-analytics-event=\"{&quot;action&quot;:&quot;view_all_industries&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;solutions&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;view_all_industries_link_solutions_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">View all industries</span><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-chevron-right NavLink-module__arrowIcon__amekg\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z\"></path></svg></a></li></ul></div></li></ul><div class=\"NavDropdown-module__trailingLinkContainer__VgJGL\"><a href=\"https://github.com/solutions\" data-analytics-event=\"{&quot;action&quot;:&quot;view_all_solutions&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;solutions&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;view_all_solutions_link_solutions_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">View all solutions</span><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-chevron-right NavLink-module__arrowIcon__amekg\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z\"></path></svg></a></div></div></div></li><li><div class=\"NavDropdown-module__container__l2YeI js-details-container js-header-menu-item\"><button type=\"button\" class=\"NavDropdown-module__button__PEHWX js-details-target\" aria-expanded=\"false\">Resources<svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-chevron-right NavDropdown-module__buttonIcon__Tkl8_\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z\"></path></svg></button><div class=\"NavDropdown-module__dropdown__xm1jd\"><ul class=\"NavDropdown-module__list__zuCgG\"><li><div class=\"NavGroup-module__group__W8SqJ\"><span class=\"NavGroup-module__title__Wzxz2\" id=\"_R_5jb_\">EXPLORE BY TOPIC</span><ul class=\"NavGroup-module__list__UCOFy\" aria-labelledby=\"_R_5jb_\"><li><a href=\"https://github.com/resources/articles?topic=ai\" data-analytics-event=\"{&quot;action&quot;:&quot;ai&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;resources&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;ai_link_resources_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">AI</span></a></li><li><a href=\"https://github.com/resources/articles?topic=software-development\" data-analytics-event=\"{&quot;action&quot;:&quot;software_development&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;resources&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;software_development_link_resources_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Software Development</span></a></li><li><a href=\"https://github.com/resources/articles?topic=devops\" data-analytics-event=\"{&quot;action&quot;:&quot;devops&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;resources&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;devops_link_resources_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">DevOps</span></a></li><li><a href=\"https://github.com/resources/articles?topic=security\" data-analytics-event=\"{&quot;action&quot;:&quot;security&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;resources&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;security_link_resources_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Security</span></a></li><li><a href=\"https://github.com/resources/articles\" data-analytics-event=\"{&quot;action&quot;:&quot;view_all_topics&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;resources&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;view_all_topics_link_resources_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">View all topics</span><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-chevron-right NavLink-module__arrowIcon__amekg\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z\"></path></svg></a></li></ul></div></li><li><div class=\"NavGroup-module__group__W8SqJ\"><span class=\"NavGroup-module__title__Wzxz2\" id=\"_R_9jb_\">EXPLORE BY TYPE</span><ul class=\"NavGroup-module__list__UCOFy\" aria-labelledby=\"_R_9jb_\"><li><a href=\"https://github.com/customer-stories\" data-analytics-event=\"{&quot;action&quot;:&quot;customer_stories&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;resources&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;customer_stories_link_resources_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Customer stories</span></a></li><li><a href=\"https://github.com/resources/events\" data-analytics-event=\"{&quot;action&quot;:&quot;events__webinars&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;resources&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;events__webinars_link_resources_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Events &amp; webinars</span></a></li><li><a href=\"https://github.com/resources/whitepapers\" data-analytics-event=\"{&quot;action&quot;:&quot;ebooks__reports&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;resources&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;ebooks__reports_link_resources_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Ebooks &amp; reports</span></a></li><li><a href=\"https://github.com/solutions/executive-insights\" data-analytics-event=\"{&quot;action&quot;:&quot;business_insights&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;resources&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;business_insights_link_resources_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Business insights</span></a></li><li><a href=\"https://skills.github.com\" data-analytics-event=\"{&quot;action&quot;:&quot;github_skills&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;resources&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;github_skills_link_resources_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\" target=\"_blank\" rel=\"noreferrer\"><span class=\"NavLink-module__title__Q7t0p\">GitHub Skills</span><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-link-external NavLink-module__externalIcon__eWIry\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z\"></path></svg></a></li></ul></div></li><li><div class=\"NavGroup-module__group__W8SqJ\"><span class=\"NavGroup-module__title__Wzxz2\" id=\"_R_djb_\">SUPPORT &amp; SERVICES</span><ul class=\"NavGroup-module__list__UCOFy\" aria-labelledby=\"_R_djb_\"><li><a href=\"https://docs.github.com\" data-analytics-event=\"{&quot;action&quot;:&quot;documentation&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;resources&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;documentation_link_resources_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\" target=\"_blank\" rel=\"noreferrer\"><span class=\"NavLink-module__title__Q7t0p\">Documentation</span><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-link-external NavLink-module__externalIcon__eWIry\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z\"></path></svg></a></li><li><a href=\"https://support.github.com\" data-analytics-event=\"{&quot;action&quot;:&quot;customer_support&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;resources&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;customer_support_link_resources_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\" target=\"_blank\" rel=\"noreferrer\"><span class=\"NavLink-module__title__Q7t0p\">Customer support</span><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-link-external NavLink-module__externalIcon__eWIry\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z\"></path></svg></a></li><li><a href=\"https://github.com/orgs/community/discussions\" data-analytics-event=\"{&quot;action&quot;:&quot;community_forum&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;resources&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;community_forum_link_resources_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Community forum</span></a></li><li><a href=\"https://github.com/trust-center\" data-analytics-event=\"{&quot;action&quot;:&quot;trust_center&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;resources&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;trust_center_link_resources_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Trust center</span></a></li><li><a href=\"https://github.com/partners\" data-analytics-event=\"{&quot;action&quot;:&quot;partners&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;resources&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;partners_link_resources_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Partners</span></a></li></ul></div></li></ul><div class=\"NavDropdown-module__trailingLinkContainer__VgJGL\"><a href=\"https://github.com/resources\" data-analytics-event=\"{&quot;action&quot;:&quot;view_all_resources&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;resources&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;view_all_resources_link_resources_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">View all resources</span><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-chevron-right NavLink-module__arrowIcon__amekg\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z\"></path></svg></a></div></div></div></li><li><div class=\"NavDropdown-module__container__l2YeI js-details-container js-header-menu-item\"><button type=\"button\" class=\"NavDropdown-module__button__PEHWX js-details-target\" aria-expanded=\"false\">Open Source<svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-chevron-right NavDropdown-module__buttonIcon__Tkl8_\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z\"></path></svg></button><div class=\"NavDropdown-module__dropdown__xm1jd\"><ul class=\"NavDropdown-module__list__zuCgG\"><li><div class=\"NavGroup-module__group__W8SqJ\"><span class=\"NavGroup-module__title__Wzxz2\" id=\"_R_5kb_\">COMMUNITY</span><ul class=\"NavGroup-module__list__UCOFy\" aria-labelledby=\"_R_5kb_\"><li><a href=\"https://github.com/sponsors\" data-analytics-event=\"{&quot;action&quot;:&quot;github_sponsors&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;open_source&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;github_sponsors_link_open_source_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><div class=\"NavLink-module__text__XvpLQ\"><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-sponsor-tiers NavLink-module__icon__ltGNM\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M16.004 1.25C18.311 1.25 20 3.128 20 5.75c0 2.292-1.23 4.464-3.295 6.485-.481.47-.98.909-1.482 1.31l.265 1.32 1.375 7.5a.75.75 0 0 1-.982.844l-3.512-1.207a.75.75 0 0 0-.488 0L8.37 23.209a.75.75 0 0 1-.982-.844l1.378-7.512.261-1.309c-.5-.4-1-.838-1.481-1.31C5.479 10.215 4.25 8.043 4.25 5.75c0-2.622 1.689-4.5 3.996-4.5 1.55 0 2.947.752 3.832 1.967l.047.067.047-.067a4.726 4.726 0 0 1 3.612-1.962l.22-.005ZM13.89 14.531c-.418.285-.828.542-1.218.77l-.18.103a.75.75 0 0 1-.734 0l-.071-.04-.46-.272c-.282-.173-.573-.36-.868-.562l-.121.605-1.145 6.239 2.3-.79a2.248 2.248 0 0 1 1.284-.054l.18.053 2.299.79-1.141-6.226-.125-.616ZM16.004 2.75c-1.464 0-2.731.983-3.159 2.459-.209.721-1.231.721-1.44 0-.428-1.476-1.695-2.459-3.16-2.459-1.44 0-2.495 1.173-2.495 3 0 1.811 1.039 3.647 2.844 5.412a19.624 19.624 0 0 0 3.734 2.84l-.019-.011-.184-.111.147-.088a19.81 19.81 0 0 0 3.015-2.278l.37-.352C17.46 9.397 18.5 7.561 18.5 5.75c0-1.827-1.055-3-2.496-3Z\"></path></svg><span class=\"NavLink-module__title__Q7t0p\">GitHub Sponsors</span><span class=\"NavLink-module__subtitle__X4gkW\">Fund open source developers</span></div></a></li></ul></div></li><li><div class=\"NavGroup-module__group__W8SqJ\"><span class=\"NavGroup-module__title__Wzxz2\" id=\"_R_9kb_\">PROGRAMS</span><ul class=\"NavGroup-module__list__UCOFy\" aria-labelledby=\"_R_9kb_\"><li><a href=\"https://securitylab.github.com\" data-analytics-event=\"{&quot;action&quot;:&quot;security_lab&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;open_source&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;security_lab_link_open_source_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\" target=\"_blank\" rel=\"noreferrer\"><span class=\"NavLink-module__title__Q7t0p\">Security Lab</span><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-link-external NavLink-module__externalIcon__eWIry\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z\"></path></svg></a></li><li><a href=\"https://maintainers.github.com\" data-analytics-event=\"{&quot;action&quot;:&quot;maintainer_community&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;open_source&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;maintainer_community_link_open_source_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\" target=\"_blank\" rel=\"noreferrer\"><span class=\"NavLink-module__title__Q7t0p\">Maintainer Community</span><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-link-external NavLink-module__externalIcon__eWIry\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z\"></path></svg></a></li><li><a href=\"https://github.com/accelerator\" data-analytics-event=\"{&quot;action&quot;:&quot;accelerator&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;open_source&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;accelerator_link_open_source_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Accelerator</span></a></li><li><a href=\"https://stars.github.com\" data-analytics-event=\"{&quot;action&quot;:&quot;github_stars&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;open_source&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;github_stars_link_open_source_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\" target=\"_blank\" rel=\"noreferrer\"><span class=\"NavLink-module__title__Q7t0p\">GitHub Stars</span><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-link-external NavLink-module__externalIcon__eWIry\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z\"></path></svg></a></li><li><a href=\"https://archiveprogram.github.com\" data-analytics-event=\"{&quot;action&quot;:&quot;archive_program&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;open_source&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;archive_program_link_open_source_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\" target=\"_blank\" rel=\"noreferrer\"><span class=\"NavLink-module__title__Q7t0p\">Archive Program</span><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-link-external NavLink-module__externalIcon__eWIry\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z\"></path></svg></a></li></ul></div></li><li><div class=\"NavGroup-module__group__W8SqJ\"><span class=\"NavGroup-module__title__Wzxz2\" id=\"_R_dkb_\">REPOSITORIES</span><ul class=\"NavGroup-module__list__UCOFy\" aria-labelledby=\"_R_dkb_\"><li><a href=\"https://github.com/topics\" data-analytics-event=\"{&quot;action&quot;:&quot;topics&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;open_source&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;topics_link_open_source_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Topics</span></a></li><li><a href=\"https://github.com/trending\" data-analytics-event=\"{&quot;action&quot;:&quot;trending&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;open_source&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;trending_link_open_source_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Trending</span></a></li><li><a href=\"https://github.com/collections\" data-analytics-event=\"{&quot;action&quot;:&quot;collections&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;open_source&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;collections_link_open_source_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><span class=\"NavLink-module__title__Q7t0p\">Collections</span></a></li></ul></div></li></ul></div></div></li><li><div class=\"NavDropdown-module__container__l2YeI js-details-container js-header-menu-item\"><button type=\"button\" class=\"NavDropdown-module__button__PEHWX js-details-target\" aria-expanded=\"false\">Enterprise<svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-chevron-right NavDropdown-module__buttonIcon__Tkl8_\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z\"></path></svg></button><div class=\"NavDropdown-module__dropdown__xm1jd\"><ul class=\"NavDropdown-module__list__zuCgG\"><li><div class=\"NavGroup-module__group__W8SqJ\"><span class=\"NavGroup-module__title__Wzxz2\" id=\"_R_5lb_\">ENTERPRISE SOLUTIONS</span><ul class=\"NavGroup-module__list__UCOFy\" aria-labelledby=\"_R_5lb_\"><li><a href=\"https://github.com/enterprise\" data-analytics-event=\"{&quot;action&quot;:&quot;enterprise_platform&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;enterprise&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;enterprise_platform_link_enterprise_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><div class=\"NavLink-module__text__XvpLQ\"><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-stack NavLink-module__icon__ltGNM\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M11.063 1.456a1.749 1.749 0 0 1 1.874 0l8.383 5.316a1.751 1.751 0 0 1 0 2.956l-8.383 5.316a1.749 1.749 0 0 1-1.874 0L2.68 9.728a1.751 1.751 0 0 1 0-2.956Zm1.071 1.267a.25.25 0 0 0-.268 0L3.483 8.039a.25.25 0 0 0 0 .422l8.383 5.316a.25.25 0 0 0 .268 0l8.383-5.316a.25.25 0 0 0 0-.422Z\"></path><path d=\"M1.867 12.324a.75.75 0 0 1 1.035-.232l8.964 5.685a.25.25 0 0 0 .268 0l8.964-5.685a.75.75 0 0 1 .804 1.267l-8.965 5.685a1.749 1.749 0 0 1-1.874 0l-8.965-5.685a.75.75 0 0 1-.231-1.035Z\"></path><path d=\"M1.867 16.324a.75.75 0 0 1 1.035-.232l8.964 5.685a.25.25 0 0 0 .268 0l8.964-5.685a.75.75 0 0 1 .804 1.267l-8.965 5.685a1.749 1.749 0 0 1-1.874 0l-8.965-5.685a.75.75 0 0 1-.231-1.035Z\"></path></svg><span class=\"NavLink-module__title__Q7t0p\">Enterprise platform</span><span class=\"NavLink-module__subtitle__X4gkW\">AI-powered developer platform</span></div></a></li></ul></div></li><li><div class=\"NavGroup-module__group__W8SqJ\"><span class=\"NavGroup-module__title__Wzxz2\" id=\"_R_9lb_\">AVAILABLE ADD-ONS</span><ul class=\"NavGroup-module__list__UCOFy\" aria-labelledby=\"_R_9lb_\"><li><a href=\"https://github.com/security/advanced-security\" data-analytics-event=\"{&quot;action&quot;:&quot;github_advanced_security&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;enterprise&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;github_advanced_security_link_enterprise_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><div class=\"NavLink-module__text__XvpLQ\"><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-shield-check NavLink-module__icon__ltGNM\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M16.53 9.78a.75.75 0 0 0-1.06-1.06L11 13.19l-1.97-1.97a.75.75 0 0 0-1.06 1.06l2.5 2.5a.75.75 0 0 0 1.06 0l5-5Z\"></path><path d=\"m12.54.637 8.25 2.675A1.75 1.75 0 0 1 22 4.976V10c0 6.19-3.771 10.704-9.401 12.83a1.704 1.704 0 0 1-1.198 0C5.77 20.705 2 16.19 2 10V4.976c0-.758.489-1.43 1.21-1.664L11.46.637a1.748 1.748 0 0 1 1.08 0Zm-.617 1.426-8.25 2.676a.249.249 0 0 0-.173.237V10c0 5.46 3.28 9.483 8.43 11.426a.199.199 0 0 0 .14 0C17.22 19.483 20.5 15.461 20.5 10V4.976a.25.25 0 0 0-.173-.237l-8.25-2.676a.253.253 0 0 0-.154 0Z\"></path></svg><span class=\"NavLink-module__title__Q7t0p\">GitHub Advanced Security</span><span class=\"NavLink-module__subtitle__X4gkW\">Enterprise-grade security features</span></div></a></li><li><a href=\"https://github.com/features/copilot/copilot-business\" data-analytics-event=\"{&quot;action&quot;:&quot;copilot_for_business&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;enterprise&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;copilot_for_business_link_enterprise_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><div class=\"NavLink-module__text__XvpLQ\"><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-copilot NavLink-module__icon__ltGNM\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M23.922 16.992c-.861 1.495-5.859 5.023-11.922 5.023-6.063 0-11.061-3.528-11.922-5.023A.641.641 0 0 1 0 16.736v-2.869a.841.841 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.195 10.195 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952 1.399-1.136 3.392-2.093 6.122-2.093 2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.832.832 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256ZM12.172 11h-.344a4.323 4.323 0 0 1-.355.508C10.703 12.455 9.555 13 7.965 13c-1.725 0-2.989-.359-3.782-1.259a2.005 2.005 0 0 1-.085-.104L4 11.741v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.323 4.323 0 0 1-.355-.508h-.016.016Zm.641-2.935c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z\"></path><path d=\"M14.5 14.25a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1Zm-5 0a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1Z\"></path></svg><span class=\"NavLink-module__title__Q7t0p\">Copilot for Business</span><span class=\"NavLink-module__subtitle__X4gkW\">Enterprise-grade AI features</span></div></a></li><li><a href=\"https://github.com/premium-support\" data-analytics-event=\"{&quot;action&quot;:&quot;premium_support&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;enterprise&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;premium_support_link_enterprise_navbar&quot;}\" class=\"NavLink-module__link__EG3d4\"><div class=\"NavLink-module__text__XvpLQ\"><svg data-component=\"Octicon\" aria-hidden=\"true\" focusable=\"false\" class=\"octicon octicon-comment-discussion NavLink-module__icon__ltGNM\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"currentColor\" display=\"inline-block\" overflow=\"visible\" style=\"vertical-align:text-bottom\"><path d=\"M1.75 1h12.5c.966 0 1.75.784 1.75 1.75v9.5A1.75 1.75 0 0 1 14.25 14H8.061l-2.574 2.573A1.458 1.458 0 0 1 3 15.543V14H1.75A1.75 1.75 0 0 1 0 12.25v-9.5C0 1.784.784 1 1.75 1ZM1.5 2.75v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25Z\"></path><path d=\"M22.5 8.75a.25.25 0 0 0-.25-.25h-3.5a.75.75 0 0 1 0-1.5h3.5c.966 0 1.75.784 1.75 1.75v9.5A1.75 1.75 0 0 1 22.25 20H21v1.543a1.457 1.457 0 0 1-2.487 1.03L15.939 20H10.75A1.75 1.75 0 0 1 9 18.25v-1.465a.75.75 0 0 1 1.5 0v1.465c0 .138.112.25.25.25h5.5a.75.75 0 0 1 .53.22l2.72 2.72v-2.19a.75.75 0 0 1 .75-.75h2a.25.25 0 0 0 .25-.25v-9.5Z\"></path></svg><span class=\"NavLink-module__title__Q7t0p\">Premium Support</span><span class=\"NavLink-module__subtitle__X4gkW\">Enterprise-grade 24/7 support</span></div></a></li></ul></div></li></ul></div></div></li><li><a href=\"https://github.com/pricing\" data-analytics-event=\"{&quot;action&quot;:&quot;pricing&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;context&quot;:&quot;pricing&quot;,&quot;location&quot;:&quot;navbar&quot;,&quot;label&quot;:&quot;pricing_link_pricing_navbar&quot;}\" class=\"NavLink-module__link__EG3d4 MarketingNavigation-module__navLink__hUomM\"><span class=\"NavLink-module__title__Q7t0p\">Pricing</span></a></li></ul></nav><script type=\"application/json\" id=\"__PRIMER_DATA__R_0___\">{\"resolvedServerColorMode\":\"day\"}</script></div>\n</react-partial>\n\n\n\n        <div class=\"d-flex flex-column flex-lg-row width-full flex-justify-end flex-lg-items-center text-center tmp-mt-3 tmp-mt-lg-0 text-lg-left tmp-ml-lg-3\">\n                \n\n\n<qbsearch-input class=\"search-input\" data-scope=\"owner:nicobailon\" data-custom-scopes-path=\"/search/custom_scopes\" data-delete-custom-scopes-csrf=\"Q8MveHQZDTAYPvLh_UtgSeYdwyrYWn7_ZRQz1mp4i2Wzk6m9KvI5ypXDaoFwTKy-LUZHdw7XQg6L5q2MbGv1Aw\" data-max-custom-scopes=\"10\" data-header-redesign-enabled=\"false\" data-initial-value=\"\" data-blackbird-suggestions-path=\"/search/suggestions\" data-jump-to-suggestions-path=\"/_graphql/GetSuggestedNavigationDestinations\" data-current-repository=\"\" data-current-org=\"\" data-current-owner=\"\" data-logged-in=\"false\" data-copilot-chat-enabled=\"false\" data-nl-search-enabled=\"false\" data-retain-scroll-position=\"true\">\n  <div\n    class=\"search-input-container search-with-dialog position-relative d-flex flex-row flex-items-center tmp-mr-4 rounded\"\n    data-action=\"click:qbsearch-input#searchInputContainerClicked\"\n  >\n      <button\n        type=\"button\"\n        class=\"header-search-button placeholder  input-button form-control d-flex flex-1 flex-self-stretch flex-items-center no-wrap width-full py-0 pl-2 pr-0 text-left border-0 box-shadow-none\"\n        data-target=\"qbsearch-input.inputButton\"\n        aria-label=\"Search or jump to…\"\n        aria-haspopup=\"dialog\"\n        placeholder=\"Search or jump to...\"\n        data-hotkey=s,/\n        autocapitalize=\"off\"\n        data-analytics-event=\"{&quot;location&quot;:&quot;navbar&quot;,&quot;action&quot;:&quot;searchbar&quot;,&quot;context&quot;:&quot;global&quot;,&quot;tag&quot;:&quot;input&quot;,&quot;label&quot;:&quot;searchbar_input_global_navbar&quot;}\"\n        data-action=\"click:qbsearch-input#handleExpand\"\n      >\n        <div class=\"mr-2 color-fg-muted\">\n          <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-search\">\n    <path d=\"M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z\"></path>\n</svg>\n        </div>\n        <span class=\"flex-1\" data-target=\"qbsearch-input.inputButtonText\">Search or jump to...</span>\n          <div class=\"d-flex\" data-target=\"qbsearch-input.hotkeyIndicator\">\n            <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"22\" height=\"20\" aria-hidden=\"true\" class=\"mr-1\"><path fill=\"none\" stroke=\"#979A9C\" opacity=\".4\" d=\"M3.5.5h12c1.7 0 3 1.3 3 3v13c0 1.7-1.3 3-3 3h-12c-1.7 0-3-1.3-3-3v-13c0-1.7 1.3-3 3-3z\"></path><path fill=\"#979A9C\" d=\"M11.8 6L8 15.1h-.9L10.8 6h1z\"></path></svg>\n          </div>\n      </button>\n\n    <input type=\"hidden\" name=\"type\" class=\"js-site-search-type-field\">\n\n    \n<div class=\"Overlay--hidden \" data-modal-dialog-overlay>\n  <modal-dialog data-action=\"close:qbsearch-input#handleClose cancel:qbsearch-input#handleClose\" data-target=\"qbsearch-input.searchSuggestionsDialog\" role=\"dialog\" id=\"search-suggestions-dialog\" aria-modal=\"true\" aria-labelledby=\"search-suggestions-dialog-header\" data-view-component=\"true\" class=\"Overlay Overlay--width-large Overlay--height-auto\">\n      <h1 id=\"search-suggestions-dialog-header\" class=\"sr-only\">Search code, repositories, users, issues, pull requests...</h1>\n    <div class=\"Overlay-body Overlay-body--paddingNone\">\n      \n          <div data-view-component=\"true\">        <div class=\"search-suggestions position-fixed width-full color-shadow-large border color-fg-default color-bg-default overflow-hidden d-flex flex-column query-builder-container\"\n          style=\"border-radius: 12px;\"\n          data-target=\"qbsearch-input.queryBuilderContainer\"\n          hidden\n        >\n          <!-- '\"` --><!-- </textarea></xmp> --></option></form><form id=\"query-builder-test-form\" action=\"\" accept-charset=\"UTF-8\" method=\"get\">\n  <query-builder data-target=\"qbsearch-input.queryBuilder\" id=\"query-builder-query-builder-test\" data-filter-key=\":\" data-view-component=\"true\" class=\"QueryBuilder search-query-builder\">\n    <div class=\"FormControl FormControl--fullWidth\">\n      <label id=\"query-builder-test-label\" for=\"query-builder-test\" class=\"FormControl-label sr-only\">\n        Search\n      </label>\n      <div\n        class=\"QueryBuilder-StyledInput width-fit \"\n        data-target=\"query-builder.styledInput\"\n      >\n          <span id=\"query-builder-test-leadingvisual-wrap\" class=\"FormControl-input-leadingVisualWrap QueryBuilder-leadingVisualWrap\">\n            <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-search FormControl-input-leadingVisual\">\n    <path d=\"M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z\"></path>\n</svg>\n          </span>\n        <div data-target=\"query-builder.styledInputContainer\" class=\"QueryBuilder-StyledInputContainer\">\n          <div\n            aria-hidden=\"true\"\n            class=\"QueryBuilder-StyledInputContent\"\n            data-target=\"query-builder.styledInputContent\"\n          ></div>\n          <div class=\"QueryBuilder-InputWrapper\">\n            <div aria-hidden=\"true\" class=\"QueryBuilder-Sizer\" data-target=\"query-builder.sizer\"></div>\n            <input id=\"query-builder-test\" name=\"query-builder-test\" value=\"\" autocomplete=\"off\" type=\"text\" role=\"combobox\" spellcheck=\"false\" aria-expanded=\"false\" aria-describedby=\"validation-a679f44d-bf14-44f2-9e0e-acb8d4623360\" data-target=\"query-builder.input\" data-action=\"\n          input:query-builder#inputChange\n          blur:query-builder#inputBlur\n          keydown:query-builder#inputKeydown\n          focus:query-builder#inputFocus\n        \" data-view-component=\"true\" class=\"FormControl-input QueryBuilder-Input FormControl-medium\" />\n          </div>\n        </div>\n          <span data-target=\"query-builder.clearButton\" hidden>\n            <span class=\"sr-only\" id=\"query-builder-test-clear\">Clear</span>\n            <button role=\"button\" id=\"query-builder-test-clear-button\" aria-labelledby=\"query-builder-test-clear query-builder-test-label\" data-action=\"\n                  click:query-builder#clear\n                  focus:query-builder#clearButtonFocus\n                  blur:query-builder#clearButtonBlur\n                \" variant=\"small\" type=\"button\" data-view-component=\"true\" class=\"Button Button--iconOnly Button--invisible Button--medium mr-1 tmp-mr-1 px-2 tmp-px-2 py-0 tmp-py-0 d-flex flex-items-center rounded-1 color-fg-muted\">  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-x-circle-fill Button-visual\">\n    <path d=\"M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z\"></path>\n</svg>\n</button>\n\n          </span>\n      </div>\n      <template id=\"search-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-search\">\n    <path d=\"M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z\"></path>\n</svg>\n</template>\n\n<template id=\"code-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-code\">\n    <path d=\"m11.28 3.22 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.94 8l-3.72-3.72a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215Zm-6.56 0a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L2.06 8l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L.47 8.53a.75.75 0 0 1 0-1.06Z\"></path>\n</svg>\n</template>\n\n<template id=\"file-code-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-file-code\">\n    <path d=\"M4 1.75C4 .784 4.784 0 5.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v8.586A1.75 1.75 0 0 1 14.25 15h-9a.75.75 0 0 1 0-1.5h9a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 10 4.25V1.5H5.75a.25.25 0 0 0-.25.25v2.5a.75.75 0 0 1-1.5 0Zm1.72 4.97a.75.75 0 0 1 1.06 0l2 2a.75.75 0 0 1 0 1.06l-2 2a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l1.47-1.47-1.47-1.47a.75.75 0 0 1 0-1.06ZM3.28 7.78 1.81 9.25l1.47 1.47a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-2-2a.75.75 0 0 1 0-1.06l2-2a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Zm8.22-6.218V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z\"></path>\n</svg>\n</template>\n\n<template id=\"history-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-history\">\n    <path d=\"m.427 1.927 1.215 1.215a8.002 8.002 0 1 1-1.6 5.685.75.75 0 1 1 1.493-.154 6.5 6.5 0 1 0 1.18-4.458l1.358 1.358A.25.25 0 0 1 3.896 6H.25A.25.25 0 0 1 0 5.75V2.104a.25.25 0 0 1 .427-.177ZM7.75 4a.75.75 0 0 1 .75.75v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5A.75.75 0 0 1 7.75 4Z\"></path>\n</svg>\n</template>\n\n<template id=\"repo-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-repo\">\n    <path d=\"M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z\"></path>\n</svg>\n</template>\n\n<template id=\"bookmark-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-bookmark\">\n    <path d=\"M3 2.75C3 1.784 3.784 1 4.75 1h6.5c.966 0 1.75.784 1.75 1.75v11.5a.75.75 0 0 1-1.227.579L8 11.722l-3.773 3.107A.751.751 0 0 1 3 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.91l3.023-2.489a.75.75 0 0 1 .954 0l3.023 2.49V2.75a.25.25 0 0 0-.25-.25Z\"></path>\n</svg>\n</template>\n\n<template id=\"plus-circle-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-plus-circle\">\n    <path d=\"M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7.25-3.25v2.5h2.5a.75.75 0 0 1 0 1.5h-2.5v2.5a.75.75 0 0 1-1.5 0v-2.5h-2.5a.75.75 0 0 1 0-1.5h2.5v-2.5a.75.75 0 0 1 1.5 0Z\"></path>\n</svg>\n</template>\n\n<template id=\"circle-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-dot-fill\">\n    <path d=\"M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z\"></path>\n</svg>\n</template>\n\n<template id=\"trash-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-trash\">\n    <path d=\"M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z\"></path>\n</svg>\n</template>\n\n<template id=\"team-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-people\">\n    <path d=\"M2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4 4 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.493 3.493 0 0 1 2 5.5ZM11 4a3.001 3.001 0 0 1 2.22 5.018 5.01 5.01 0 0 1 2.56 3.012.749.749 0 0 1-.885.954.752.752 0 0 1-.549-.514 3.507 3.507 0 0 0-2.522-2.372.75.75 0 0 1-.574-.73v-.352a.75.75 0 0 1 .416-.672A1.5 1.5 0 0 0 11 5.5.75.75 0 0 1 11 4Zm-5.5-.5a2 2 0 1 0-.001 3.999A2 2 0 0 0 5.5 3.5Z\"></path>\n</svg>\n</template>\n\n<template id=\"project-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-project\">\n    <path d=\"M1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25V1.75C0 .784.784 0 1.75 0ZM1.5 1.75v12.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25ZM11.75 3a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-1.5 0v-7.5a.75.75 0 0 1 .75-.75Zm-8.25.75a.75.75 0 0 1 1.5 0v5.5a.75.75 0 0 1-1.5 0ZM8 3a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 3Z\"></path>\n</svg>\n</template>\n\n<template id=\"pencil-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-pencil\">\n    <path d=\"M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z\"></path>\n</svg>\n</template>\n\n<template id=\"copilot-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-copilot\">\n    <path d=\"M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z\"></path><path d=\"M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z\"></path>\n</svg>\n</template>\n\n<template id=\"copilot-error-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-copilot-error\">\n    <path d=\"M16 11.24c0 .112-.072.274-.21.467L13 9.688V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-.198 0-.388-.009-.571-.029L6.833 5.226a4.01 4.01 0 0 0 .17-.782c.117-.935-.037-1.395-.241-1.614-.193-.206-.637-.413-1.682-.297-.683.076-1.115.231-1.395.415l-1.257-.91c.579-.564 1.413-.877 2.485-.996 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095Zm-5.083-8.707c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Zm2.511 11.074c-1.393.776-3.272 1.428-5.43 1.428-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.18-.455-.241-.963-.252-1.475L.31 4.107A.747.747 0 0 1 0 3.509V3.49a.748.748 0 0 1 .625-.73c.156-.026.306.047.435.139l14.667 10.578a.592.592 0 0 1 .227.264.752.752 0 0 1 .046.249v.022a.75.75 0 0 1-1.19.596Zm-1.367-.991L5.635 7.964a5.128 5.128 0 0 1-.889.073c-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433 1.539 0 3.089-.505 4.063-.934Z\"></path>\n</svg>\n</template>\n\n<template id=\"workflow-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-workflow\">\n    <path d=\"M0 1.75C0 .784.784 0 1.75 0h3.5C6.216 0 7 .784 7 1.75v3.5A1.75 1.75 0 0 1 5.25 7H4v4a1 1 0 0 0 1 1h4v-1.25C9 9.784 9.784 9 10.75 9h3.5c.966 0 1.75.784 1.75 1.75v3.5A1.75 1.75 0 0 1 14.25 16h-3.5A1.75 1.75 0 0 1 9 14.25v-.75H5A2.5 2.5 0 0 1 2.5 11V7h-.75A1.75 1.75 0 0 1 0 5.25Zm1.75-.25a.25.25 0 0 0-.25.25v3.5c0 .138.112.25.25.25h3.5a.25.25 0 0 0 .25-.25v-3.5a.25.25 0 0 0-.25-.25Zm9 9a.25.25 0 0 0-.25.25v3.5c0 .138.112.25.25.25h3.5a.25.25 0 0 0 .25-.25v-3.5a.25.25 0 0 0-.25-.25Z\"></path>\n</svg>\n</template>\n\n<template id=\"book-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-book\">\n    <path d=\"M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z\"></path>\n</svg>\n</template>\n\n<template id=\"code-review-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-code-review\">\n    <path d=\"M1.75 1h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 13H8.061l-2.574 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25v-8.5C0 1.784.784 1 1.75 1ZM1.5 2.75v8.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25Zm5.28 1.72a.75.75 0 0 1 0 1.06L5.31 7l1.47 1.47a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-2-2a.75.75 0 0 1 0-1.06l2-2a.75.75 0 0 1 1.06 0Zm2.44 0a.75.75 0 0 1 1.06 0l2 2a.75.75 0 0 1 0 1.06l-2 2a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L10.69 7 9.22 5.53a.75.75 0 0 1 0-1.06Z\"></path>\n</svg>\n</template>\n\n<template id=\"codespaces-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-codespaces\">\n    <path d=\"M0 11.25c0-.966.784-1.75 1.75-1.75h12.5c.966 0 1.75.784 1.75 1.75v3A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25Zm2-9.5C2 .784 2.784 0 3.75 0h8.5C13.216 0 14 .784 14 1.75v5a1.75 1.75 0 0 1-1.75 1.75h-8.5A1.75 1.75 0 0 1 2 6.75Zm1.75-.25a.25.25 0 0 0-.25.25v5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-5a.25.25 0 0 0-.25-.25Zm-2 9.5a.25.25 0 0 0-.25.25v3c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-3a.25.25 0 0 0-.25-.25Z\"></path><path d=\"M7 12.75a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Zm-4 0a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1-.75-.75Z\"></path>\n</svg>\n</template>\n\n<template id=\"comment-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-comment\">\n    <path d=\"M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z\"></path>\n</svg>\n</template>\n\n<template id=\"comment-discussion-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-comment-discussion\">\n    <path d=\"M1.75 1h8.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 10.25 10H7.061l-2.574 2.573A1.458 1.458 0 0 1 2 11.543V10h-.25A1.75 1.75 0 0 1 0 8.25v-5.5C0 1.784.784 1 1.75 1ZM1.5 2.75v5.5c0 .138.112.25.25.25h1a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h3.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Zm13 2a.25.25 0 0 0-.25-.25h-.5a.75.75 0 0 1 0-1.5h.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 14.25 12H14v1.543a1.458 1.458 0 0 1-2.487 1.03L9.22 12.28a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l2.22 2.22v-2.19a.75.75 0 0 1 .75-.75h1a.25.25 0 0 0 .25-.25Z\"></path>\n</svg>\n</template>\n\n<template id=\"organization-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-organization\">\n    <path d=\"M1.75 16A1.75 1.75 0 0 1 0 14.25V1.75C0 .784.784 0 1.75 0h8.5C11.216 0 12 .784 12 1.75v12.5c0 .085-.006.168-.018.25h2.268a.25.25 0 0 0 .25-.25V8.285a.25.25 0 0 0-.111-.208l-1.055-.703a.749.749 0 1 1 .832-1.248l1.055.703c.487.325.779.871.779 1.456v5.965A1.75 1.75 0 0 1 14.25 16h-3.5a.766.766 0 0 1-.197-.026c-.099.017-.2.026-.303.026h-3a.75.75 0 0 1-.75-.75V14h-1v1.25a.75.75 0 0 1-.75.75Zm-.25-1.75c0 .138.112.25.25.25H4v-1.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 .75.75v1.25h2.25a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25ZM3.75 6h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5ZM3 3.75A.75.75 0 0 1 3.75 3h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 3 3.75Zm4 3A.75.75 0 0 1 7.75 6h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 7 6.75ZM7.75 3h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5ZM3 9.75A.75.75 0 0 1 3.75 9h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 3 9.75ZM7.75 9h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5Z\"></path>\n</svg>\n</template>\n\n<template id=\"rocket-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-rocket\">\n    <path d=\"M14.064 0h.186C15.216 0 16 .784 16 1.75v.186a8.752 8.752 0 0 1-2.564 6.186l-.458.459c-.314.314-.641.616-.979.904v3.207c0 .608-.315 1.172-.833 1.49l-2.774 1.707a.749.749 0 0 1-1.11-.418l-.954-3.102a1.214 1.214 0 0 1-.145-.125L3.754 9.816a1.218 1.218 0 0 1-.124-.145L.528 8.717a.749.749 0 0 1-.418-1.11l1.71-2.774A1.748 1.748 0 0 1 3.31 4h3.204c.288-.338.59-.665.904-.979l.459-.458A8.749 8.749 0 0 1 14.064 0ZM8.938 3.623h-.002l-.458.458c-.76.76-1.437 1.598-2.02 2.5l-1.5 2.317 2.143 2.143 2.317-1.5c.902-.583 1.74-1.26 2.499-2.02l.459-.458a7.25 7.25 0 0 0 2.123-5.127V1.75a.25.25 0 0 0-.25-.25h-.186a7.249 7.249 0 0 0-5.125 2.123ZM3.56 14.56c-.732.732-2.334 1.045-3.005 1.148a.234.234 0 0 1-.201-.064.234.234 0 0 1-.064-.201c.103-.671.416-2.273 1.15-3.003a1.502 1.502 0 1 1 2.12 2.12Zm6.94-3.935c-.088.06-.177.118-.266.175l-2.35 1.521.548 1.783 1.949-1.2a.25.25 0 0 0 .119-.213ZM3.678 8.116 5.2 5.766c.058-.09.117-.178.176-.266H3.309a.25.25 0 0 0-.213.119l-1.2 1.95ZM12 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z\"></path>\n</svg>\n</template>\n\n<template id=\"shield-check-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-shield-check\">\n    <path d=\"m8.533.133 5.25 1.68A1.75 1.75 0 0 1 15 3.48V7c0 1.566-.32 3.182-1.303 4.682-.983 1.498-2.585 2.813-5.032 3.855a1.697 1.697 0 0 1-1.33 0c-2.447-1.042-4.049-2.357-5.032-3.855C1.32 10.182 1 8.566 1 7V3.48a1.75 1.75 0 0 1 1.217-1.667l5.25-1.68a1.748 1.748 0 0 1 1.066 0Zm-.61 1.429.001.001-5.25 1.68a.251.251 0 0 0-.174.237V7c0 1.36.275 2.666 1.057 3.859.784 1.194 2.121 2.342 4.366 3.298a.196.196 0 0 0 .154 0c2.245-.957 3.582-2.103 4.366-3.297C13.225 9.666 13.5 8.358 13.5 7V3.48a.25.25 0 0 0-.174-.238l-5.25-1.68a.25.25 0 0 0-.153 0ZM11.28 6.28l-3.5 3.5a.75.75 0 0 1-1.06 0l-1.5-1.5a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l.97.97 2.97-2.97a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z\"></path>\n</svg>\n</template>\n\n<template id=\"heart-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-heart\">\n    <path d=\"m8 14.25.345.666a.75.75 0 0 1-.69 0l-.008-.004-.018-.01a7.152 7.152 0 0 1-.31-.17 22.055 22.055 0 0 1-3.434-2.414C2.045 10.731 0 8.35 0 5.5 0 2.836 2.086 1 4.25 1 5.797 1 7.153 1.802 8 3.02 8.847 1.802 10.203 1 11.75 1 13.914 1 16 2.836 16 5.5c0 2.85-2.045 5.231-3.885 6.818a22.066 22.066 0 0 1-3.744 2.584l-.018.01-.006.003h-.002ZM4.25 2.5c-1.336 0-2.75 1.164-2.75 3 0 2.15 1.58 4.144 3.365 5.682A20.58 20.58 0 0 0 8 13.393a20.58 20.58 0 0 0 3.135-2.211C12.92 9.644 14.5 7.65 14.5 5.5c0-1.836-1.414-3-2.75-3-1.373 0-2.609.986-3.029 2.456a.749.749 0 0 1-1.442 0C6.859 3.486 5.623 2.5 4.25 2.5Z\"></path>\n</svg>\n</template>\n\n<template id=\"server-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-server\">\n    <path d=\"M1.75 1h12.5c.966 0 1.75.784 1.75 1.75v4c0 .372-.116.717-.314 1 .198.283.314.628.314 1v4a1.75 1.75 0 0 1-1.75 1.75H1.75A1.75 1.75 0 0 1 0 12.75v-4c0-.358.109-.707.314-1a1.739 1.739 0 0 1-.314-1v-4C0 1.784.784 1 1.75 1ZM1.5 2.75v4c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-4a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25Zm.25 5.75a.25.25 0 0 0-.25.25v4c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-4a.25.25 0 0 0-.25-.25ZM7 4.75A.75.75 0 0 1 7.75 4h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 7 4.75ZM7.75 10h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM3 4.75A.75.75 0 0 1 3.75 4h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 3 4.75ZM3.75 10h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5Z\"></path>\n</svg>\n</template>\n\n<template id=\"globe-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-globe\">\n    <path d=\"M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM5.78 8.75a9.64 9.64 0 0 0 1.363 4.177c.255.426.542.832.857 1.215.245-.296.551-.705.857-1.215A9.64 9.64 0 0 0 10.22 8.75Zm4.44-1.5a9.64 9.64 0 0 0-1.363-4.177c-.307-.51-.612-.919-.857-1.215a9.927 9.927 0 0 0-.857 1.215A9.64 9.64 0 0 0 5.78 7.25Zm-5.944 1.5H1.543a6.507 6.507 0 0 0 4.666 5.5c-.123-.181-.24-.365-.352-.552-.715-1.192-1.437-2.874-1.581-4.948Zm-2.733-1.5h2.733c.144-2.074.866-3.756 1.58-4.948.12-.197.237-.381.353-.552a6.507 6.507 0 0 0-4.666 5.5Zm10.181 1.5c-.144 2.074-.866 3.756-1.58 4.948-.12.197-.237.381-.353.552a6.507 6.507 0 0 0 4.666-5.5Zm2.733-1.5a6.507 6.507 0 0 0-4.666-5.5c.123.181.24.365.353.552.714 1.192 1.436 2.874 1.58 4.948Z\"></path>\n</svg>\n</template>\n\n<template id=\"issue-opened-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-issue-opened\">\n    <path d=\"M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z\"></path><path d=\"M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z\"></path>\n</svg>\n</template>\n\n<template id=\"device-mobile-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-device-mobile\">\n    <path d=\"M3.75 0h8.5C13.216 0 14 .784 14 1.75v12.5A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25V1.75C2 .784 2.784 0 3.75 0ZM3.5 1.75v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25ZM8 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z\"></path>\n</svg>\n</template>\n\n<template id=\"package-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-package\">\n    <path d=\"m8.878.392 5.25 3.045c.54.314.872.89.872 1.514v6.098a1.75 1.75 0 0 1-.872 1.514l-5.25 3.045a1.75 1.75 0 0 1-1.756 0l-5.25-3.045A1.75 1.75 0 0 1 1 11.049V4.951c0-.624.332-1.201.872-1.514L7.122.392a1.75 1.75 0 0 1 1.756 0ZM7.875 1.69l-4.63 2.685L8 7.133l4.755-2.758-4.63-2.685a.248.248 0 0 0-.25 0ZM2.5 5.677v5.372c0 .09.047.171.125.216l4.625 2.683V8.432Zm6.25 8.271 4.625-2.683a.25.25 0 0 0 .125-.216V5.677L8.75 8.432Z\"></path>\n</svg>\n</template>\n\n<template id=\"credit-card-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-credit-card\">\n    <path d=\"M10.75 9a.75.75 0 0 0 0 1.5h1.5a.75.75 0 0 0 0-1.5h-1.5Z\"></path><path d=\"M0 3.75C0 2.784.784 2 1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25ZM14.5 6.5h-13v5.75c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25Zm0-2.75a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25V5h13Z\"></path>\n</svg>\n</template>\n\n<template id=\"play-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-play\">\n    <path d=\"M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z\"></path>\n</svg>\n</template>\n\n<template id=\"gift-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-gift\">\n    <path d=\"M2 2.75A2.75 2.75 0 0 1 4.75 0c.983 0 1.873.42 2.57 1.232.268.318.497.668.68 1.042.183-.375.411-.725.68-1.044C9.376.42 10.266 0 11.25 0a2.75 2.75 0 0 1 2.45 4h.55c.966 0 1.75.784 1.75 1.75v2c0 .698-.409 1.301-1 1.582v4.918A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25V9.332C.409 9.05 0 8.448 0 7.75v-2C0 4.784.784 4 1.75 4h.55c-.192-.375-.3-.8-.3-1.25ZM7.25 9.5H2.5v4.75c0 .138.112.25.25.25h4.5Zm1.5 0v5h4.5a.25.25 0 0 0 .25-.25V9.5Zm0-4V8h5.5a.25.25 0 0 0 .25-.25v-2a.25.25 0 0 0-.25-.25Zm-7 0a.25.25 0 0 0-.25.25v2c0 .138.112.25.25.25h5.5V5.5h-5.5Zm3-4a1.25 1.25 0 0 0 0 2.5h2.309c-.233-.818-.542-1.401-.878-1.793-.43-.502-.915-.707-1.431-.707ZM8.941 4h2.309a1.25 1.25 0 0 0 0-2.5c-.516 0-1 .205-1.43.707-.337.392-.646.975-.879 1.793Z\"></path>\n</svg>\n</template>\n\n<template id=\"code-square-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-code-square\">\n    <path d=\"M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25Zm7.47 3.97a.75.75 0 0 1 1.06 0l2 2a.75.75 0 0 1 0 1.06l-2 2a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L10.69 8 9.22 6.53a.75.75 0 0 1 0-1.06ZM6.78 6.53 5.31 8l1.47 1.47a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215l-2-2a.75.75 0 0 1 0-1.06l2-2a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z\"></path>\n</svg>\n</template>\n\n<template id=\"device-desktop-icon\">\n  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-device-desktop\">\n    <path d=\"M14.25 1c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 14.25 12h-3.727c.099 1.041.52 1.872 1.292 2.757A.752.752 0 0 1 11.25 16h-6.5a.75.75 0 0 1-.565-1.243c.772-.885 1.192-1.716 1.292-2.757H1.75A1.75 1.75 0 0 1 0 10.25v-7.5C0 1.784.784 1 1.75 1ZM1.75 2.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25ZM9.018 12H6.982a5.72 5.72 0 0 1-.765 2.5h3.566a5.72 5.72 0 0 1-.765-2.5Z\"></path>\n</svg>\n</template>\n\n        <div class=\"position-relative\">\n                        <ul\n              role=\"listbox\"\n              class=\"ActionListWrap QueryBuilder-ListWrap\"\n              aria-label=\"Suggestions\"\n              data-action=\"\n                combobox-commit:query-builder#comboboxCommit\n                mousedown:query-builder#resultsMousedown\n              \"\n              data-target=\"query-builder.resultsList\"\n              data-persist-list=false\n              id=\"query-builder-test-results\"\n              tabindex=\"-1\"\n            ></ul>\n\n        </div>\n      <div class=\"FormControl-inlineValidation\" id=\"validation-a679f44d-bf14-44f2-9e0e-acb8d4623360\" hidden=\"hidden\">\n        <span class=\"FormControl-inlineValidation--visual\">\n          <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"12\" viewBox=\"0 0 12 12\" version=\"1.1\" width=\"12\" data-view-component=\"true\" class=\"octicon octicon-alert-fill\">\n    <path d=\"M4.855.708c.5-.896 1.79-.896 2.29 0l4.675 8.351a1.312 1.312 0 0 1-1.146 1.954H1.33A1.313 1.313 0 0 1 .183 9.058ZM7 7V3H5v4Zm-1 3a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z\"></path>\n</svg>\n        </span>\n        <span></span>\n</div>    </div>\n    <div data-target=\"query-builder.screenReaderFeedback\" aria-live=\"polite\" aria-atomic=\"true\" class=\"sr-only\"></div>\n</query-builder></form>\n          <div class=\"d-flex flex-row color-fg-muted tmp-px-3 text-small color-bg-default search-feedback-prompt\">\n            <a target=\"_blank\" href=\"https://docs.github.com/search-github/github-code-search/understanding-github-code-search-syntax\" data-view-component=\"true\" class=\"Link color-fg-accent text-normal ml-2 tmp-ml-2\">Search syntax tips</a>            <div class=\"d-flex flex-1\"></div>\n          </div>\n        </div>\n</div>\n\n    </div>\n</modal-dialog></div>\n  </div>\n  <div data-action=\"click:qbsearch-input#retract\" class=\"dark-backdrop position-fixed\" hidden data-target=\"qbsearch-input.darkBackdrop\"></div>\n  <div class=\"color-fg-default\">\n    \n<dialog-helper>\n  <dialog data-target=\"qbsearch-input.feedbackDialog\" data-action=\"close:qbsearch-input#handleDialogClose cancel:qbsearch-input#handleDialogClose\" id=\"feedback-dialog\" aria-modal=\"true\" aria-labelledby=\"feedback-dialog-title\" aria-describedby=\"feedback-dialog-description\" data-view-component=\"true\" class=\"Overlay Overlay-whenNarrow Overlay--size-medium Overlay--motion-scaleFade Overlay--disableScroll\">\n    <div data-view-component=\"true\" class=\"Overlay-header\">\n  <div class=\"Overlay-headerContentWrap\">\n    <div class=\"Overlay-titleWrap\">\n      <h1 class=\"Overlay-title \" id=\"feedback-dialog-title\">\n        Provide feedback\n      </h1>\n        \n    </div>\n    <div class=\"Overlay-actionWrap\">\n      <button data-close-dialog-id=\"feedback-dialog\" aria-label=\"Close\" aria-label=\"Close\" type=\"button\" data-view-component=\"true\" class=\"close-button Overlay-closeButton\"><svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-x\">\n    <path d=\"M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z\"></path>\n</svg></button>\n    </div>\n  </div>\n  \n</div>\n      <scrollable-region data-labelled-by=\"feedback-dialog-title\">\n        <div data-view-component=\"true\" class=\"Overlay-body\">        <!-- '\"` --><!-- </textarea></xmp> --></option></form><form id=\"code-search-feedback-form\" data-turbo=\"false\" action=\"/search/feedback\" accept-charset=\"UTF-8\" method=\"post\"><input type=\"hidden\" data-csrf=\"true\" name=\"authenticity_token\" value=\"dlXsxZ+loWWsWxyyj1oSGF9SVh9Qa92nbhAo+MOjxtZIJPejnFb1dro6yXc5Jv30TZkwAuoVIHdJETyWO7ldwQ==\" />\n          <p>We read every piece of feedback, and take your input very seriously.</p>\n          <textarea name=\"feedback\" class=\"form-control width-full mb-2\" style=\"height: 120px\" id=\"feedback\"></textarea>\n          <input name=\"include_email\" id=\"include_email\" aria-label=\"Include my email address so I can be contacted\" class=\"form-control mr-2\" type=\"checkbox\">\n          <label for=\"include_email\" style=\"font-weight: normal\">Include my email address so I can be contacted</label>\n</form></div>\n      </scrollable-region>\n      <div data-view-component=\"true\" class=\"Overlay-footer Overlay-footer--alignEnd\">          <button data-close-dialog-id=\"feedback-dialog\" type=\"button\" data-view-component=\"true\" class=\"btn\">    Cancel\n</button>\n          <button form=\"code-search-feedback-form\" data-action=\"click:qbsearch-input#submitFeedback\" type=\"submit\" data-view-component=\"true\" class=\"btn-primary btn\">    Submit feedback\n</button>\n</div>\n</dialog></dialog-helper>\n\n    <custom-scopes data-target=\"qbsearch-input.customScopesManager\">\n    \n<dialog-helper>\n  <dialog data-target=\"custom-scopes.customScopesModalDialog\" data-action=\"close:qbsearch-input#handleDialogClose cancel:qbsearch-input#handleDialogClose\" id=\"custom-scopes-dialog\" aria-modal=\"true\" aria-labelledby=\"custom-scopes-dialog-title\" aria-describedby=\"custom-scopes-dialog-description\" data-view-component=\"true\" class=\"Overlay Overlay-whenNarrow Overlay--size-medium Overlay--motion-scaleFade Overlay--disableScroll\">\n    <div data-view-component=\"true\" class=\"Overlay-header Overlay-header--divided\">\n  <div class=\"Overlay-headerContentWrap\">\n    <div class=\"Overlay-titleWrap\">\n      <h1 class=\"Overlay-title \" id=\"custom-scopes-dialog-title\">\n        Saved searches\n      </h1>\n        <h2 id=\"custom-scopes-dialog-description\" class=\"Overlay-description\">Use saved searches to filter your results more quickly</h2>\n    </div>\n    <div class=\"Overlay-actionWrap\">\n      <button data-close-dialog-id=\"custom-scopes-dialog\" aria-label=\"Close\" aria-label=\"Close\" type=\"button\" data-view-component=\"true\" class=\"close-button Overlay-closeButton\"><svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-x\">\n    <path d=\"M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z\"></path>\n</svg></button>\n    </div>\n  </div>\n  \n</div>\n      <scrollable-region data-labelled-by=\"custom-scopes-dialog-title\">\n        <div data-view-component=\"true\" class=\"Overlay-body\">        <div data-target=\"custom-scopes.customScopesModalDialogFlash\"></div>\n\n        <div hidden class=\"create-custom-scope-form\" data-target=\"custom-scopes.createCustomScopeForm\">\n        <!-- '\"` --><!-- </textarea></xmp> --></option></form><form id=\"custom-scopes-dialog-form\" data-turbo=\"false\" action=\"/search/custom_scopes\" accept-charset=\"UTF-8\" method=\"post\"><input type=\"hidden\" data-csrf=\"true\" name=\"authenticity_token\" value=\"Zxr31blAlNbcnFzMWSj9a4Z+3bp58KO+9aOaVvPKwVqnFR60jb7fcclKC9DSQutXVjVyVAutL/25WVbw65CC9Q==\" />\n          <div data-target=\"custom-scopes.customScopesModalDialogFlash\"></div>\n\n          <input type=\"hidden\" id=\"custom_scope_id\" name=\"custom_scope_id\" data-target=\"custom-scopes.customScopesIdField\">\n\n          <div class=\"form-group\">\n            <label for=\"custom_scope_name\">Name</label>\n            <auto-check src=\"/search/custom_scopes/check_name\" required>\n              <input\n                type=\"text\"\n                name=\"custom_scope_name\"\n                id=\"custom_scope_name\"\n                data-target=\"custom-scopes.customScopesNameField\"\n                class=\"form-control\"\n                autocomplete=\"off\"\n                placeholder=\"github-ruby\"\n                required\n                maxlength=\"50\">\n              <input type=\"hidden\" data-csrf=\"true\" value=\"IG21qOmfgE2/S/5IKrCDtaOF6+NRyDJQnQuuY5kUxLT1mp53D3DtY3yJye+y1H4wMpZHDPz5W0TvBSwQu2qcDA==\" />\n            </auto-check>\n          </div>\n\n          <div class=\"form-group\">\n            <label for=\"custom_scope_query\">Query</label>\n            <input\n              type=\"text\"\n              name=\"custom_scope_query\"\n              id=\"custom_scope_query\"\n              data-target=\"custom-scopes.customScopesQueryField\"\n              class=\"form-control\"\n              autocomplete=\"off\"\n              placeholder=\"(repo:mona/a OR repo:mona/b) AND lang:python\"\n              required\n              maxlength=\"500\">\n          </div>\n\n          <p class=\"text-small color-fg-muted\">\n            To see all available qualifiers, see our <a class=\"Link--inTextBlock\" href=\"https://docs.github.com/search-github/github-code-search/understanding-github-code-search-syntax\">documentation</a>.\n          </p>\n</form>        </div>\n\n        <div data-target=\"custom-scopes.manageCustomScopesForm\">\n          <div data-target=\"custom-scopes.list\"></div>\n        </div>\n\n</div>\n      </scrollable-region>\n      <div data-view-component=\"true\" class=\"Overlay-footer Overlay-footer--alignEnd Overlay-footer--divided\">          <button data-action=\"click:custom-scopes#customScopesCancel\" type=\"button\" data-view-component=\"true\" class=\"btn\">    Cancel\n</button>\n          <button form=\"custom-scopes-dialog-form\" data-action=\"click:custom-scopes#customScopesSubmit\" data-target=\"custom-scopes.customScopesSubmitButton\" type=\"submit\" data-view-component=\"true\" class=\"btn-primary btn\">    Create saved search\n</button>\n</div>\n</dialog></dialog-helper>\n    </custom-scopes>\n  </div>\n</qbsearch-input>\n\n\n            <div class=\"position-relative HeaderMenu-link-wrap d-lg-inline-block\">\n              <a\n                href=\"/login?return_to=https%3A%2F%2Fgithub.com%2Fnicobailon%2Fzerobox\"\n                class=\"HeaderMenu-link HeaderMenu-link--sign-in HeaderMenu-button flex-shrink-0 no-underline d-none d-lg-inline-flex border border-lg-0 rounded px-2 py-1\"\n                style=\"margin-left: 12px;\"\n                data-hydro-click=\"{&quot;event_type&quot;:&quot;authentication.click&quot;,&quot;payload&quot;:{&quot;location_in_page&quot;:&quot;site header menu&quot;,&quot;repository_id&quot;:null,&quot;auth_type&quot;:&quot;SIGN_UP&quot;,&quot;originating_url&quot;:&quot;https://github.com/nicobailon/zerobox&quot;,&quot;user_id&quot;:null}}\" data-hydro-click-hmac=\"e1613288ed18b0e410bf2f4c8eaf0e8c29cb3b6067007ea05bbda0df28c64637\"\n                data-analytics-event=\"{&quot;category&quot;:&quot;Marketing nav&quot;,&quot;action&quot;:&quot;click to go to homepage&quot;,&quot;label&quot;:&quot;ref_page:Marketing;ref_cta:Sign in;ref_loc:Header&quot;}\"\n              >\n                Sign in\n              </a>\n                <div style=\"right: -30%; background-color: transparent; border: none\" data-view-component=\"true\" class=\"auth-form-body Popover position-absolute d-none d-sm-none d-md-none d-lg-block\">\n  <div style=\"width: 300px\" data-view-component=\"true\" class=\"Popover-message Box Popover-message--top-right color-fg-default p-4 tmp-p-4 mt-2 tmp-mt-2 mx-auto tmp-mx-auto text-left\">\n    <h4 data-view-component=\"true\" class=\"color-fg-default mb-2 tmp-mb-2\">                    Sign in to GitHub\n</h4>\n                        \n<!-- '\"` --><!-- </textarea></xmp> --></option></form><form data-turbo=\"false\" action=\"/session\" accept-charset=\"UTF-8\" method=\"post\"><input type=\"hidden\" data-csrf=\"true\" name=\"authenticity_token\" value=\"IjlyCyic/z0+8LhlpE/67dfz64Lv/RTU+4wmViAo8FJl3PyvxvvZCy5xhQ3f8tQULcLboS40Ct6/wooy1it7lg==\" />  <input type=\"hidden\" name=\"add_account\" id=\"add_account\" autocomplete=\"off\" class=\"form-control\" />\n\n    <label for=\"login_field\">\n      Username or email address\n    </label>\n    <input type=\"text\" name=\"login\" id=\"login_field\" class=\"form-control input-block js-login-field\" autocapitalize=\"off\" autocorrect=\"off\" autocomplete=\"username\" autofocus=\"autofocus\" required=\"required\" />\n\n  <div class=\"position-relative\">\n    <label for=\"password\">\n      Password\n    </label>\n    <input type=\"password\" name=\"password\" id=\"password\" class=\"form-control form-control input-block js-password-field\" autocomplete=\"current-password\" required=\"required\" />\n    <a class=\"label-link position-absolute top-0 right-0\" id=\"forgot-password\" href=\"/password_reset\">Forgot password?</a>\n    \n<input type=\"hidden\" name=\"webauthn-conditional\" value=\"undefined\">\n<input type=\"hidden\" class=\"js-support\" name=\"javascript-support\" value=\"unknown\">\n<input type=\"hidden\" class=\"js-webauthn-support\" name=\"webauthn-support\" value=\"unknown\">\n<input type=\"hidden\" class=\"js-webauthn-iuvpaa-support\" name=\"webauthn-iuvpaa-support\" value=\"unknown\">\n<input type=\"hidden\" name=\"return_to\" id=\"return_to\" value=\"https://github.com/nicobailon/zerobox\" autocomplete=\"off\" class=\"form-control\" />\n<input type=\"hidden\" name=\"allow_signup\" id=\"allow_signup\" autocomplete=\"off\" class=\"form-control\" />\n<input type=\"hidden\" name=\"client_id\" id=\"client_id\" autocomplete=\"off\" class=\"form-control\" />\n<input type=\"hidden\" name=\"integration\" id=\"integration\" autocomplete=\"off\" class=\"form-control\" />\n<input class=\"form-control\" type=\"text\" name=\"required_field_9304\" hidden=\"hidden\" />\n<input class=\"form-control\" type=\"hidden\" name=\"timestamp\" value=\"1778625789607\" />\n<input class=\"form-control\" type=\"hidden\" name=\"timestamp_secret\" value=\"3cdbd0a4560f08ae260d253e502002b66e79e15aa58de11b78aadc0041915c70\" />\n\n\n    <input type=\"submit\" name=\"commit\" value=\"Sign in\" class=\"btn btn-primary btn-block js-sign-in-button\" data-disable-with=\"Signing in…\" data-signin-label=\"Sign in\" data-sso-label=\"Sign in with your identity provider\" development=\"false\" disable-emu-sso=\"false\" />\n  </div>\n</form>  <webauthn-status class=\"js-webauthn-login-emu-control\">\n        <div data-target=\"webauthn-status.partial\" class=\"d-flex flex-justify-between flex-column tmp-mt-3 mb-0\" hidden>\n          <a href=\"/login?return_to=https%3A%2F%2Fgithub.com%2Fnicobailon%2Fzerobox\" data-analytics-event=\"{&quot;category&quot;:&quot;passkey_404_login&quot;,&quot;action&quot;:&quot;clicked&quot;,&quot;label&quot;:null}\" data-view-component=\"true\" class=\"Button--link Button--medium Button\">  <span class=\"Button-content\">\n    <span class=\"Button-label\">or continue with other methods</span>\n  </span>\n</a>\n        </div>\n  </webauthn-status>\n\n\n</div></div>            </div>\n\n              <a href=\"/signup?ref_cta=Sign+up&amp;ref_loc=header+logged+out&amp;ref_page=%2Fnicobailon%2Fzerobox&amp;source=header\"\n                class=\"HeaderMenu-link HeaderMenu-link--sign-up HeaderMenu-button flex-shrink-0 d-flex d-lg-inline-flex no-underline border color-border-default rounded px-2 py-1\"\n                data-hydro-click=\"{&quot;event_type&quot;:&quot;authentication.click&quot;,&quot;payload&quot;:{&quot;location_in_page&quot;:&quot;site header menu&quot;,&quot;repository_id&quot;:null,&quot;auth_type&quot;:&quot;SIGN_UP&quot;,&quot;originating_url&quot;:&quot;https://github.com/nicobailon/zerobox&quot;,&quot;user_id&quot;:null}}\" data-hydro-click-hmac=\"e1613288ed18b0e410bf2f4c8eaf0e8c29cb3b6067007ea05bbda0df28c64637\"\n                data-analytics-event=\"{&quot;category&quot;:&quot;Sign up&quot;,&quot;action&quot;:&quot;click to sign up for account&quot;,&quot;label&quot;:&quot;ref_page:/nicobailon/zerobox;ref_cta:Sign up;ref_loc:header logged out&quot;}\"\n              >\n                Sign up\n              </a>\n\n                <div class=\"AppHeader-appearanceSettings\">\n    <react-partial-anchor>\n      <button data-target=\"react-partial-anchor.anchor\" id=\"icon-button-2037a8c3-9f8f-4d46-bc48-3fe09a7936cd\" aria-labelledby=\"tooltip-536ac3d5-9c7a-4d70-be79-052c44a313bb\" type=\"button\" disabled=\"disabled\" data-view-component=\"true\" class=\"Button Button--iconOnly Button--invisible Button--medium AppHeader-button HeaderMenu-link border cursor-wait\">  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-sliders Button-visual\">\n    <path d=\"M15 2.75a.75.75 0 0 1-.75.75h-4a.75.75 0 0 1 0-1.5h4a.75.75 0 0 1 .75.75Zm-8.5.75v1.25a.75.75 0 0 0 1.5 0v-4a.75.75 0 0 0-1.5 0V2H1.75a.75.75 0 0 0 0 1.5H6.5Zm1.25 5.25a.75.75 0 0 0 0-1.5h-6a.75.75 0 0 0 0 1.5h6ZM15 8a.75.75 0 0 1-.75.75H11.5V10a.75.75 0 1 1-1.5 0V6a.75.75 0 0 1 1.5 0v1.25h2.75A.75.75 0 0 1 15 8Zm-9 5.25v-2a.75.75 0 0 0-1.5 0v1.25H1.75a.75.75 0 0 0 0 1.5H4.5v1.25a.75.75 0 0 0 1.5 0v-2Zm9 0a.75.75 0 0 1-.75.75h-6a.75.75 0 0 1 0-1.5h6a.75.75 0 0 1 .75.75Z\"></path>\n</svg>\n</button><tool-tip id=\"tooltip-536ac3d5-9c7a-4d70-be79-052c44a313bb\" for=\"icon-button-2037a8c3-9f8f-4d46-bc48-3fe09a7936cd\" popover=\"manual\" data-direction=\"s\" data-type=\"label\" data-view-component=\"true\" class=\"sr-only position-absolute\">Appearance settings</tool-tip>\n\n      <template data-target=\"react-partial-anchor.template\">\n        <link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/primer-react-css.feac881557adad02.module.css\" />\n<link crossorigin=\"anonymous\" media=\"all\" rel=\"stylesheet\" href=\"https://github.githubassets.com/assets/appearance-settings.92e55a4ebdaa3c2e.module.css\" />\n\n<react-partial\n  partial-name=\"appearance-settings\"\n  data-ssr=\"false\"\n  data-attempted-ssr=\"false\"\n  data-react-profiling=\"false\"\n>\n  \n  <script type=\"application/json\" data-target=\"react-partial.embeddedData\">{\"props\":{}}</script>\n  <div data-target=\"react-partial.reactRoot\"></div>\n</react-partial>\n\n\n      </template>\n    </react-partial-anchor>\n  </div>\n\n          <button type=\"button\" class=\"sr-only js-header-menu-focus-trap d-block d-lg-none\">Resetting focus</button>\n        </div>\n      </div>\n    </div>\n  </div>\n</header>\n\n      <div hidden=\"hidden\" data-view-component=\"true\" class=\"js-stale-session-flash stale-session-flash flash flash-warn flash-full\">\n  \n        <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-alert\">\n    <path d=\"M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z\"></path>\n</svg>\n        <span class=\"js-stale-session-flash-signed-in\" hidden>You signed in with another tab or window. <a class=\"Link--inTextBlock\" href=\"\">Reload</a> to refresh your session.</span>\n        <span class=\"js-stale-session-flash-signed-out\" hidden>You signed out in another tab or window. <a class=\"Link--inTextBlock\" href=\"\">Reload</a> to refresh your session.</span>\n        <span class=\"js-stale-session-flash-switched\" hidden>You switched accounts on another tab or window. <a class=\"Link--inTextBlock\" href=\"\">Reload</a> to refresh your session.</span>\n\n    <button id=\"icon-button-74aa4113-69d8-4c23-8d25-d6b6d77775f9\" aria-labelledby=\"tooltip-22846674-6522-4ae8-8ead-6dd6ac494665\" type=\"button\" data-view-component=\"true\" class=\"Button Button--iconOnly Button--invisible Button--medium flash-close js-flash-close\">  <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-x Button-visual\">\n    <path d=\"M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z\"></path>\n</svg>\n</button><tool-tip id=\"tooltip-22846674-6522-4ae8-8ead-6dd6ac494665\" for=\"icon-button-74aa4113-69d8-4c23-8d25-d6b6d77775f9\" popover=\"manual\" data-direction=\"s\" data-type=\"label\" data-view-component=\"true\" class=\"sr-only position-absolute\">Dismiss alert</tool-tip>\n\n\n  \n</div>\n    </div>\n\n  <div id=\"start-of-content\" class=\"show-on-focus\"></div>\n\n\n\n\n\n\n\n\n    <div id=\"js-flash-container\" class=\"flash-container\" data-turbo-replace>\n\n\n\n\n  <template class=\"js-flash-template\">\n    \n<div class=\"flash flash-full   {{ className }}\">\n  <div >\n    <button autofocus class=\"flash-close js-flash-close\" type=\"button\" aria-label=\"Dismiss this message\">\n      <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-x\">\n    <path d=\"M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z\"></path>\n</svg>\n    </button>\n    <div aria-atomic=\"true\" role=\"alert\" class=\"js-flash-alert\">\n      \n      <div>{{ message }}</div>\n\n    </div>\n  </div>\n</div>\n  </template>\n</div>\n\n\n    \n\n\n\n\n\n\n  <div\n    class=\"application-main d-flex flex-auto flex-column\"\n    data-commit-hovercards-enabled\n    data-discussion-hovercards-enabled\n    data-issue-and-pr-hovercards-enabled\n    data-project-hovercards-enabled\n  >\n        <main class=\"font-mktg \" >\n    \n\n\n  <div class=\"position-relative\" style=\"z-index: 0; transition: all 0.25s ease-in\">\n    <div class=\"position-absolute overflow-hidden width-full top-0 left-0\" style=\"height: 370px\" data-hpc>\n      <img alt=\"\" class=\"position-absolute\" height=\"415\" width=\"940\" style=\"top: -20px; left: -20px; z-index: 1; width: 110%; height: 425px\"\n      src=\"data:image/jpeg;base64,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\">\n    </div>\n    <div class=\"position-relative d-block my-0 mx-auto overflow-hidden\" style=\"width: 940px; height: 370px; clear: both\">\n      <img alt=\"404 &ldquo;This is not the web page you are looking for&rdquo;\" class=\"position-absolute\" height=\"249\" width=\"271\" style=\"z-index: 10; left: 72px; top: 72px\"\n      src=\"data:image/png;base64,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\">\n\n      <img alt=\"\" class=\"position-absolute\" height=\"230\" width=\"188\" style=\"top: 94px; left: 356px; z-index: 9;\"\n      src=\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALwAAADmCAMAAABYgh8IAAAAA3NCSVQICAjb4U/gAAABgFBMVEX///9SOCxSOjH/wp8AAAD+wJ4ICAhWPjL/7tDMQjj////66834vZuZmZmVcl+bdmN7KCIxIRr39/dUQjpRS0nFQjhKMihptaVQRUEzJyAyIx46KSF8LSdAKyJSOCxUQjqcincQEBBSOjFSOjHzp4tSOCz/xqZSOjFkTEBUQjpSOjG7qJP/+PQpHhpSOjFSOjH87+jz4cRqUURDMSlTSURQRUFUQjr/1r//0bAaEg9UQjqHZFL/59nOTENTSURSOCyNfGojGhddV0wpKSnGl3yWlJKUh3d4YlM5OTkQEBDez7fLvKWdj4hzW0xIQj/05+bbp4nWZlZTSURTSURSOjFSOjHo17yMgn5+bFwZLSlWPjL358v/4sL5w6XWxKyJcmF3VkYhFxIzMzP86MynnIi1jHRXmYwhISEYGBhSOCwICAj50rvehn+SblqRMClWPjIICAgAAACLZWJAa2I2XVRRS0kQEBBUQjpLOC/xt5blqqWvhnBNh3spRD4ICAhWPjKmNNozAAAAgHRSTlMA////////////////////////RBH///8i///////uZv//d4j/3f+q/1WZ////Zrv/////IjN3////M////zPM//8RM/////8RiP////8R////EUTM7v////+7/////////yL/////RGa73f////+q7u7///8id5mq//////+q7kFCNkwAAAAJcEhZcwAACxIAAAsSAdLdfvwAAAAcdEVYdFNvZnR3YXJlAEFkb2JlIEZpcmV3b3JrcyBDUzQGstOgAAAgAElEQVR4nMVdh0PUyBo32U2C7gLC0vvCozcBQREbFlTUs/feFfXOe/q84on/+pv2lZkkm6x3nCNuSzL5zTe/r8zMl2TXrsTSNrny2/z8+PBgZX/yDv9e6Tp6rXKongMGPV0i+TI+eXWngGWUrsmpGxrGt2u5DxrxfIPel3++d2ywbQcxJpa2ym8DHit5hV9B6JGvP/q+P145saNgrdJWmcKeV/LzvBs5xXfds4togUDvfRv5l/hf+c3Xvc763/NWch3b5bFjtOhNB3jjR3cY965dhzTN7aJ0L5fo57CxrPHw4Vh+zfke5ILnvoNZ/+BH3mSeGqboCHV8RE2R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\">\n\n      <img alt=\"\" class=\"position-absolute\" height=\"156\" width=\"440\" style=\"top: 150px; left: 432px; z-index: 8;\"\n      src=\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAbgAAACcCAMAAAA6Xk4VAAAAA3NCSVQICAjb4U/gAAADAFBMVEX///9NmcCTfmuUe2OQd2KMdWGGcFqEbVqEa1JNmcCbhGucf2ibhGucf2iUe2NHhaiQd2KfinFJm8ajhWubhGucf2iDeW2Qd2KBdmuMclqKbllzYExJm8ajhWubhGucf2iMclqKbllJnctEnMubhGucf2icfWKQd2JChaxJnctEnMujhWubhGuegWWcf2iQd2KjhWubhGuegWWcf2iUe2OMclqKbllIodGjhWubhGuegWWUe2OMclpEpNdBoNOnimujhWuegWWUe2M8iriMclpsWkhDp92ljXOnimujhWulhGSegWWcfWKUe2M4i76VeF2Uc1mMclqOb1NCq+FDp92tjXCnimujhWulhGQyi8WMclpPrdxLrN1Cq+FAquM9quM/qOOvkG87peCtjXCtjGunimuqh2o2n9ujhWurhGSlhGQ2ltKcfWIvktAvjs0yi8Uqi8sticWUc1mTcVRpUkJkUUFardVTrdhPqNSvkG+yj3CtjGutiWenimuqh2qrhGSegWWcfWIyi8UxiL+Uc1m9poq9pIa1nYJgrdNirNBardVqqsezmn2wmX5aqtCVnZWtlXq0k3NapMxTps+sk3a0kW6yj3CvkG+zjmymkXZTositjGuljXNSncOtiWdQm7+nimuqh2qfinFNmcCrhGSchnOjhWtQlrx5jpGlhGSbhGuUhHWegWWmfmGcf2iMgniVgW2ifF2cfWKTfmtIjrVCjLSceluUe2ODfnhAiLeVeF2PemR6enqQd2I7h7qZdFlChayUc1mMdWE6hbZ0eXw6g6+TcVSMclqOb1M6gKaGcFpqdX2KblmMa1OEbVphc4GEa1JecX+EaE4yeaKDZk98aFSDZEwxdJ5RbYF5ZFJ7YkswcJZ1YU9DaoN5XklzYEwubJN0XEkpapM5ZYFzWUNsWkhrV0MzYX8tX35pUkJoUj5kUUEpXH1jTzxgTj9hTDpbSjpRQjZSQjNMPzNLPDFHOS1CODBENyxANCs9NC86MCo3LSgwKSktJycvJyUrJCR/7i4wAAABAHRSTlMAEREREREREREiIiIzMzMzM0REREREREREREREVVVVVVVVZmZmZmZmZnd3d3d3d3eIiIiIiIiImZmZmZmZqqqqqqqqqqqqu7u7u7u7u7u7u7u7u8zMzMzMzMzM3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d7u7u7u7u7u7u7u7u7u7u////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////WBVVlgAAAAlwSFlzAAALEgAACxIB0t1+/AAAABx0RVh0U29mdHdhcmUAQWRvYmUgRmlyZXdvcmtzIENTNAay06AAACAASURBVHic7Z0LYFtl2ce7DS8MxsdgE0VwoOxTUWFsMHCICKKuXJSbOoG0xSGKjG0OAbmo3NwYKDbYnKWkBjsGmtoOEyXIGNRUvrVOOktpCy2jI5hmTbuypDljY03p97z39z3nJM2lJIPmaZqce855f+f/XN5zkpSUHBB20OzZcxacsuCURaWlpYtgYPbsaYXepaKlsumfWHBO6Q9+5LKyH5R+fkah969oZptx0jnf/YUlMcl+fsHcQu9n0bhNnbOg9Ae14zEjtsFz57kfKPQOFw10tmB8mQmr9SC788wiuoLa1LnnZAANDGPzBNpfWHV4ofd98tqMLy7JCBrj9kI0FtP1gYWF3v9JaVPnlv48U2rUTwZjcV2P6/Ho8YU+iMlns865PXNqLpcbc9P1WDyO4A1/vNDHMcns89ZF2viGuLWD2PS9+/fpMdBcoY9kUtmcLFykAOcHXvrIWCIxsgcGvlbog5lEdkrW2LDgQroO3MbGRscSe8BZFvpoJo/NzZ4binB+SEv2AbWxxNjY28CwKLk82fTMqjbFUErZAwEOmCFLjAG43YU+oMlipdlzQ56yfliPv4X8JLb9QK6YWObFDsuBGwLXoseGEwkc4ZC7LPrKfNlXcuCGQtx2Pb4HgCVGsbsc3avrNxX6kCaH3ZEjuKGYvo85SnjZH48VS7l82Cdy4IZzk1h8+O3RUUINnOXIcFz/cKEPajLYolzAbYBiIK7H9icgn0wkcIwbgRq8mJ3kwc7PBRy6mhOP6YgbqQbAYvF4MTvJg2XbR8nAtUH5jZJKym5sbE8xrcyLZd9LScC1AzhwkaOjOMSNjo3u0eM/LfRBTQbLodsEg+vS43Ge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\">\n\n      <img alt=\"\" class=\"position-absolute\" height=\"49\" width=\"166\" style=\"  top: 297px; left: 371px; z-index: 7;\"\n      src=\"data:image/png;base64,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\">\n\n      <img alt=\"\" class=\"position-absolute\" height=\"75\" width=\"430\" style=\"top: 263px; left: 442px; z-index: 6;\"\n      src=\"data:image/png;base64,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\">\n\n      <img alt=\"\" class=\"position-absolute\" height=\"123\" width=\"304\" style=\"top: 73px; left: 467px; z-index: 5;\"\n      src=\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAATAAAAB7CAMAAADEzSzaAAAAA3NCSVQICAjb4U/gAAABgFBMVEX////jyZz02KW2pHvdxZu2pYLny5fv1qWFel7Vu4OlmnasnHuyn3uKfmLexZbVvpSEe2Lkx5Ts27LSuIXGs4vFsIrZxJbs0aLPvJO6p4Pp2rHlzZ3WvY3Puo7dy6DayaHOtoTdwZJuaFvJsn6llXPw1KC2o3fWxZ3ErYSomnuekm/HsoSekm+AdmKomnucjm3OtYvn17GcjnOllXO6p4PKsIjSuIt7c2O8rIWEfGmSh3ONg2V1cGGUinTt0Jydk3FzbGHPuo7kz6GJf2vn1q3q1aTfz6majnm2pHuyn3u2pYKyn3vPuo7s0aLOtYvSwJm8rIW3lXKllXq9q4ndxZvVvpTexZbPuo7SuIXErYR7c2N1cGGEe2Komnu2pYLPvJPGs4vWvY3OuJF8dWmNgmxybFuOhHG6p4OsnHvOuJGsnHuEe2LFrn3Gs4vHsoTFsIq6p4O2pYLKsIi2pYLZxJa2pYLayaHZxJbGs4usnHvbv4+vnHalkG6Jf2t/eWx8dWl0XqRGAAAAgHRSTlMA////////////////////////////////////////////Ebv//3f//////0Qid////yJE7v//Iu4iRP8iRP//Ecz/M////yJ3d4iqu8zd////d4iqu+7u7u4RESJEmarM3f8iMzNEVXeImZmqu7u7u7vMzN3d7u7u7v///xEREdqVUEYAAAAJcEhZcwAACxIAAAsSAdLdfvwAAAAcdEVYdFNvZnR3YXJlAEFkb2JlIEZpcmV3b3JrcyBDUzQGstOgAAAUrUlEQVR4nO1dC0MTVxbeMDNOrGQmEUgIECCKiooFQeUhKj62iI+uimhti692pbi2dq2P2tb2r+99nce9MwNJVIJdDiTzzGTuN9/5znfvjPiPf2z7+Pe+dp/BpxX/Pv2fdp/CpxU7gDUZO4A1GTuANRk7gDUZT07/cnvo9cr6artP5BOJtdeX9vZdGhw6NPhyB7LN4931vX17+/okYkODhx7sOLJN4i+Jl4pLg4NDg0PnF9p9Rts7Fgy/+jRiIi8ftPuUtnesH9+rEZOTQYnY0Fq7z2k7x+LxvX0Csr3HJWp7Lw0NHRoafL0jY9mxLsXreB+8SYINDu2Uyux4LRX/eN/x4zovv5BJObijYpmx8IWKQxD/UvGm3ae1bePi08ePe3sfPybAulXcmm/3mW3XWJRqL0OL/t4vhNsXsaP6WfFOar4qkyr6vhhS5rXdp7WNQzvWPqn4ErEhJfor7T6rbRy3dbeoT7PskmCXiMvtPqttHIt3Z5TH1zEzMyg59le7z2o7xy9vtdxL1C69eiUB+z+0YdPz383N3bpy5cr98zoevXn08MWLhw9/ui9WXvlhbm563lTCp2+PHzd49Q2+fSU0//Wf7T35LYz5i3O37j+/G0d+f6VDRtjB48DZXRhRVB+4++LZlan/vtWeQiA2OHRCMOz/omO07+Ktpz//GkccJwOWnIQIXMhBU3G087UwX+VyLMOrHvrb4zU9d+vqr7FfQR6FOA0JrpBtrRBmJQlYKe7VEfd61d7z7W7Qx4yLt652x9EFCw787WAQhrANaHdWoyXiZOeuOFZoife/M2ACrIlyP4fK0qzQAszBTsVZSMldKht7dUr2lkuPlifb3bgPHfuePP017udcCm3NSgAU2pwzeta/q37y9z9u1no1XDIl47JK1UfLs+1u5AeLfWeu1nJJTiUByQi248mbN2/+cWS8psCSqHUKhmEdvbb2d+iDP7ka51JajyJFW0KiV8j3gfew4+bN04X8kZFir4JLMcyLJ4apgpYeLX3amE3/cLcfWstSzyWXpV8mKuKH5tTPqT/y+XxxZCSv89GkpGDdKHMdpfOff7KYzT3MIQqivTL6ReT6c34uJ19+VI5UlCO/XC7ruahsVkLoRbG2HAjA8gKwWFVImZJC9Cfyp/+4eaokgjAba3fTW4mlN/0CHwmMbLIvMRLRryGrXKiYCCmIUqF0aWpZr9O7VTqL+aICTOdjr7IVE8V8/vTRU8OnZAyI+O23en3gpzPtbn9z8c1yJLC5YPBI2CqeiEzVcE0Y0hqmYrWiYljR1Ejlw+JuSbvCyM0Bya1SVBcx8NvAwKlfr3w6qfnnAxuVkL071ssW/zQzwXePC5CSvdqIqZQUwiYgu+l0oXaV6j99324kGop3t1MkPcNNhIldWekMk+j1/y4B0/oV665Rt8IrXywMu4gJzO5OtRuNTWPxtp12YXrbQw5kAsTUaqpz2veUhvVqJ2YYJqM4kARMxN3tXTQnb3dYqmOlmpuShAq5e7dbae+hZvqrWvBlpawSYL/b3NqFRXPgh4V2w5IVbjK6TU7jXjqV0uYRN/HR/khrWPWGAWw8JSExTt1qNzKp8fU6B4L71DCRYkki4b58x1QgYXJB+Lme7nJt/PffR+tZWBme3d2GLmMtgz1pTU/tSbpkSoxksJTlH+/nyNBsyVodfbnNKubi9fTWZ9gEzsMUkBvpmBNuLmCpHCvF97eR+v+1niLpYeKdVQIqAwypkP264G7ke23ASjQtWeu3T16udTjhjEMkYHTUyAEomYwuQno33HIgya9SGudKPy+0GyoZ39zOUpctI91ZO/scqrE124Fkqy4TnIqXZk5dsnQkwnJkYUeY2mmi7S5CmXJWv9JuvNabYUImXpScIa1J8NHJVXbIswTJZqC9aKv2/+kUx7TIqn7ppTAMzS9hmVkzQ/iEULHG483F9uG1aLEjzSWkN3dz2xBativ1cxbdeN6B4Ce1TC9GbTP+a851phzMUqWNANpwU5iGG7v1e5ZgKSVdrFUNBKL324OXK18diZalAoayllYO4ICpRyES84xVrwMN6FeJoHveDrxuu21JX3A0jFdGO5+zInTdRkjAIeQVCYaViClwsU1tkH4u96HTPJsPDd8xSlsbgpYxxBhUuGojZqVh+OUWI7ZwvdlC1kikpGiDClnZMCPbj9jC9Q5KlA6SnSyrGtqk2SBrM3HM3k0i2IyvAMS2ErDrvAEWPDZWYWqXKdl6W8SdLXiERFbTlx5wiFRyZ0rJQZ8tfO5nJdU2WLMND2dZZc9dkbgMWR3O/mTelZKosXk5ebZVeD1IRSixziZEkhfpaLt11D50aukISfNT1KrE/YS9fWlr8FpHIbYqYoe72EAkiLXhAbK7TWGGTm3izUpbMnixukGr2pWXZwGeJvOy9M3Hx+vrClxecEJ4uZM4JnxTYtOG4xjpkTQpYRZem8ajjw/YS6t1WUmZDVuWlr1Pya1YQKXKlbMdN35o4X83OTm5qF+Lk4vi94Fsc0UzrFLpqByoHBChHsRRs+q9olao1WrxQn9FPsqjHncSczrUXL96Bkr9Vvpz6ske9StftdHRHvEjQ75P1B7XMmLipIjukypO1QbskMu12sApNVeDdXUTv93/PBHvo2x39GNKfs43z3TpiHxc9tWPnvi+fu7LLOtdc7552MlsMQc0G9VCBBvMjvow3YHneYH6kVMvCAI9xRVqRi8Faqv5AG40n8C9vIAtsb0DOKaa/vc9CIbt81ljJTBq2WeIqXb6gK0Fp8+OksshmrA/Ak1IqjU90HYLMY8BEcDqgBqtNuoVgKjBxuyl8fVclIMAVgTV1gFbVW2LWEuoPZxjRAzebp+v83MMKAMX4seZitET2KzwGIUYgzRAQcBJ4xAOYCJsGMSGuMA08V79rmXA1oEu2A5fE0yuiNgm4gjSiNCVOZcjUvo+7acTUrOW4apePYxc1CTOEVxDOzE+JvKP75FIVITe86pzLQO2AnQyVMEkguTEzNITBydb5wBgH5IR3hFwHzMeGBZQ4zBlHBCRVQRMgGARDCiGsArz0OPfIH+qrY9h3wGQGHlyvM0cH2sf1nYHSVUHUOsiJzMRUl8CZlOBpU1gsQbzLyDZI9AshNkmyErYkaZXW8XrXRIqyB4f1Rp2iajZFgcpB/FgzgJlNV0LsTDqMXVnOHgWmYxied2xLN39Fy5c+Oc/L3Q2EPxI+iIgA1+1CtiaaVwE4sPUzKIUJi3DgSkV0I3A9sFSRFg+uD9R4I9yDnGSEaEgwcTMKMM++mzz6OTIswoiX9VWBxfXc1bwksj5ZnPFKXdsQddbKrDioxEDk+irdxhFqCzNDizAwEUFVfZ9DQEG/oTlIyxUW/2HSytcWVywInjLgfNkdAIUrKQjAGGGXEYS3NwoShJLQKvIsTZ6XkRXsUGGsXrCDiRVv1Wvf4dzhzkI34fciohqJrkiqKjQfqyrmIc+w5TvAplpIB5lZQ5duOXu0VLIaUx+sZyF0sjIns7OPYeBYWgo0PSaL/m8Nbwm2+hateg341onkKW+ZlghL3/y+UKhoJ/ll289Pd3dAWNYwrWqL2ixc7RGOqRiw56fDSqlF2LF0DS9S8xim4yw143Gen6mPxN0G5H0gWEFCVChWDCPpecVegKvHg2YXX3Rm+mcbA2wdZswKZUfCJdjswllsvZitcBUYF0JCF3gm3/D8hBO5afeHyj2DfgGHwEr5PVvoaiIJkETgHUzwAJ+BTxjOPbsCRZaAmwlu9uSUgkBF2IVdKNA6ejjvsNLNk+w3fBYojAPwS0FcEK+RXhdkGH5okRJZ6aCrICAfbYnNYxHa+0R4shQwE0qn6sV5RVAQIzjCPHEY3XRZh4b2JCAUQ/aUIr8GIxRGNmRrazjeTCG6XTUUibJ1tPd0+2dOzI+vof6Suj/1cEUYC11jiZt7mxFbwg79jKqHrVAZwqPw2ZyGKkxEZfrcVm81ePx8XNHjiit16AVJbkAMK1hafTCY3lPWwFsTZ/7xx6UyMzuwE2UTmb3SauxNHTDIaJYM6xg4MoX1T/fUpBJhgUjR86d27NBdnveL60Atu5zVCR0AJ7VZM4lH6yERa+cb61ixZF9Xm/jV6cKHW2LaC7DaFKN63Ec1+U/6j0iCAYM00ABcErDRkR0BjAyZncc3qNz9DKjIVThIN8+zoB1p40J8gw6NaxfrmZ050j+c+d4RDFMOQmslHnDMFYls21L9VgLgPnAq5yl5BuZc+IeS9yIOGXLIB4cP8A1X2gYXn3o72Wbc7kigotlRL8A1lVqmHYVOiWh8w19Lxy8xi9spXO0SPbbmHs0A1xzyI+B4rMEBcOmIfFpN/soNFyBn5Apye1EABYVRvBxXNBDAGO4kAYwJV0mKw3TGGAeaVZyILKVMrm2NeaBV1ud7UC2qmserBzkK0xrJ+CCQNcoTy6sqB1/gbpGHh6akRgdSwtjiA9QpyJqlaVdDClX5p3sopLgI8c4oFY6A6ROQbTHUCGB0KSJn244ETKu+lUg3WcMs8ByR3dPNA/YSwWUsgNRAoacGeWzeEdo+h8CbDh5yBp39BVKG7ZzFL47AlthOpAF2aPUmFFf0gYbq6RRgObL5DfUCjaqh0yhhjntlaOCPmqWbRrAn1rJrYsCLwZ6n4hreoAMYz7fI0LojXAB2GgF2n2dnXkrJbFA8tEKvara9D9/WH2fm9Y5BiiyDzfZGZgxdBHFVops5AGQJ2VTT4BhEqIi2Vc5dMFsBRNAGmpDvWz6r6tcdrOwdTFKHIgN3WbfRo8Sl52Pr3o4JMaUe8CcETFMewo1WFHEviSlpAbHtsS6s9XZdOfowZbkHfHV50jKtygj7xjpiHt67YTBGzVMm1UYrFCAQUpalhj7XuBWWugc3SE8GFJIgchHs4D+ymxkyYuOAcoHpaXPduYZDx+NYp6CODLKRw0Dt7sU1OXfNeIDiIUC2HxjXhVgR8blaAVLSNIxGGbzmh1D/HoryZRjltfAF/nRRoMULjWUIgVV+Veg6qJHKbuS4wU15Jo3Bsx0xUnDiExYUvg3BtPNAbZKNsHp1WQ8a2OzkTjjs/JqPu4r0Ih8ZO4ZxcoxoQEko/s6aPxZYQjknSN1GHD6haIeyjdjrmpMH2zFZy701gUImu4cXUYgGC6MArSIKWYTxgKOSqCV3yxd2f6GfxHIFk7QUSQNumlnLVLesYwaVtAWjPrfajxM8m+P3XtXs5xhnU12jlYwnSKGFruFhGzzuVTZXUurSjDjQXhnyJ2clAEiZwDxsDWIYQ9lTJTr5Tiu18bH5fAOqL2imevDPrNT/DA/jMrwJjtHdzZvUQpZLCh84JXZEe9hyk10Q5M+bPUVclGaUgX8STAiGIA6qhjm2zdBwL0WdF9S2Ipz546oIerAKilYefVbc52jdzlLV3AkYQuLZgSApIp/ogqofaryTy6X6wOCYefOQfcRiSYLJe8aBUz3vUTRbK5ztIqXH0pji2M0CCISUm/a/GGxOMkwbs2hCFhjNOYBC+p8mxtHaMRkSvbgeBjdC2Z9VQSsqc7ROjSXewnOK1vDk2Q0295jpLaMzosKv2kejVkwF6s2lNX3QJXETIRBnoLVl2QpSCMiWIibK5MrCfXa6JYryRYg5TMq0udhH8tR4Ed4JVWAMfI4t1zZ6IKHKKrOkb5MhmFF6EkWjK0oJAYQvcwht+YesLhjTh1yiz+GZLiTs0I7AaZihoZcwQibRp7JKyO1PDKYAJCzAMlkxhAjlpJF8K/CixXZbbZO9nniL9o6saqZByzeNezHuUtgEm7hyKYGzQhxz7YtdfBcrh/3sMPtcYqp16g6ELvzbYiFOqaqJGmYxyMgLqucbAKwtVbdJiUlFgiGL7MW7Eh2CcZ6EvMhF3SZSbeJQidfVXUEdPr0LIrWsXyRj7hCkmNusuyXx2ri6XN49JDyCaVnS4Z25DRubmjH6JjKDEpJa2gnRcPotkCAagbaWH3SOGArQC5UGdvGEolo5kM/ZRdjnrHbbUzCGLlYoYsZw/J47xsHeqzOt3Vkqi6I4s9TU98fW2gMMGwZEcnpO3LKWcnILYb5HKamhqex++cxFUHkFZkMrAZcfkTU5BGoL6kFrADPo+Rt0bcPx+5EKbJWR7t27+7q6vpq//6Dl6fGvp/dxMm+m5ycWltbW19fP7+y8qbceC75SDzcaJdKFEffvSjEYl8wjCSMyj4jQmounZQf5k8gFtHvqyEeAswhmIxqtXpCxL3Ro8MiugReKsxULAvsLh9slHf7ZicnV9fWlpfXH1w7/7IcWdXzQz+IImZj3rmzPBnhlxjoF2Uy5+csW0EPohStu0ZVFSdmZmaOHj06fHS4a3h4NyCEWCFaFnLyTWIneXes8R7U/Pzk6urq5eXlB9eunZd/3h2KJ2YVKRdLN7YOIaO90abkYoSKOyaQLtJ/rALaCzDAlNYrhp0WMT4+PjLydmbm3r0bXvXGqKQQA6JLTbrMbFcSpi5rxZf79z87eFCQTbCtCcjsWJie/l4guLy8/PzatbsCwTJPMSaKDrPUcvLWUUyJxwyEw6jkrSP5vIDWMImPiBOCP4pAXTYCLn0ALURPwgY7vJAAXT44NjU2e2wzLWs59n03Pz03tbp0ZfnZj9fO1+JYkLCJznscEHcCpshpD1igAM2cuDc8UTtVlSAZ3eF4dNlM6epymQOxf//+KwcPLo2NjR2bbd9/zzI9P31x7sza0tLy8x9/rA30qjT2UeQgMY3dH8BETNp9BU+1+koo0D2pQEKgh5EYu52USglLzrs0QDLDxkQtPPZ12wDaLPZ9Nz175szc0tLSsx+ff1mrDcSghJJ+NV4bg2qgCCQVWifYbrfNkEpdu51UA11ia74yEiQAOja7BX+K4WPF/PT8k7kzt35Yuv/z84c9J17NnHh1T+NjANLMAf50ucg4DCIJAo0em/q2dY3e7jHboNykpZrIsPsHLwsJmjo228qzhJ9k7OOJlrBDFphKoy8fXBNF7Njst+0+8bbFV1k8EhL0k9Jo6Ru/3b4avdWxH/llJEhk2Oy3f1sJev8QJmhMaHS7T6OB+B+C/KOr0h4pdAAAAABJRU5ErkJggg==\">\n\n      <img alt=\"\" class=\"position-absolute\" height=\"50\" width=\"116\" style=\"top: 113px; left: 762px; z-index: 4;\"\n      src=\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHQAAAAyCAMAAAC6RQ9kAAAAA3NCSVQICAjb4U/gAAABgFBMVEX////kyZm1pIDexpr73qqnmnallnGnmnn33aqjlXn12anszpi7p4PUvZPu1aXPuo6tm3zr0aLfxZbNt4xxbWOUim6yn3l7c2NsaF2+rIStm3yom4C2o3v22KSznW+rnIGejGuqlm3ZxJZxbWN0bFvUvZPv0JvnzZ2MfmPArYq7p4PXvo7Qu5LFsoq+rIRsaWDx057ErYKznXCsmnKFe2qom4CPgWSMhG3Qu5Kck3OllnGjlXl7c2NzcGeJf217c2OJf23FsoqUim6+rISck3PArYp/eWl/eGWfknrGsIzArYrGsIyck3PNt4zXvo67p4Pr0aLQu5K7p4Omk2zfxZbZxJbErYL12anu1aWwm2753KfmzaHny5aMg3N/eWmfknqajnmUiXSMhG2Mg3OrnIGjlXmUim6UiXSMhG2EeGN/eGW1pICajHOFe2rGsIy7p4OVhme+rIStm3ynmnmejGuUim6VhmfUvZPQu5LNt4zexprPuo7GsIy7p4Oyn3mmk2w+/MV0AAAAgHRSTlMA////////////////////RP///yJ3/yIR7v9E////RHe7/xEiu///RHfu/////xH/////IjNEVaqqzMwRESIzVXeIu8zdIiIzZmZ3d4iZqru7u7vM3d3u7u7///8RESIiIiIiMzMzMzMzM0RERFVVVWZmZmZmZnd3d4iIiIiIiOmar1cAAAAJcEhZcwAACxIAAAsSAdLdfvwAAAAcdEVYdFNvZnR3YXJlAEFkb2JlIEZpcmV3b3JrcyBDUzQGstOgAAAFzUlEQVRYheWXh3saRxDFvSzHHQsczUEKCFVkiINKFEW25RZFcVwjJFvNTu+99+p/PfNmCwfcxYosf8n3ZcB3gjvv797sm9nl1KlHxNyjbngCMf7U/wU6929Al/5L6X3nq43f5ud/uf3ZpScARXp/GB/68q1fD4IHYXP5TC73em731psnDYXS9dMDX729nVZBmkIpVc4hXr188tCLA9CfAiIqftM/1WwTda90otC5IeilbahkoYAG9Ocyiz1J6JDSNw41Kg0wvRTOTVC3HgvzwcbG7ZJrfoNKLx8qTms6IBxT+cPyY1JvHqgmxrhlPpPSq54rm21WyFyXZDzGGVC/OSby8jYP1KRBdq9Y6Dnvgrn8cwACZRc+4rklU8FXIZv4xvGg20qLeEDUPS576kjnfAN9D5cUpxZYfeJsa6m7x2J+CSIkBCFV/ZaFWqVbSrtI6dwq7SjODc9q7liFc2Dmyzw6EtxP71IjDKkdNFUzRDT5tkDBUUobOLd3VND46urqjQZi6mYYlsvl18oIQbE3T1ERUkiEwEngjIOsdrvdgrQx+yzHt6c5xuil3wlbgBJGEGY0Gk84hP4k+idh+PxnPnWkGIuH2tG0AIvQWAsXRqFRiy+OxkyE2oGlyd+wPP1IfeE6wSeh9B/nmKB5sZjJZjNeDGuh6lPUk6BTFiVdIqWFWqR0avsZZ2g1m6FXDLRYoQuZzEQSVESsaU/mi7JyEepTwE0+VRBaaYFGzmYnYqCyhku11PUE9zrvGJ3WREKG6HFK2TVFVyadU1QrZwGVkENDx0AXAa0nKG1EjCP7J6GhKtrfbc8LSKnQ0BryW4+DVmm2s36yewct5GZXitB2HTR2dEDu8RGoWMTQMU4qigIm1fu7khGuTI179JGgQdgut8t4604VmPQyVEp2UiYOWskiUq8kuFdGKlVEfCpIaaAqvud7nufjQEdu9TCSTm8BRopxUlGIOl3K1BJLpl9+ItJ96HOZUlohlIei8/lsoNLMqcwgRieVoHlUUz1Jqe0xwprWaQ9p/maZCJUsNTBGkk9zekUd/vVjoLKKx/ET5nTAvJFlRDA0XdEwpBYH3hxFoIsYetRJRYnM05Vk90a7jssul0w6PWs1cnY9Lhq4l6GCe1J21EmktMKN49MEaH9FkW4N0U8CaMVmVx8HoHQXehLa3YhS1DDFF/Fz6tqsNGDhHMVQdq5v0F6gTMmY9FbYSSM9qYglAdAXE+bUrcvWSq4Xc3p1Xi03MEp5TnFXHe1hxL7kXrmAJLyUlN74zoD0kqxZrdTTZcolo1Jdo1Swk2JWNygt4HFeToQKl1jhVlL8UQ44vWwi0yK4H0bcK6qZOCeRUvQkkjr8M9Ok15VLZLXWSTbu1Rq1XOx3AzunuJF70oiTihisjiXoagK0vzFxD6C1a/faKuUU87LjoLg51kmYU3EWUmOdVLIrdv9g9i5Up0rXqe/Anu1ITinpyY42wiJG7QEa66TSYOeLFKwQ5XSkI+l5xZIe9N1Lt+f1GjYYVYxyHnMa66RGZF9m59WuqrTKaCMZmb5Lr1OKHouxR5XSZh3GjnXSFEtsi3a7uLCwsNi1WnkRV1hlTHK1YGxbVBTKq/WIk4qcrIvwWJyTplgdpqrKeYn2f1ZqSlRn1+efiYBeM0YSet835KQip60HaJyTuGQkVkkNjW7RsHOoGBsZrdit8Mbsmq5TGe+kIruil9STSvwf006pbUnOSEaibQ7YKFml2m55bB6GnFTkx95BocY5SdcpulvV2s71ClunFurbOe0KuW96r+mx2WEoHmcWNZOdmZ5e61xvRaFLq+/Sr8TzFH/82bt7t/cMx+87O/Qzcffw8HBPNyTdgP2+e/eNUikK3O5qE4iaifxziOrziJWVyZVJxPrMw+mvO5+0YjtjUlz56MOPX6B4//NSo/HdnTvf9zY3N3u9/fX19Xv37k9i6JXJ+zMcF6Y5fux01tY6a51WqzXWcrS/AGShj5noGrZMAAAAAElFTkSuQmCC\">\n    </div>\n  </div>\n\n<div class=\"container-lg tmp-mt-5 tmp-px-3 tmp-pb-5\">\n  <!-- '\"` --><!-- </textarea></xmp> --></option></form><form role=\"search\" data-turbo=\"false\" action=\"/search\" accept-charset=\"UTF-8\" method=\"get\">\n    <label for=\"not-found-search\" class=\"d-block text-normal color-fg-muted mb-1 f4\">Find code, projects, and people on GitHub:</label>\n    <div class=\"d-flex flex-items-center\">\n      <input type=\"text\" name=\"q\" id=\"not-found-search\" class=\"flex-auto input-lg form-control mr-2\">\n        <button type=\"submit\" data-view-component=\"true\" class=\"btn\">    Search\n</button>\n    </div>\n</form>\n    <div class=\"tmp-mt-5 color-fg-muted text-center\">\n      <a href=\"https://support.github.com?tags=dotcom-404\" class=\"Link--secondary\">Contact Support</a> &mdash;\n      <a href=\"https://githubstatus.com\" class=\"Link--secondary\">GitHub Status</a> &mdash;\n      <a href=\"https://x.com/githubstatus\" class=\"Link--secondary\">@githubstatus</a>\n    </div>\n</div>\n\n  </main>\n\n  </div>\n\n              <footer role=\"contentinfo\" class=\"footer tmp-pt-6 position-relative\" data-analytics-visible=\"{&quot;category&quot;:&quot;Footer&quot;,&quot;action&quot;:&quot;visible&quot;,&quot;label&quot;:&quot;text: Marketing footer&quot;}\" >\n  <h2 class=\"sr-only\">Site-wide Links</h2>\n  <div class=\"container-xl p-responsive\">\n    <div class=\"d-flex flex-wrap tmp-py-5 tmp-mb-5\">\n      <section class=\"col-12 col-lg-4 tmp-mb-5 tmp-pr-lg-4\">\n        <a href=\"/\" data-analytics-event=\"{&quot;category&quot;:&quot;Footer&quot;,&quot;action&quot;:&quot;go to home&quot;,&quot;label&quot;:&quot;text:home&quot;}\" class=\"color-fg-default d-inline-block\" aria-label=\"Go to GitHub homepage\">\n          <svg height=\"30\" aria-hidden=\"true\" data-component=\"Octicon\" viewBox=\"0 0 103 24\" version=\"1.1\" width=\"128\" data-view-component=\"true\" class=\"octicon octicon-lockup-github footer-logo-mktg d-block\">\n    <path d=\"M36.472 3.088c4.225 0 6.777 1.805 7.591 4.841l-3.784.902c-.462-1.65-1.783-2.552-3.807-2.552-3.015 0-4.643 1.98-4.643 5.743s1.584 5.787 4.555 5.787c2.502 0 4.079-1.406 4.323-3.829h-4.631v-3.168h8.45v2.002c0 5.26-3.059 8.186-8.208 8.186C31.213 21 28 17.501 28 12.022c0-5.48 3.279-8.934 8.472-8.934M79.62 15.741c0 1.518.682 2.355 1.98 2.355 1.497 0 2.64-1.387 2.64-3.28V8.304h3.5V20.67h-3.5v-2.09c-.66 1.342-2.244 2.31-3.938 2.31-2.707 0-4.181-1.496-4.181-4.225V8.303h3.499z\"></path><path fill-rule=\"evenodd\" d=\"M93.063 10.57C93.775 9.073 95.38 8.017 97 8.017c3.375 0 5.158 2.333 5.039 6.448.119 4.07-1.73 6.425-5.039 6.425-1.686 0-3.226-.968-3.96-2.355v2.135h-3.477V3.418h3.499zm2.706.374c-1.444 0-2.588 1.408-2.707 3.345v.198c.119 2.002 1.263 3.476 2.707 3.476 1.813 0 2.803-1.342 2.685-3.498.118-2.179-.872-3.521-2.685-3.521\"></path><path d=\"M49.323 20.67h-3.477V8.303h3.477zm7.004-12.367h2.575v2.905h-2.575v5.611c0 .682.308.946.99.946h1.585v2.905h-2.839c-2.31 0-3.212-.99-3.212-3.08v-6.382H50.65V8.303h2.2V5.84l3.477-.814zm7.783-4.885v6.998h6.558V3.418h3.74V20.67h-3.74v-6.91H64.11v6.91h-3.74V3.418zM47.584 3c1.167 0 2.069.902 2.069 2.069a2.04 2.04 0 0 1-2.069 2.068 2.04 2.04 0 0 1-2.068-2.068c0-1.167.902-2.069 2.068-2.069M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943\"></path>\n</svg>\n        </a>\n\n        <h3 class=\"h5 tmp-mt-4 mb-0\" id=\"subscribe-to-newsletter\">Subscribe to our developer newsletter</h3>\n        <p class=\"f5 color-fg-muted tmp-mb-3\">Get tips, technical guides, and best practices. Twice a month.</p>\n        <a class=\"btn-mktg tmp-mb-4 btn-muted-mktg\" data-analytics-event=\"{&quot;category&quot;:&quot;Subscribe&quot;,&quot;action&quot;:&quot;click to Subscribe&quot;,&quot;label&quot;:&quot;ref_cta:Subscribe;&quot;}\" href=\"https://github.com/newsletter\">\n  Subscribe\n  \n  \n</a>\n\n      </section>\n\n      <nav class=\"col-6 col-sm-3 col-lg-2 tmp-mb-6 tmp-mb-md-2 tmp-pr-3 tmp-pr-lg-0 tmp-pl-lg-4\" aria-labelledby=\"footer-title-product\">\n        <h3 class=\"h5 tmp-mb-3 text-mono color-fg-muted text-normal\" id=\"footer-title-product\">\n          Platform\n        </h3>\n\n        <ul class=\"list-style-none color-fg-muted f5\">\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;features&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;features_link_platform_footer&quot;}\" href=\"/features\">Features</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;enterprise&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;enterprise_link_platform_footer&quot;}\" href=\"/enterprise\">Enterprise</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;copilot&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;copilot_link_platform_footer&quot;}\" href=\"/features/copilot\">Copilot</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;ai&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;ai_link_platform_footer&quot;}\" href=\"/features/ai\">AI</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;security&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;security_link_platform_footer&quot;}\" href=\"/security\">Security</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;pricing&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;pricing_link_platform_footer&quot;}\" href=\"/pricing\">Pricing</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;team&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;team_link_platform_footer&quot;}\" href=\"/team\">Team</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;resources&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;resources_link_platform_footer&quot;}\" href=\"https://resources.github.com\">Resources</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;roadmap&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;roadmap_link_platform_footer&quot;}\" href=\"https://github.com/github/roadmap\">Roadmap</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;compare&quot;,&quot;context&quot;:&quot;platform&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;compare_link_platform_footer&quot;}\" href=\"/resources/articles/devops-tools-comparison\">Compare GitHub</a>\n          </li>\n        </ul>\n      </nav>\n\n      <nav class=\"col-6 col-sm-3 col-lg-2 tmp-mb-6 tmp-mb-md-2 tmp-pr-3 tmp-pr-md-0 tmp-pl-md-4\" aria-labelledby=\"footer-title-platform\">\n        <h3 class=\"h5 tmp-mb-3 text-mono color-fg-muted text-normal\" id=\"footer-title-platform\">\n          Ecosystem\n        </h3>\n\n        <ul class=\"list-style-none f5\">\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;dev-api&quot;,&quot;context&quot;:&quot;ecosystem&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;dev-api_link_ecosystem_footer&quot;}\" href=\"https://docs.github.com/get-started/exploring-integrations/about-building-integrations\">Developer API</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;partners&quot;,&quot;context&quot;:&quot;ecosystem&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;partners_link_ecosystem_footer&quot;}\" href=\"https://partner.github.com\">Partners</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;edu&quot;,&quot;context&quot;:&quot;ecosystem&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;edu_link_ecosystem_footer&quot;}\" href=\"https://github.com/edu\">Education</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;cli&quot;,&quot;context&quot;:&quot;ecosystem&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;cli_link_ecosystem_footer&quot;}\" href=\"https://cli.github.com\">GitHub CLI</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;desktop&quot;,&quot;context&quot;:&quot;ecosystem&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;desktop_link_ecosystem_footer&quot;}\" href=\"https://desktop.github.com\">GitHub Desktop</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;mobile&quot;,&quot;context&quot;:&quot;ecosystem&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;mobile_link_ecosystem_footer&quot;}\" href=\"https://github.com/mobile\">GitHub Mobile</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;marketplace&quot;,&quot;context&quot;:&quot;ecosystem&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;marketplace_link_ecosystem_footer&quot;}\" href=\"https://github.com/marketplace\">GitHub Marketplace</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;mcp_registry&quot;,&quot;context&quot;:&quot;ecosystem&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;mcp_registry_link_ecosystem_footer&quot;}\" href=\"https://github.com/mcp\">MCP Registry</a>\n          </li>\n        </ul>\n      </nav>\n\n      <nav class=\"col-6 col-sm-3 col-lg-2 tmp-mb-6 tmp-mb-md-2 tmp-pr-3 tmp-pr-md-0 tmp-pl-md-4\" aria-labelledby=\"footer-title-support\">\n        <h3 class=\"h5 tmp-mb-3 text-mono color-fg-muted text-normal\" id=\"footer-title-support\">\n          Support\n        </h3>\n\n        <ul class=\"list-style-none f5\">\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;docs&quot;,&quot;context&quot;:&quot;support&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;docs_link_support_footer&quot;}\" href=\"https://docs.github.com\">Docs</a>\n          </li>\n\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;community&quot;,&quot;context&quot;:&quot;support&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;community_link_support_footer&quot;}\" href=\"https://github.community\">Community Forum</a>\n          </li>\n\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;services&quot;,&quot;context&quot;:&quot;support&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;services_link_support_footer&quot;}\" href=\"https://services.github.com\">Professional Services</a>\n          </li>\n\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;premium_support&quot;,&quot;context&quot;:&quot;support&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;premium_support_link_support_footer&quot;}\" href=\"/enterprise/premium-support\">Premium Support</a>\n          </li>\n\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;skills&quot;,&quot;context&quot;:&quot;support&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;skills_link_support_footer&quot;}\" href=\"https://skills.github.com\">Skills</a>\n          </li>\n\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;status&quot;,&quot;context&quot;:&quot;support&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;status_link_support_footer&quot;}\" href=\"https://www.githubstatus.com\">Status</a>\n          </li>\n\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;contact_github&quot;,&quot;context&quot;:&quot;support&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;contact_github_link_support_footer&quot;}\" href=\"https://support.github.com?tags=dotcom-footer\">Contact GitHub</a>\n          </li>\n        </ul>\n      </nav>\n\n      <nav class=\"col-6 col-sm-3 col-lg-2 tmp-mb-6 tmp-mb-md-2 tmp-pr-3 tmp-pr-md-0 tmp-pl-md-4\" aria-labelledby=\"footer-title-company\">\n        <h3 class=\"h5 tmp-mb-3 text-mono color-fg-muted text-normal\" id=\"footer-title-company\">\n          Company\n        </h3>\n\n        <ul class=\"list-style-none f5\">\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;about&quot;,&quot;context&quot;:&quot;company&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;about_link_company_footer&quot;}\" href=\"https://github.com/about\">About</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;why_github&quot;,&quot;context&quot;:&quot;company&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;why_github_link_company_footer&quot;}\" href=\"https://github.com/why-github\">Why GitHub</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;customer_stories&quot;,&quot;context&quot;:&quot;company&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;customer_stories_link_company_footer&quot;}\" href=\"/customer-stories?type=enterprise\">Customer stories</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;blog&quot;,&quot;context&quot;:&quot;company&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;blog_link_company_footer&quot;}\" href=\"https://github.blog\">Blog</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;readme&quot;,&quot;context&quot;:&quot;company&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;readme_link_company_footer&quot;}\" href=\"/readme\">The ReadME Project</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;careers&quot;,&quot;context&quot;:&quot;company&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;careers_link_company_footer&quot;}\" href=\"https://github.careers\">Careers</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;newsroom&quot;,&quot;context&quot;:&quot;company&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;newsroom_link_company_footer&quot;}\" href=\"/newsroom\">Newsroom</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;inclusion&quot;,&quot;context&quot;:&quot;company&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;inclusion_link_company_footer&quot;}\" href=\"/about/diversity\">Inclusion</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;social_impact&quot;,&quot;context&quot;:&quot;company&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;social_impact_link_company_footer&quot;}\" href=\"https://socialimpact.github.com\">Social Impact</a>\n          </li>\n          <li class=\"lh-condensed tmp-mb-3\">\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;shop&quot;,&quot;context&quot;:&quot;company&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;shop_link_company_footer&quot;}\" href=\"https://shop.github.com\">Shop</a>\n          </li>\n        </ul>\n      </nav>\n    </div>\n  </div>\n\n  <div class=\"color-bg-subtle\">\n    <div class=\"container-xl p-responsive f6 tmp-py-4 d-md-flex flex-justify-between flex-items-center gap-3\">\n      <nav aria-label=\"Legal and Resource Links\">\n        <ul class=\"list-style-none d-flex flex-wrap color-fg-muted gapx-3\">\n          <li>\n            &copy; <time datetime=\"2026\">2026</time> GitHub, Inc.\n          </li>\n\n          <li>\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;terms&quot;,&quot;context&quot;:&quot;subfooter&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;terms_link_subfooter_footer&quot;}\" href=\"https://docs.github.com/site-policy/github-terms/github-terms-of-service\">Terms</a>\n          </li>\n\n          <li>\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;privacy&quot;,&quot;context&quot;:&quot;subfooter&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;privacy_link_subfooter_footer&quot;}\" href=\"https://docs.github.com/site-policy/privacy-policies/github-privacy-statement\">Privacy</a>\n            <a href=\"https://github.com/github/site-policy/pull/582\" class=\"Link--secondary\">(Updated 02/2024)<time datetime=\"2024-02\" class=\"sr-only\">02/2024</time></a>\n          </li>\n\n          <li>\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;sitemap&quot;,&quot;context&quot;:&quot;subfooter&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;sitemap_link_subfooter_footer&quot;}\" href=\"/sitemap\">Sitemap</a>\n          </li>\n\n          <li>\n            <a class=\"Link--secondary\" data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;what_is_git&quot;,&quot;context&quot;:&quot;subfooter&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;what_is_git_link_subfooter_footer&quot;}\" href=\"/git-guides\">What is Git?</a>\n          </li>\n\n            <li >\n  <cookie-consent-link>\n    <button\n      type=\"button\"\n      class=\"Link--secondary underline-on-hover border-0 p-0 color-bg-transparent\"\n      data-action=\"click:cookie-consent-link#showConsentManagement\"\n      data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;cookies&quot;,&quot;context&quot;:&quot;subfooter&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;cookies_link_subfooter_footer&quot;}\"\n    >\n       Manage cookies\n    </button>\n  </cookie-consent-link>\n</li>\n\n<li>\n  <cookie-consent-link>\n    <button\n      type=\"button\"\n      class=\"Link--secondary underline-on-hover border-0 p-0 color-bg-transparent text-left\"\n      data-action=\"click:cookie-consent-link#showConsentManagement\"\n      data-analytics-event=\"{&quot;location&quot;:&quot;footer&quot;,&quot;action&quot;:&quot;dont_share_info&quot;,&quot;context&quot;:&quot;subfooter&quot;,&quot;tag&quot;:&quot;link&quot;,&quot;label&quot;:&quot;dont_share_info_link_subfooter_footer&quot;}\"\n    >\n      Do not share my personal information\n    </button>\n  </cookie-consent-link>\n</li>\n\n        </ul>\n      </nav>\n\n      <nav aria-label=\"GitHub&#39;s Social Media Links\" class=\"footer-social tmp-mt-3 tmp-mt-md-0 d-flex gapx-6 gapy-1 flex-wrap flex-items-center flex-lg-justify-end\">\n        \n<ul class=\"list-style-none d-flex flex-items-center lh-condensed-ultra gap-3\">\n    <li>\n      <a href=\"https://www.linkedin.com/company/github\" class=\"footer-social-icon d-block Link--outlineOffset\" data-analytics-event=\"{&quot;category&quot;:&quot;Footer&quot;,&quot;action&quot;:&quot;go to Linkedin&quot;,&quot;label&quot;:&quot;text:linkedin&quot;}\">\n        <svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 19 18\" aria-hidden=\"true\" class=\"d-block\" width=\"19\" height=\"18\"><path d=\"M3.94 2A2 2 0 1 1 2 0a2 2 0 0 1 1.94 2zM4 5.48H0V18h4zm6.32 0H6.34V18h3.94v-6.57c0-3.66 4.77-4 4.77 0V18H19v-7.93c0-6.17-7.06-5.94-8.72-2.91z\" fill=\"currentColor\"></path></svg>\n        <span class=\"sr-only\">GitHub on LinkedIn</span>\n      </a>\n    </li>\n    <li>\n      <a href=\"https://www.instagram.com/github\" class=\"footer-social-icon d-block Link--outlineOffset\" data-analytics-event=\"{&quot;category&quot;:&quot;Footer&quot;,&quot;action&quot;:&quot;go to Instagram&quot;,&quot;label&quot;:&quot;text:instagram&quot;}\">\n        <svg xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" class=\"d-block\" width=\"18\" height=\"18\"><title>Instagram</title><path d=\"M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z\" fill=\"currentColor\"></path></svg>\n        <span class=\"sr-only\">GitHub on Instagram</span>\n      </a>\n    </li>\n    <li>\n      <a href=\"https://www.youtube.com/github\" class=\"footer-social-icon d-block Link--outlineOffset\" data-analytics-event=\"{&quot;category&quot;:&quot;Footer&quot;,&quot;action&quot;:&quot;go to YouTube&quot;,&quot;label&quot;:&quot;text:youtube&quot;}\">\n        <svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 19.17 13.6\" aria-hidden=\"true\" class=\"d-block\" width=\"23\" height=\"16\"><path d=\"M18.77 2.13A2.4 2.4 0 0 0 17.09.42C15.59 0 9.58 0 9.58 0a57.55 57.55 0 0 0-7.5.4A2.49 2.49 0 0 0 .39 2.13 26.27 26.27 0 0 0 0 6.8a26.15 26.15 0 0 0 .39 4.67 2.43 2.43 0 0 0 1.69 1.71c1.52.42 7.5.42 7.5.42a57.69 57.69 0 0 0 7.51-.4 2.4 2.4 0 0 0 1.68-1.71 25.63 25.63 0 0 0 .4-4.67 24 24 0 0 0-.4-4.69zM7.67 9.71V3.89l5 2.91z\" fill=\"currentColor\"></path></svg>\n        <span class=\"sr-only\">GitHub on YouTube</span>\n      </a>\n    </li>\n    <li>\n      <a href=\"https://x.com/github\" class=\"footer-social-icon d-block Link--outlineOffset\" data-analytics-event=\"{&quot;category&quot;:&quot;Footer&quot;,&quot;action&quot;:&quot;go to X&quot;,&quot;label&quot;:&quot;text:x&quot;}\">\n        <svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1200 1227\" fill=\"currentColor\" aria-hidden=\"true\" class=\"d-block\" width=\"16\" height=\"16\"><path d=\"M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026ZM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026Z\"></path></svg>\n        <span class=\"sr-only\">GitHub on X</span>\n      </a>\n    </li>\n    <li>\n      <a href=\"https://www.tiktok.com/@github\" class=\"footer-social-icon d-block Link--outlineOffset\" data-analytics-event=\"{&quot;category&quot;:&quot;Footer&quot;,&quot;action&quot;:&quot;go to tiktok&quot;,&quot;label&quot;:&quot;text:tiktok&quot;}\">\n        <svg xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" class=\"d-block\" width=\"18\" height=\"18\"><title>TikTok</title><path d=\"M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z\" fill=\"currentColor\"></path></svg>\n        <span class=\"sr-only\">GitHub on TikTok</span>\n      </a>\n    </li>\n    <li>\n      <a href=\"https://www.twitch.tv/github\" class=\"footer-social-icon d-block Link--outlineOffset\" data-analytics-event=\"{&quot;category&quot;:&quot;Footer&quot;,&quot;action&quot;:&quot;go to Twitch&quot;,&quot;label&quot;:&quot;text:twitch&quot;}\">\n        <svg xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" class=\"d-block\" width=\"18\" height=\"18\"><title>Twitch</title><path d=\"M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z\" fill=\"currentColor\"></path></svg>\n        <span class=\"sr-only\">GitHub on Twitch</span>\n      </a>\n    </li>\n    <li>\n      <a href=\"https://github.com/github\" class=\"footer-social-icon d-block Link--outlineOffset\" data-analytics-event=\"{&quot;category&quot;:&quot;Footer&quot;,&quot;action&quot;:&quot;go to github&#39;s org&quot;,&quot;label&quot;:&quot;text:github&quot;}\">\n        <svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" fill=\"currentColor\" height=\"20\" viewBox=\"0 0 98 96\" width=\"20\" aria-hidden=\"true\" class=\"d-block\"><clipPath id=\"a\"><path d=\"m0 0h98v96h-98z\"></path></clipPath><g clip-path=\"url(#a)\"><path d=\"m41.4395 69.3848c-12.6329-1.5313-21.5333-10.6231-21.5333-22.3946 0-4.7851 1.7227-9.9531 4.5938-13.3984-1.2441-3.1582-1.0527-9.8574.3828-12.6328 3.8281-.4785 8.9961 1.5312 12.0586 4.3066 3.6367-1.1484 7.4648-1.7226 12.1543-1.7226s8.5176.5742 11.9629 1.6269c2.9668-2.6797 8.2305-4.6894 12.0586-4.2109 1.3398 2.584 1.5312 9.2832.2871 12.5371 3.0625 3.6367 4.6894 8.5176 4.6894 13.4941 0 11.7715-8.9003 20.6719-21.7246 22.2989 3.2539 2.1054 5.4551 6.6992 5.4551 11.9629v9.9531c0 2.8711 2.3926 4.498 5.2637 3.3496 17.3223-6.6035 30.9121-23.9258 30.9121-45.3633 0-27.084-22.0117-49.19139933-49.0957-49.19139957s-48.90430019 22.10739957-48.90430043 49.19139957c-.00000019 21.2461 13.49410043 38.8555 31.67770043 45.459 2.584.957 5.0723-.7656 5.0723-3.3496v-7.6563c-1.3398.5743-3.0625.9571-4.5938.9571-6.3164 0-10.0488-3.4453-12.7285-9.8575-1.0527-2.5839-2.2011-4.1152-4.4023-4.4023-1.1484-.0957-1.5313-.5742-1.5313-1.1484 0-1.1485 1.9141-2.0098 3.8282-2.0098 2.7754 0 5.1679 1.7227 7.6562 5.2637 1.9141 2.7754 3.9238 4.0195 6.3164 4.0195s3.9238-.8613 6.125-3.0625c1.627-1.627 2.8711-3.0625 4.0196-4.0195z\"></path></g></svg>\n        <span class=\"sr-only\">GitHub’s organization on GitHub</span>\n      </a>\n    </li>\n</ul>\n\n        \n\n<locale-selector>\n  <experimental-action-menu data-anchor-align=\"start\" data-anchor-side=\"outside-bottom\" data-view-component=\"true\" class=\"footer-social-icon\">\n  <button role=\"button\" aria-haspopup=\"true\" aria-controls=\"locale-selector-list\" aria-expanded=\"false\" id=\"locale-selector-text\" type=\"button\" data-view-component=\"true\" class=\"d-flex flex-items-center border-0 color-bg-transparent p-0 locale-trigger Button--secondary Button--medium Button\">  <span class=\"Button-content\">\n    <span class=\"Button-label\"><span class=\"locale-selector-trigger\">\n        <svg height=\"16\" aria-hidden=\"true\" data-component=\"Octicon\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-globe mr-1 color-fg-muted locale-icon\">\n    <path d=\"M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM5.78 8.75a9.64 9.64 0 0 0 1.363 4.177c.255.426.542.832.857 1.215.245-.296.551-.705.857-1.215A9.64 9.64 0 0 0 10.22 8.75Zm4.44-1.5a9.64 9.64 0 0 0-1.363-4.177c-.307-.51-.612-.919-.857-1.215a9.927 9.927 0 0 0-.857 1.215A9.64 9.64 0 0 0 5.78 7.25Zm-5.944 1.5H1.543a6.507 6.507 0 0 0 4.666 5.5c-.123-.181-.24-.365-.352-.552-.715-1.192-1.437-2.874-1.581-4.948Zm-2.733-1.5h2.733c.144-2.074.866-3.756 1.58-4.948.12-.197.237-.381.353-.552a6.507 6.507 0 0 0-4.666 5.5Zm10.181 1.5c-.144 2.074-.866 3.756-1.58 4.948-.12.197-.237.381-.353.552a6.507 6.507 0 0 0 4.666-5.5Zm2.733-1.5a6.507 6.507 0 0 0-4.666-5.5c.123.181.24.365.353.552.714 1.192 1.436 2.874 1.58 4.948Z\"></path>\n</svg>\n        <span class=\"color-fg-muted Link--secondary f6\" lang=\"en-us\">English</span>\n        <span class=\"sr-only\" lang=\"en-US\">Select language</span>\n        <svg height=\"16\" aria-hidden=\"true\" data-component=\"Octicon\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-chevron-down ml-1 color-fg-muted locale-icon\">\n    <path d=\"M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z\"></path>\n</svg>\n      </span></span>\n  </span>\n</button>\n\n  <div class=\"Overlay-backdrop--anchor\" data-menu-overlay>\n    <div class=\"Overlay Overlay-whenNarrow Overlay--height-auto Overlay--width-auto\" hidden>\n      <div class=\"Overlay-body Overlay-body--paddingNone\">\n        <ul class=\"ActionList\" id=\"locale-selector-list\" role=\"menu\" aria-labelledby=\"locale-selector-text\">\n                <li role=\"none\" data-view-component=\"true\" class=\"ActionList-item\">\n    <a href=\"\" selected=\"selected\" style=\"white-space: normal;\" data-action=\"click:locale-selector#handleSelectLocale\" data-locale=\"en-us\" role=\"menuitem\" tabindex=\"-1\" data-view-component=\"true\" class=\"footer-social-locale ActionList-content\">\n      \n      <span class=\"ActionList-item-label\">\n                <div style=\"width: 16px; display: inline-block; text-align: center; margin-right: 8px; flex-shrink: 0;\">\n          <svg height=\"16\" aria-hidden=\"true\" data-component=\"Octicon\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-check\">\n    <path d=\"M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z\"></path>\n</svg>\n        </div>\n        <span lang=\"en-us\">English</span>\n\n      </span>\n</a></li>\n                <li role=\"none\" data-view-component=\"true\" class=\"ActionList-item\">\n    <a href=\"\" style=\"white-space: normal;\" data-action=\"click:locale-selector#handleSelectLocale\" data-locale=\"pt-br\" role=\"menuitem\" tabindex=\"-1\" data-view-component=\"true\" class=\"footer-social-locale ActionList-content\">\n      \n      <span class=\"ActionList-item-label\">\n                <div style=\"width: 16px; display: inline-block; text-align: center; margin-right: 8px; flex-shrink: 0;\">\n          \n        </div>\n        <span lang=\"pt-br\">Português (Brasil)</span>\n\n      </span>\n</a></li>\n                <li role=\"none\" data-view-component=\"true\" class=\"ActionList-item\">\n    <a href=\"\" style=\"white-space: normal;\" data-action=\"click:locale-selector#handleSelectLocale\" data-locale=\"es-419\" role=\"menuitem\" tabindex=\"-1\" data-view-component=\"true\" class=\"footer-social-locale ActionList-content\">\n      \n      <span class=\"ActionList-item-label\">\n                <div style=\"width: 16px; display: inline-block; text-align: center; margin-right: 8px; flex-shrink: 0;\">\n          \n        </div>\n        <span lang=\"es-419\">Español (América Latina)</span>\n\n      </span>\n</a></li>\n                <li role=\"none\" data-view-component=\"true\" class=\"ActionList-item\">\n    <a href=\"\" style=\"white-space: normal;\" data-action=\"click:locale-selector#handleSelectLocale\" data-locale=\"ja\" role=\"menuitem\" tabindex=\"-1\" data-view-component=\"true\" class=\"footer-social-locale ActionList-content\">\n      \n      <span class=\"ActionList-item-label\">\n                <div style=\"width: 16px; display: inline-block; text-align: center; margin-right: 8px; flex-shrink: 0;\">\n          \n        </div>\n        <span lang=\"ja\">日本語</span>\n\n      </span>\n</a></li>\n                <li role=\"none\" data-view-component=\"true\" class=\"ActionList-item\">\n    <a href=\"\" style=\"white-space: normal;\" data-action=\"click:locale-selector#handleSelectLocale\" data-locale=\"ko-kr\" role=\"menuitem\" tabindex=\"-1\" data-view-component=\"true\" class=\"footer-social-locale ActionList-content\">\n      \n      <span class=\"ActionList-item-label\">\n                <div style=\"width: 16px; display: inline-block; text-align: center; margin-right: 8px; flex-shrink: 0;\">\n          \n        </div>\n        <span lang=\"ko-kr\">한국어</span>\n\n      </span>\n</a></li>\n                <li role=\"none\" data-view-component=\"true\" class=\"ActionList-item\">\n    <a href=\"\" style=\"white-space: normal;\" data-action=\"click:locale-selector#handleSelectLocale\" data-locale=\"fr-fr\" role=\"menuitem\" tabindex=\"-1\" data-view-component=\"true\" class=\"footer-social-locale ActionList-content\">\n      \n      <span class=\"ActionList-item-label\">\n                <div style=\"width: 16px; display: inline-block; text-align: center; margin-right: 8px; flex-shrink: 0;\">\n          \n        </div>\n        <span lang=\"fr-fr\">Français</span>\n\n      </span>\n</a></li>\n                <li role=\"none\" data-view-component=\"true\" class=\"ActionList-item\">\n    <a href=\"\" style=\"white-space: normal;\" data-action=\"click:locale-selector#handleSelectLocale\" data-locale=\"de-de\" role=\"menuitem\" tabindex=\"-1\" data-view-component=\"true\" class=\"footer-social-locale ActionList-content\">\n      \n      <span class=\"ActionList-item-label\">\n                <div style=\"width: 16px; display: inline-block; text-align: center; margin-right: 8px; flex-shrink: 0;\">\n          \n        </div>\n        <span lang=\"de-de\">Deutsch</span>\n\n      </span>\n</a></li>\n        </ul>\n      </div>\n    </div>\n  </div>\n</experimental-action-menu></locale-selector>\n\n      </nav>\n    </div>\n  </div>\n</footer>\n\n\n\n    <ghcc-consent id=\"ghcc\" class=\"position-fixed bottom-0 left-0\" style=\"z-index: 999999\"\n      data-locale=\"en\"\n      data-initial-cookie-consent-allowed=\"\"\n      data-cookie-consent-required=\"false\"\n    ></ghcc-consent>\n\n\n\n\n  <div id=\"ajax-error-message\" class=\"ajax-error-message flash flash-error\" hidden>\n    <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-alert\">\n    <path d=\"M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z\"></path>\n</svg>\n    <button type=\"button\" class=\"flash-close js-ajax-error-dismiss\" aria-label=\"Dismiss error\">\n      <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-x\">\n    <path d=\"M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z\"></path>\n</svg>\n    </button>\n    You can’t perform that action at this time.\n  </div>\n\n    <template id=\"site-details-dialog\">\n  <details class=\"details-reset details-overlay details-overlay-dark lh-default color-fg-default hx_rsm\" open>\n    <summary role=\"button\" aria-label=\"Close dialog\"></summary>\n    <details-dialog class=\"Box Box--overlay d-flex flex-column anim-fade-in fast hx_rsm-dialog hx_rsm-modal\">\n      <button class=\"Box-btn-octicon m-0 btn-octicon position-absolute right-0 top-0\" type=\"button\" aria-label=\"Close dialog\" data-close-dialog>\n        <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-x\">\n    <path d=\"M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z\"></path>\n</svg>\n      </button>\n      <div class=\"octocat-spinner tmp-my-6 js-details-dialog-spinner\"></div>\n    </details-dialog>\n  </details>\n</template>\n\n    <div class=\"Popover js-hovercard-content position-absolute\" style=\"display: none; outline: none;\">\n  <div class=\"Popover-message Popover-message--bottom-left Popover-message--large Box color-shadow-large\" style=\"width:360px;\">\n  </div>\n</div>\n\n    <template id=\"snippet-clipboard-copy-button\">\n  <div class=\"zeroclipboard-container position-absolute right-0 top-0\">\n    <clipboard-copy aria-label=\"Copy code to clipboard\" class=\"ClipboardButton btn js-clipboard-copy m-2 p-0\" data-copy-feedback=\"Copied!\" data-tooltip-direction=\"w\">\n      <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-copy js-clipboard-copy-icon m-2 tmp-m-2\">\n    <path d=\"M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z\"></path><path d=\"M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z\"></path>\n</svg>\n      <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-check js-clipboard-check-icon color-fg-success d-none m-2 tmp-m-2\">\n    <path d=\"M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z\"></path>\n</svg>\n    </clipboard-copy>\n  </div>\n</template>\n<template id=\"snippet-clipboard-copy-button-unpositioned\">\n  <div class=\"zeroclipboard-container\">\n    <clipboard-copy aria-label=\"Copy code to clipboard\" class=\"ClipboardButton btn btn-invisible js-clipboard-copy m-2 p-0 d-flex flex-justify-center flex-items-center\" data-copy-feedback=\"Copied!\" data-tooltip-direction=\"w\">\n      <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-copy js-clipboard-copy-icon\">\n    <path d=\"M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z\"></path><path d=\"M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z\"></path>\n</svg>\n      <svg aria-hidden=\"true\" data-component=\"Octicon\" height=\"16\" viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" data-view-component=\"true\" class=\"octicon octicon-check js-clipboard-check-icon color-fg-success d-none\">\n    <path d=\"M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z\"></path>\n</svg>\n    </clipboard-copy>\n  </div>\n</template>\n\n\n\n\n    </div>\n    <div id=\"js-global-screen-reader-notice\" class=\"sr-only mt-n1\" aria-live=\"polite\" aria-atomic=\"true\" ></div>\n    <div id=\"js-global-screen-reader-notice-assertive\" class=\"sr-only mt-n1\" aria-live=\"assertive\" aria-atomic=\"true\"></div>\n  </body>\n</html>\n\n"

## Assistant

The `nicobailon/zerobox` repo doesn't exist (404). The actual repo is `afshinm/zerobox`. Let me look at the zerobox source code for the error message about `--use-legacy-landlock` and "split sandbox policies":

**Tool Call: Fetch https://raw.githubusercontent.com/afshinm/zerobox/main/crates/zerobox/src/linux\_run.rs**
Status: Failed

status error 404, response: "404: Not Found"

**Tool Call: Fetch https://api.github.com/repos/afshinm/zerobox/contents/crates**
Status: Failed

status error 403, response: "{\"message\":\"API rate limit exceeded for 74.109.221.153. (But here's the good news: Authenticated requests get a higher rate limit. Check out the documentation for more details.)\",\"documentation_url\":\"https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting\"}\n"

## Assistant

Let me search the actual zerobox binary for the error string and look at the Codex upstream source since zerobox is based on OpenAI Codex's sandbox runtime:

**Tool Call: Search files for regex `split sandbox policies|use-legacy-landlock|legacy.landlock`**
Status: Completed

No matches found

## Assistant

The error message `split sandbox policies requiring direct runtime enforcement are incompatible with --use-legacy-landlock` comes from zerobox's Rust binary (which you don't have source for locally). It's based on the OpenAI Codex sandbox runtime. The key source file path in the panic is `upstream/linux-sandbox/src/linux_run_main.rs:395`.

Let me look at the Codex upstream code for this:

**Tool Call: Fetch https://raw.githubusercontent.com/openai/codex/main/codex\-rs/core/linux\-sandbox/src/linux\_run\_main.rs**
Status: Failed

status error 404, response: "404: Not Found"

**Tool Call: Fetch https://github.com/openai/codex**
Status: Completed

Skip to content                                                                         

## Navigation Menu

      Toggle navigation                                                                                                                Sign in                                         Appearance settings                                                                                                                         Search or jump to...                                                      

# Search code, repositories, users, issues, pull requests...

                                                           Search                                                                                                                                             Clear                                                                        

                                                                                  Search syntax tips                                                              

#         Provide feedback       

                                                                   

We read every piece of feedback, and take your input very seriously.                              Include my email address so I can be contacted                          Cancel              Submit feedback                          

#         Saved searches       

        

## Use saved searches to filter your results more quickly

                                                                                                          Name                                                                                    Query                                

            To see all available qualifiers, see our documentation.                                                                       Cancel              Create saved search                                                Sign in                                                         Sign up                                               Appearance settings                      Resetting focus                                                 You signed in with another tab or window. Reload to refresh your session.        You signed out in another tab or window. Reload to refresh your session.        You switched accounts on another tab or window. Reload to refresh your session.          Dismiss alert                                                                                                                                          openai        /    **      codex    **    Public                              
               -                     Notifications    You must be signed in to change notification settings  
  -                   Fork     11.9k  
  -                                   Star          82.1k  

                                                                          

# openai/codex

 mainBranchesTagsGo to fileCodeOpen more actions menu

## Folders and files

| Name | Name | Last commit message | Last commit date |
| --- | --- | --- | --- |
| 

## Latest commit

 

## History

6,408 Commits6,408 Commits |
| .codex | .codex |   |   |
| .devcontainer | .devcontainer |   |   |
| .github | .github |   |   |
| .vscode | .vscode |   |   |
| codex-cli | codex-cli |   |   |
| codex-rs | codex-rs |   |   |
| docs | docs |   |   |
| patches | patches |   |   |
| scripts | scripts |   |   |
| sdk | sdk |   |   |
| third_party | third_party |   |   |
| tools/argument-comment-lint | tools/argument-comment-lint |   |   |
| .bazelignore | .bazelignore |   |   |
| .bazelrc | .bazelrc |   |   |
| .bazelversion | .bazelversion |   |   |
| .codespellignore | .codespellignore |   |   |
| .codespellrc | .codespellrc |   |   |
| .gitattributes | .gitattributes |   |   |
| .gitignore | .gitignore |   |   |
| .markdownlint-cli2.yaml | .markdownlint-cli2.yaml |   |   |
| .npmrc | .npmrc |   |   |
| .prettierignore | .prettierignore |   |   |
| .prettierrc.toml | .prettierrc.toml |   |   |
| AGENTS.md | AGENTS.md |   |   |
| BUILD.bazel | BUILD.bazel |   |   |
| CHANGELOG.md | CHANGELOG.md |   |   |
| LICENSE | LICENSE |   |   |
| MODULE.bazel | MODULE.bazel |   |   |
| MODULE.bazel.lock | MODULE.bazel.lock |   |   |
| NOTICE | NOTICE |   |   |
| README.md | README.md |   |   |
| SECURITY.md | SECURITY.md |   |   |
| announcement_tip.toml | announcement_tip.toml |   |   |
| cliff.toml | cliff.toml |   |   |
| defs.bzl | defs.bzl |   |   |
| flake.lock | flake.lock |   |   |
| flake.nix | flake.nix |   |   |
| justfile | justfile |   |   |
| package.json | package.json |   |   |
| pnpm-lock.yaml | pnpm-lock.yaml |   |   |
| pnpm-workspace.yaml | pnpm-workspace.yaml |   |   |
| rbe.bzl | rbe.bzl |   |   |
| workspace_root_test_launcher.bat.tpl | workspace_root_test_launcher.bat.tpl |   |   |
| workspace_root_test_launcher.sh.tpl | workspace_root_test_launcher.sh.tpl |   |   |
| View all files |

## Repository files navigation

`npm i -g @openai/codex` or `brew install --cask codex`

**Codex CLI** is a coding agent from OpenAI that runs locally on your computer.

  If you want Codex in your code editor (VS Code, Cursor, Windsurf), install in your IDE.If you want the desktop app experience, run `codex app` or visit the Codex App page.If you are looking for the _cloud-based agent_ from OpenAI, **Codex Web**, go to chatgpt.com/codex.

## Quickstart

### Installing and running Codex CLI

Install globally with your preferred package manager:

```
# Install using npm
npm install -g @openai/codex
```

```
# Install using Homebrew
brew install --cask codex
```

Then simply run `codex` to get started.You can also go to the latest GitHub Release and download the appropriate binary for your platform.

Each GitHub Release contains many executables, but in practice, you likely want one of these:
- macOS
- Apple Silicon/arm64: `codex-aarch64-apple-darwin.tar.gz`
- x86_64 (older Mac hardware): `codex-x86_64-apple-darwin.tar.gz`

- Linux
- x86_64: `codex-x86_64-unknown-linux-musl.tar.gz`
- arm64: `codex-aarch64-unknown-linux-musl.tar.gz`

Each archive contains a single entry with the platform baked into the name (e.g., `codex-x86_64-unknown-linux-musl`), so you likely want to rename it to `codex` after extracting it.

### Using Codex with your ChatGPT plan

Run `codex` and select **Sign in with ChatGPT**. We recommend signing into your ChatGPT account to use Codex as part of your Plus, Pro, Business, Edu, or Enterprise plan. Learn more about what's included in your ChatGPT plan.

You can also use Codex with an API key, but this requires additional setup.

## Docs

- **Codex Documentation**
- **Contributing**
- **Installing & building**
- **Open source fund**

This repository is licensed under the Apache-2.0 License.              

## About

      

        Lightweight coding agent that runs in your terminal           

### Resources

                              Readme           

### License

                     Apache-2.0 license           

### Contributing

                              Contributing               

### Security policy

                              Security policy                                           

###         Uh oh!

      

        

There was an error while loading. Please reload this page.

                          Activity                          Custom properties        

### Stars

                      **82.1k**        stars        

### Watchers

                      **464**        watching        

### Forks

                      **11.9k**        forks                        Report repository                                     

##   Releases       784

                            0.130.0                  Latest            May 8, 2026              + 783 releases                                                    

##   Packages       0

                                                                                                                 

###         Uh oh!

      

        

There was an error while loading. Please reload this page.

                                                                           

###         Uh oh!

      

        

There was an error while loading. Please reload this page.

                                            

##     Contributors  

  
      -               
      -               
      -               
  
                          

###         Uh oh!

      

        

There was an error while loading. Please reload this page.

                                         

## Languages

                              
    -                                 Rust          96.1%            
    -                                 Python          2.9%            
    -                                 TypeScript          0.3%            
    -                                 Starlark          0.2%            
    -                                 Shell          0.2%            
    -                                 PowerShell          0.1%            
    -                           Other        0.2%          

                                            

## Footer

                                           © 2026 GitHub, Inc.                                                     You can’t perform that action at this time.

**Tool Call: Fetch https://raw.githubusercontent.com/openai/codex/main/codex\-rs/linux\-sandbox/src/linux\_run\_main.rs**
Status: Completed

use clap::Parser;
use std::ffi::CString;
use std::fmt;
use std::fs;
use std::fs::File;
use std::fs::OpenOptions;
use std::io::Read;
use std::os::fd::AsRawFd;
use std::os::fd::FromRawFd;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::AtomicI32;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;

use crate::bwrap::BwrapNetworkMode;
use crate::bwrap::BwrapOptions;
use crate::bwrap::create_bwrap_command_args;
use crate::landlock::apply_permission_profile_to_current_thread;
use crate::launcher::exec_bwrap;
use crate::launcher::preferred_bwrap_supports_argv0;
use crate::proxy_routing::activate_proxy_routes_in_netns;
use crate::proxy_routing::prepare_host_proxy_route_spec;
use codex_protocol::error::Result as CodexResult;
use codex_protocol::models::PermissionProfile;
use codex_protocol::protocol::FileSystemSandboxPolicy;
use codex_protocol::protocol::NetworkSandboxPolicy;
use codex_sandboxing::landlock::CODEX_LINUX_SANDBOX_ARG0;

static BWRAP_CHILD_PID: AtomicI32 = AtomicI32::new(0);
static PENDING_FORWARDED_SIGNAL: AtomicI32 = AtomicI32::new(0);

const FORWARDED_SIGNALS: &[libc::c_int] =
    &[libc::SIGHUP, libc::SIGINT, libc::SIGQUIT, libc::SIGTERM];
const SYNTHETIC_MOUNT_MARKER_SYNTHETIC: &[u8] = b"synthetic\n";
const SYNTHETIC_MOUNT_MARKER_EXISTING: &[u8] = b"existing\n";
const PROTECTED_CREATE_MARKER: &[u8] = b"protected-create\n";

#[derive(Debug)]
struct SyntheticMountTargetRegistration {
    target: crate::bwrap::SyntheticMountTarget,
    marker_file: PathBuf,
    marker_dir: PathBuf,
}

#[derive(Debug)]
struct ProtectedCreateTargetRegistration {
    target: crate::bwrap::ProtectedCreateTarget,
    marker_file: PathBuf,
    marker_dir: PathBuf,
}

struct ProtectedCreateMonitor {
    stop: Arc<AtomicBool>,
    violation: Arc<AtomicBool>,
    handle: thread::JoinHandle<()>,
}

struct ProtectedCreateWatcher {
    fd: libc::c_int,
    _watches: Vec<libc::c_int>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProtectedCreateRemoval {
    Directory,
    Other,
}

#[derive(Debug, Parser)]
/// CLI surface for the Linux sandbox helper.
///
/// The type name remains `LandlockCommand` for compatibility with existing
/// wiring, but bubblewrap is now the default filesystem sandbox and Landlock
/// is the legacy fallback.
pub struct LandlockCommand {
    /// It is possible that the cwd used in the context of the sandbox policy
    /// is different from the cwd of the process to spawn.
    #[arg(long = "sandbox-policy-cwd")]
    pub sandbox_policy_cwd: PathBuf,

    /// The logical working directory for the command being sandboxed.
    ///
    /// This can intentionally differ from `sandbox_policy_cwd` when the
    /// command runs from a symlinked alias of the policy workspace. Keep it
    /// explicit so bubblewrap can preserve the caller's logical cwd when that
    /// alias would otherwise disappear inside the sandbox namespace.
    #[arg(long = "command-cwd", hide = true)]
    pub command_cwd: Option<PathBuf>,

    /// Canonical runtime permissions for the command.
    #[arg(
        long = "permission-profile",
        hide = true,
        value_parser = parse_permission_profile
    )]
    pub permission_profile: Option<PermissionProfile>,

    /// Opt-in: use the legacy Landlock Linux sandbox fallback.
    ///
    /// When not set, the helper uses the default bubblewrap pipeline.
    #[arg(long = "use-legacy-landlock", hide = true, default_value_t = false)]
    pub use_legacy_landlock: bool,

    /// Internal: apply seccomp and `no_new_privs` in the already-sandboxed
    /// process, then exec the user command.
    ///
    /// This exists so we can run bubblewrap first (which may rely on setuid)
    /// and only tighten with seccomp after the filesystem view is established.
    #[arg(long = "apply-seccomp-then-exec", hide = true, default_value_t = false)]
    pub apply_seccomp_then_exec: bool,

    /// Internal compatibility flag.
    ///
    /// By default, restricted-network sandboxing uses isolated networking.
    /// If set, sandbox setup switches to proxy-only network mode with
    /// managed routing bridges.
    #[arg(long = "allow-network-for-proxy", hide = true, default_value_t = false)]
    pub allow_network_for_proxy: bool,

    /// Internal route spec used for managed proxy routing in bwrap mode.
    #[arg(long = "proxy-route-spec", hide = true)]
    pub proxy_route_spec: Option<String>,

    /// When set, skip mounting a fresh `/proc` even though PID isolation is
    /// still enabled. This is primarily intended for restrictive container
    /// environments that deny `--proc /proc`.
    #[arg(long = "no-proc", default_value_t = false)]
    pub no_proc: bool,

    /// Full command args to run under the Linux sandbox helper.
    #[arg(trailing_var_arg = true)]
    pub command: Vec<String>,
}

/// Entry point for the Linux sandbox helper.
///
/// The sequence is:
/// 1. When needed, wrap the command with bubblewrap to construct the
///    filesystem view.
/// 2. Apply in-process restrictions (no_new_privs + seccomp).
/// 3. `execvp` into the final command.
pub fn run_main() -> ! {
    let LandlockCommand {
        sandbox_policy_cwd,
        command_cwd,
        permission_profile,
        use_legacy_landlock,
        apply_seccomp_then_exec,
        allow_network_for_proxy,
        proxy_route_spec,
        no_proc,
        command,
    } = LandlockCommand::parse();

    if command.is_empty() {
        panic!("No command specified to execute.");
    }
    ensure_inner_stage_mode_is_valid(apply_seccomp_then_exec, use_legacy_landlock);
    let EffectivePermissions {
        permission_profile,
        file_system_sandbox_policy,
        network_sandbox_policy,
    } = resolve_permission_profile(permission_profile).unwrap_or_else(|err| panic!("{err}"));
    ensure_legacy_landlock_mode_supports_policy(
        use_legacy_landlock,
        &file_system_sandbox_policy,
        network_sandbox_policy,
        &sandbox_policy_cwd,
    );

    // Inner stage: apply seccomp/no_new_privs after bubblewrap has already
    // established the filesystem view.
    if apply_seccomp_then_exec {
        if allow_network_for_proxy {
            let spec = proxy_route_spec
                .as_deref()
                .unwrap_or_else(|| panic!("managed proxy mode requires --proxy-route-spec"));
            if let Err(err) = activate_proxy_routes_in_netns(spec) {
                panic!("error activating Linux proxy routing bridge: {err}");
            }
        }
        let proxy_routing_active = allow_network_for_proxy;
        if let Err(e) = apply_permission_profile_to_current_thread(
            &permission_profile,
            &sandbox_policy_cwd,
            /*apply_landlock_fs*/ false,
            allow_network_for_proxy,
            proxy_routing_active,
        ) {
            panic!("error applying Linux sandbox restrictions: {e:?}");
        }
        exec_or_panic(command);
    }

    if file_system_sandbox_policy.has_full_disk_write_access() && !allow_network_for_proxy {
        if let Err(e) = apply_permission_profile_to_current_thread(
            &permission_profile,
            &sandbox_policy_cwd,
            /*apply_landlock_fs*/ false,
            allow_network_for_proxy,
            /*proxy_routed_network*/ false,
        ) {
            panic!("error applying Linux sandbox restrictions: {e:?}");
        }
        exec_or_panic(command);
    }

    if !use_legacy_landlock {
        // Outer stage: bubblewrap first, then re-enter this binary in the
        // sandboxed environment to apply seccomp. This path never falls back
        // to legacy Landlock on failure.
        let proxy_route_spec =
            if allow_network_for_proxy {
                Some(prepare_host_proxy_route_spec().unwrap_or_else(|err| {
                    panic!("failed to prepare host proxy routing bridge: {err}")
                }))
            } else {
                None
            };
        let inner = build_inner_seccomp_command(InnerSeccompCommandArgs {
            sandbox_policy_cwd: &sandbox_policy_cwd,
            command_cwd: command_cwd.as_deref(),
            permission_profile: &permission_profile,
            allow_network_for_proxy,
            proxy_route_spec,
            command,
        });
        run_bwrap_with_proc_fallback(
            &sandbox_policy_cwd,
            command_cwd.as_deref(),
            &file_system_sandbox_policy,
            network_sandbox_policy,
            inner,
            !no_proc,
            allow_network_for_proxy,
        );
    }

    // Legacy path: Landlock enforcement only, when bwrap sandboxing is not enabled.
    if let Err(e) = apply_permission_profile_to_current_thread(
        &permission_profile,
        &sandbox_policy_cwd,
        /*apply_landlock_fs*/ true,
        allow_network_for_proxy,
        /*proxy_routed_network*/ false,
    ) {
        panic!("error applying legacy Linux sandbox restrictions: {e:?}");
    }
    exec_or_panic(command);
}

#[derive(Debug, Clone)]
struct EffectivePermissions {
    permission_profile: PermissionProfile,
    file_system_sandbox_policy: FileSystemSandboxPolicy,
    network_sandbox_policy: NetworkSandboxPolicy,
}

#[derive(Debug, PartialEq, Eq)]
enum ResolvePermissionProfileError {
    MissingConfiguration,
}

impl fmt::Display for ResolvePermissionProfileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingConfiguration => write!(f, "missing permission profile configuration"),
        }
    }
}

fn parse_permission_profile(value: &str) -> std::result::Result<PermissionProfile, String> {
    serde_json::from_str(value).map_err(|err| format!("invalid permission profile JSON: {err}"))
}

fn resolve_permission_profile(
    permission_profile: Option<PermissionProfile>,
) -> Result<EffectivePermissions, ResolvePermissionProfileError> {
    let permission_profile =
        permission_profile.ok_or(ResolvePermissionProfileError::MissingConfiguration)?;
    let (file_system_sandbox_policy, network_sandbox_policy) =
        permission_profile.to_runtime_permissions();
    Ok(EffectivePermissions {
        permission_profile,
        file_system_sandbox_policy,
        network_sandbox_policy,
    })
}

fn ensure_inner_stage_mode_is_valid(apply_seccomp_then_exec: bool, use_legacy_landlock: bool) {
    if apply_seccomp_then_exec && use_legacy_landlock {
        panic!("--apply-seccomp-then-exec is incompatible with --use-legacy-landlock");
    }
}

fn ensure_legacy_landlock_mode_supports_policy(
    use_legacy_landlock: bool,
    file_system_sandbox_policy: &FileSystemSandboxPolicy,
    network_sandbox_policy: NetworkSandboxPolicy,
    sandbox_policy_cwd: &Path,
) {
    if use_legacy_landlock
        && file_system_sandbox_policy
            .needs_direct_runtime_enforcement(network_sandbox_policy, sandbox_policy_cwd)
    {
        panic!(
            "permission profiles requiring direct runtime enforcement are incompatible with --use-legacy-landlock"
        );
    }
}

fn run_bwrap_with_proc_fallback(
    sandbox_policy_cwd: &Path,
    command_cwd: Option<&Path>,
    file_system_sandbox_policy: &FileSystemSandboxPolicy,
    network_sandbox_policy: NetworkSandboxPolicy,
    inner: Vec<String>,
    mount_proc: bool,
    allow_network_for_proxy: bool,
) -> ! {
    let network_mode = bwrap_network_mode(network_sandbox_policy, allow_network_for_proxy);
    let mut mount_proc = mount_proc;
    let command_cwd = command_cwd.unwrap_or(sandbox_policy_cwd);

    if mount_proc
        && !preflight_proc_mount_support(
            sandbox_policy_cwd,
            command_cwd,
            file_system_sandbox_policy,
            network_mode,
        )
        .unwrap_or_else(|err| exit_with_bwrap_build_error(err))
    {
        // Keep the retry silent so sandbox-internal diagnostics do not leak into the
        // child process stderr stream.
        mount_proc = false;
    }

    let options = BwrapOptions {
        mount_proc,
        network_mode,
        ..Default::default()
    };
    let mut bwrap_args = build_bwrap_argv(
        inner,
        file_system_sandbox_policy,
        sandbox_policy_cwd,
        command_cwd,
        options,
    )
    .unwrap_or_else(|err| exit_with_bwrap_build_error(err));
    apply_inner_command_argv0(&mut bwrap_args.args);
    run_or_exec_bwrap(bwrap_args);
}

fn bwrap_network_mode(
    network_sandbox_policy: NetworkSandboxPolicy,
    allow_network_for_proxy: bool,
) -> BwrapNetworkMode {
    if allow_network_for_proxy {
        BwrapNetworkMode::ProxyOnly
    } else if network_sandbox_policy.is_enabled() {
        BwrapNetworkMode::FullAccess
    } else {
        BwrapNetworkMode::Isolated
    }
}

fn build_bwrap_argv(
    inner: Vec<String>,
    file_system_sandbox_policy: &FileSystemSandboxPolicy,
    sandbox_policy_cwd: &Path,
    command_cwd: &Path,
    options: BwrapOptions,
) -> CodexResult<crate::bwrap::BwrapArgs> {
    let bwrap_args = create_bwrap_command_args(
        inner,
        file_system_sandbox_policy,
        sandbox_policy_cwd,
        command_cwd,
        options,
    )?;

    let mut argv = vec!["bwrap".to_string()];
    argv.extend(bwrap_args.args);
    Ok(crate::bwrap::BwrapArgs {
        args: argv,
        preserved_files: bwrap_args.preserved_files,
        synthetic_mount_targets: bwrap_args.synthetic_mount_targets,
        protected_create_targets: bwrap_args.protected_create_targets,
    })
}

fn exit_with_bwrap_build_error(err: codex_protocol::error::CodexErr) -> ! {
    eprintln!("error building bubblewrap command: {err}");
    std::process::exit(1);
}

fn apply_inner_command_argv0(argv: &mut Vec<String>) {
    apply_inner_command_argv0_for_launcher(
        argv,
        preferred_bwrap_supports_argv0(),
        current_process_argv0(),
    );
}

fn apply_inner_command_argv0_for_launcher(
    argv: &mut Vec<String>,
    supports_argv0: bool,
    argv0_fallback_command: String,
) {
    let command_separator_index = argv
        .iter()
        .position(|arg| arg == "--")
        .unwrap_or_else(|| panic!("bubblewrap argv is missing command separator '--'"));

    if supports_argv0 {
        argv.splice(
            command_separator_index..command_separator_index,
            ["--argv0".to_string(), CODEX_LINUX_SANDBOX_ARG0.to_string()],
        );
        return;
    }

    let command_index = command_separator_index + 1;
    let Some(command) = argv.get_mut(command_index) else {
        panic!("bubblewrap argv is missing inner command after '--'");
    };
    *command = argv0_fallback_command;
}

fn current_process_argv0() -> String {
    match std::env::args_os().next() {
        Some(argv0) => argv0.to_string_lossy().into_owned(),
        None => panic!("failed to resolve current process argv[0]"),
    }
}

fn preflight_proc_mount_support(
    sandbox_policy_cwd: &Path,
    command_cwd: &Path,
    file_system_sandbox_policy: &FileSystemSandboxPolicy,
    network_mode: BwrapNetworkMode,
) -> CodexResult<bool> {
    let preflight_argv = build_preflight_bwrap_argv(
        sandbox_policy_cwd,
        command_cwd,
        file_system_sandbox_policy,
        network_mode,
    )?;
    let stderr = run_bwrap_in_child_capture_stderr(preflight_argv);
    Ok(!is_proc_mount_failure(stderr.as_str()))
}

fn build_preflight_bwrap_argv(
    sandbox_policy_cwd: &Path,
    command_cwd: &Path,
    file_system_sandbox_policy: &FileSystemSandboxPolicy,
    network_mode: BwrapNetworkMode,
) -> CodexResult<crate::bwrap::BwrapArgs> {
    let preflight_command = vec![resolve_true_command()];
    build_bwrap_argv(
        preflight_command,
        file_system_sandbox_policy,
        sandbox_policy_cwd,
        command_cwd,
        BwrapOptions {
            mount_proc: true,
            network_mode,
            ..Default::default()
        },
    )
}

fn resolve_true_command() -> String {
    for candidate in ["/usr/bin/true", "/bin/true"] {
        if Path::new(candidate).exists() {
            return candidate.to_string();
        }
    }
    "true".to_string()
}

fn run_or_exec_bwrap(bwrap_args: crate::bwrap::BwrapArgs) -> ! {
    if bwrap_args.synthetic_mount_targets.is_empty()
        && bwrap_args.protected_create_targets.is_empty()
    {
        exec_bwrap(bwrap_args.args, bwrap_args.preserved_files);
    }
    run_bwrap_in_child_with_synthetic_mount_cleanup(bwrap_args);
}

fn run_bwrap_in_child_with_synthetic_mount_cleanup(bwrap_args: crate::bwrap::BwrapArgs) -> ! {
    let crate::bwrap::BwrapArgs {
        args,
        preserved_files,
        synthetic_mount_targets,
        protected_create_targets,
    } = bwrap_args;
    let setup_signal_mask = ForwardedSignalMask::block();
    let synthetic_mount_registrations = register_synthetic_mount_targets(&synthetic_mount_targets);
    let protected_create_registrations =
        register_protected_create_targets(&protected_create_targets);
    let exec_start_pipe = create_exec_start_pipe(!protected_create_targets.is_empty());
    let parent_pid = unsafe { libc::getpid() };
    let pid = unsafe { libc::fork() };
    if pid < 0 {
        let err = std::io::Error::last_os_error();
        panic!("failed to fork for bubblewrap: {err}");
    }

    if pid == 0 {
        reset_forwarded_signal_handlers_to_default();
        setup_signal_mask.restore();
        let setpgid_res = unsafe { libc::setpgid(0, 0) };
        if setpgid_res < 0 {
            let err = std::io::Error::last_os_error();
            panic!("failed to place bubblewrap child in its own process group: {err}");
        }
        terminate_with_parent(parent_pid);
        wait_for_parent_exec_start(exec_start_pipe[0], exec_start_pipe[1]);
        exec_bwrap(args, preserved_files);
    }

    close_child_exec_start_read(exec_start_pipe[0]);
    let protected_create_monitor = ProtectedCreateMonitor::start(&protected_create_targets);
    let signal_forwarders = install_bwrap_signal_forwarders(pid);
    release_child_exec_start(exec_start_pipe[1]);
    setup_signal_mask.restore();
    let status = wait_for_bwrap_child(pid);
    let cleanup_signal_mask = ForwardedSignalMask::block();
    BWRAP_CHILD_PID.store(0, Ordering::SeqCst);
    let protected_create_monitor_violation = protected_create_monitor
        .map(ProtectedCreateMonitor::stop)
        .unwrap_or(false);
    cleanup_synthetic_mount_targets(&synthetic_mount_registrations);
    let protected_create_violation = protected_create_monitor_violation
        || cleanup_protected_create_targets(&protected_create_registrations);
    signal_forwarders.restore();
    cleanup_signal_mask.restore();
    exit_with_wait_status_or_policy_violation(status, protected_create_violation);
}

impl ProtectedCreateMonitor {
    fn start(targets: &[crate::bwrap::ProtectedCreateTarget]) -> Option<Self> {
        if targets.is_empty() {
            return None;
        }

        let targets = targets.to_vec();
        let stop = Arc::new(AtomicBool::new(false));
        let violation = Arc::new(AtomicBool::new(false));
        let monitor_stop = Arc::clone(&stop);
        let monitor_violation = Arc::clone(&violation);
        let handle = thread::spawn(move || {
            let watcher = ProtectedCreateWatcher::new(&targets);
            while !monitor_stop.load(Ordering::SeqCst) {
                for target in &targets {
                    if remove_protected_create_target_best_effort(target).is_some() {
                        monitor_violation.store(true, Ordering::SeqCst);
                    }
                }
                if let Some(watcher) = &watcher {
                    watcher.wait_for_create_event(&monitor_stop);
                } else {
                    thread::sleep(Duration::from_millis(1));
                }
            }
        });

        Some(Self {
            stop,
            violation,
            handle,
        })
    }

    fn stop(self) -> bool {
        self.stop.store(true, Ordering::SeqCst);
        self.handle
            .join()
            .unwrap_or_else(|_| panic!("protected create monitor thread panicked"));
        self.violation.load(Ordering::SeqCst)
    }
}

impl ProtectedCreateWatcher {
    fn new(targets: &[crate::bwrap::ProtectedCreateTarget]) -> Option<Self> {
        let fd = unsafe { libc::inotify_init1(libc::IN_NONBLOCK | libc::IN_CLOEXEC) };
        if fd < 0 {
            return None;
        }

        let mut watched_parents = Vec::<PathBuf>::new();
        let mut watches = Vec::new();
        for target in targets {
            let Some(parent) = target.path().parent() else {
                continue;
            };
            if watched_parents.iter().any(|watched| watched == parent) {
                continue;
            }
            watched_parents.push(parent.to_path_buf());
            let Ok(parent_cstr) = CString::new(parent.as_os_str().as_bytes()) else {
                continue;
            };
            let mask =
                libc::IN_CREATE | libc::IN_MOVED_TO | libc::IN_DELETE_SELF | libc::IN_MOVE_SELF;
            let watch = unsafe { libc::inotify_add_watch(fd, parent_cstr.as_ptr(), mask) };
            if watch >= 0 {
                watches.push(watch);
            }
        }

        if watches.is_empty() {
            unsafe {
                libc::close(fd);
            }
            return None;
        }

        Some(Self {
            fd,
            _watches: watches,
        })
    }

    fn wait_for_create_event(&self, stop: &AtomicBool) {
        let mut poll_fd = libc::pollfd {
            fd: self.fd,
            events: libc::POLLIN,
            revents: 0,
        };
        while !stop.load(Ordering::SeqCst) {
            let res = unsafe { libc::poll(&mut poll_fd, 1, 10) };
            if res > 0 {
                self.drain_events();
                return;
            }
            if res == 0 {
                return;
            }
            let err = std::io::Error::last_os_error();
            if err.kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return;
        }
    }

    fn drain_events(&self) {
        let mut buf = [0_u8; 4096];
        loop {
            let read = unsafe { libc::read(self.fd, buf.as_mut_ptr().cast(), buf.len()) };
            if read > 0 {
                continue;
            }
            if read == 0 {
                return;
            }
            let err = std::io::Error::last_os_error();
            if err.kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return;
        }
    }
}

impl Drop for ProtectedCreateWatcher {
    fn drop(&mut self) {
        unsafe {
            libc::close(self.fd);
        }
    }
}

fn create_exec_start_pipe(enabled: bool) -> [libc::c_int; 2] {
    if !enabled {
        return [-1, -1];
    }
    let mut pipe = [-1, -1];
    if unsafe { libc::pipe2(pipe.as_mut_ptr(), libc::O_CLOEXEC) } < 0 {
        let err = std::io::Error::last_os_error();
        panic!("failed to create bubblewrap exec start pipe: {err}");
    }
    pipe
}

fn wait_for_parent_exec_start(read_fd: libc::c_int, write_fd: libc::c_int) {
    if write_fd >= 0 {
        unsafe {
            libc::close(write_fd);
        }
    }
    if read_fd < 0 {
        return;
    }

    let mut byte = [0_u8; 1];
    loop {
        let read = unsafe { libc::read(read_fd, byte.as_mut_ptr().cast(), byte.len()) };
        if read >= 0 {
            break;
        }
        let err = std::io::Error::last_os_error();
        if err.kind() != std::io::ErrorKind::Interrupted {
            break;
        }
    }
    unsafe {
        libc::close(read_fd);
    }
}

fn close_child_exec_start_read(read_fd: libc::c_int) {
    if read_fd >= 0 {
        unsafe {
            libc::close(read_fd);
        }
    }
}

fn release_child_exec_start(write_fd: libc::c_int) {
    if write_fd < 0 {
        return;
    }
    let byte = [0_u8; 1];
    unsafe {
        libc::write(write_fd, byte.as_ptr().cast(), byte.len());
        libc::close(write_fd);
    }
}

struct ForwardedSignalMask {
    previous: libc::sigset_t,
}

struct ForwardedSignalHandlers {
    previous: Vec<(libc::c_int, libc::sigaction)>,
}

impl ForwardedSignalMask {
    fn block() -> Self {
        let mut blocked: libc::sigset_t = unsafe { std::mem::zeroed() };
        let mut previous: libc::sigset_t = unsafe { std::mem::zeroed() };
        unsafe {
            libc::sigemptyset(&mut blocked);
            for signal in FORWARDED_SIGNALS {
                libc::sigaddset(&mut blocked, *signal);
            }
            if libc::sigprocmask(libc::SIG_BLOCK, &blocked, &mut previous) < 0 {
                let err = std::io::Error::last_os_error();
                panic!("failed to block bubblewrap forwarded signals: {err}");
            }
        }
        Self { previous }
    }

    fn restore(&self) {
        let mut restored = self.previous;
        unsafe {
            for signal in FORWARDED_SIGNALS {
                libc::sigdelset(&mut restored, *signal);
            }
            if libc::sigprocmask(libc::SIG_SETMASK, &restored, std::ptr::null_mut()) < 0 {
                let err = std::io::Error::last_os_error();
                panic!("failed to restore bubblewrap forwarded signals: {err}");
            }
        }
    }
}

fn terminate_with_parent(parent_pid: libc::pid_t) {
    let res = unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) };
    if res < 0 {
        let err = std::io::Error::last_os_error();
        panic!("failed to set bubblewrap child parent-death signal: {err}");
    }
    if unsafe { libc::getppid() } != parent_pid {
        unsafe {
            libc::raise(libc::SIGTERM);
        }
    }
}

impl ForwardedSignalHandlers {
    fn restore(self) {
        BWRAP_CHILD_PID.store(0, Ordering::SeqCst);
        PENDING_FORWARDED_SIGNAL.store(0, Ordering::SeqCst);
        for (signal, previous_action) in self.previous {
            unsafe {
                if libc::sigaction(signal, &previous_action, std::ptr::null_mut()) < 0 {
                    let err = std::io::Error::last_os_error();
                    panic!("failed to restore bubblewrap signal handler for {signal}: {err}");
                }
            }
        }
    }
}

fn install_bwrap_signal_forwarders(pid: libc::pid_t) -> ForwardedSignalHandlers {
    BWRAP_CHILD_PID.store(pid, Ordering::SeqCst);
    let mut previous = Vec::with_capacity(FORWARDED_SIGNALS.len());
    for signal in FORWARDED_SIGNALS {
        let mut action: libc::sigaction = unsafe { std::mem::zeroed() };
        let mut previous_action: libc::sigaction = unsafe { std::mem::zeroed() };
        action.sa_sigaction = forward_signal_to_bwrap_child as *const () as libc::sighandler_t;
        unsafe {
            libc::sigemptyset(&mut action.sa_mask);
            if libc::sigaction(*signal, &action, &mut previous_action) < 0 {
                let err = std::io::Error::last_os_error();
                panic!("failed to install bubblewrap signal forwarder for {signal}: {err}");
            }
        }
        previous.push((*signal, previous_action));
    }
    replay_pending_forwarded_signal(pid);
    ForwardedSignalHandlers { previous }
}

extern "C" fn forward_signal_to_bwrap_child(signal: libc::c_int) {
    PENDING_FORWARDED_SIGNAL.store(signal, Ordering::SeqCst);
    let pid = BWRAP_CHILD_PID.load(Ordering::SeqCst);
    if pid > 0 {
        send_signal_to_bwrap_child(pid, signal);
    }
}

fn replay_pending_forwarded_signal(pid: libc::pid_t) {
    let signal = PENDING_FORWARDED_SIGNAL.swap(0, Ordering::SeqCst);
    if signal > 0 {
        send_signal_to_bwrap_child(pid, signal);
    }
}

fn send_signal_to_bwrap_child(pid: libc::pid_t, signal: libc::c_int) {
    unsafe {
        libc::kill(-pid, signal);
        libc::kill(pid, signal);
    }
}

fn reset_forwarded_signal_handlers_to_default() {
    for signal in FORWARDED_SIGNALS {
        unsafe {
            if libc::signal(*signal, libc::SIG_DFL) == libc::SIG_ERR {
                let err = std::io::Error::last_os_error();
                panic!("failed to reset bubblewrap signal handler for {signal}: {err}");
            }
        }
    }
}

fn wait_for_bwrap_child(pid: libc::pid_t) -> libc::c_int {
    loop {
        let mut status: libc::c_int = 0;
        let wait_res = unsafe { libc::waitpid(pid, &mut status as *mut libc::c_int, 0) };
        if wait_res >= 0 {
            return status;
        }
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() == Some(libc::EINTR) {
            continue;
        }
        panic!("waitpid failed for bubblewrap child: {err}");
    }
}

fn register_synthetic_mount_targets(
    targets: &[crate::bwrap::SyntheticMountTarget],
) -> Vec<SyntheticMountTargetRegistration> {
    with_synthetic_mount_registry_lock(|| {
        targets
            .iter()
            .map(|target| {
                let marker_dir = synthetic_mount_marker_dir(target.path());
                fs::create_dir_all(&marker_dir).unwrap_or_else(|err| {
                    panic!(
                        "failed to create synthetic bubblewrap mount marker directory {}: {err}",
                        marker_dir.display()
                    )
                });
                let target = if target.preserves_pre_existing_path()
                    && synthetic_mount_marker_dir_has_active_synthetic_owner(&marker_dir)
                {
                    match target.kind() {
                        crate::bwrap::SyntheticMountTargetKind::EmptyFile => {
                            crate::bwrap::SyntheticMountTarget::missing(target.path())
                        }
                        crate::bwrap::SyntheticMountTargetKind::EmptyDirectory => {
                            crate::bwrap::SyntheticMountTarget::missing_empty_directory(
                                target.path(),
                            )
                        }
                    }
                } else {
                    target.clone()
                };
                let marker_file = marker_dir.join(std::process::id().to_string());
                fs::write(&marker_file, synthetic_mount_marker_contents(&target)).unwrap_or_else(
                    |err| {
                        panic!(
                            "failed to register synthetic bubblewrap mount target {}: {err}",
                            target.path().display()
                        )
                    },
                );
                SyntheticMountTargetRegistration {
                    target,
                    marker_file,
                    marker_dir,
                }
            })
            .collect()
    })
}

fn register_protected_create_targets(
    targets: &[crate::bwrap::ProtectedCreateTarget],
) -> Vec<ProtectedCreateTargetRegistration> {
    with_synthetic_mount_registry_lock(|| {
        targets
            .iter()
            .map(|target| {
                let marker_dir = synthetic_mount_marker_dir(target.path());
                fs::create_dir_all(&marker_dir).unwrap_or_else(|err| {
                    panic!(
                        "failed to create protected create marker directory {}: {err}",
                        marker_dir.display()
                    )
                });
                let marker_file = marker_dir.join(std::process::id().to_string());
                fs::write(&marker_file, PROTECTED_CREATE_MARKER).unwrap_or_else(|err| {
                    panic!(
                        "failed to register protected create target {}: {err}",
                        target.path().display()
                    )
                });
                ProtectedCreateTargetRegistration {
                    target: target.clone(),
                    marker_file,
                    marker_dir,
                }
            })
            .collect()
    })
}

fn synthetic_mount_marker_contents(target: &crate::bwrap::SyntheticMountTarget) -> &'static [u8] {
    if target.preserves_pre_existing_path() {
        SYNTHETIC_MOUNT_MARKER_EXISTING
    } else {
        SYNTHETIC_MOUNT_MARKER_SYNTHETIC
    }
}

fn synthetic_mount_marker_dir_has_active_synthetic_owner(marker_dir: &Path) -> bool {
    synthetic_mount_marker_dir_has_active_process_matching(marker_dir, |path| {
        match fs::read(path) {
            Ok(contents) => contents == SYNTHETIC_MOUNT_MARKER_SYNTHETIC,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => false,
            Err(err) => panic!(
                "failed to read synthetic bubblewrap mount marker {}: {err}",
                path.display()
            ),
        }
    })
}

fn synthetic_mount_marker_dir_has_active_process(marker_dir: &Path) -> bool {
    synthetic_mount_marker_dir_has_active_process_matching(marker_dir, |_| true)
}

fn synthetic_mount_marker_dir_has_active_process_matching(
    marker_dir: &Path,
    matches_marker: impl Fn(&Path) -> bool,
) -> bool {
    let entries = match fs::read_dir(marker_dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return false,
        Err(err) => panic!(
            "failed to read synthetic bubblewrap mount marker directory {}: {err}",
            marker_dir.display()
        ),
    };
    for entry in entries {
        let entry = entry.unwrap_or_else(|err| {
            panic!(
                "failed to read synthetic bubblewrap mount marker in {}: {err}",
                marker_dir.display()
            )
        });
        let path = entry.path();
        let Some(pid) = path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.parse::<libc::pid_t>().ok())
        else {
            continue;
        };
        if !process_is_active(pid) {
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => panic!(
                    "failed to remove stale synthetic bubblewrap mount marker {}: {err}",
                    path.display()
                ),
            }
            continue;
        }
        let matches_marker = matches_marker(&path);
        if matches_marker {
            return true;
        }
    }
    false
}

fn cleanup_synthetic_mount_targets(targets: &[SyntheticMountTargetRegistration]) {
    with_synthetic_mount_registry_lock(|| {
        for target in targets.iter().rev() {
            match fs::remove_file(&target.marker_file) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => panic!(
                    "failed to unregister synthetic bubblewrap mount target {}: {err}",
                    target.target.path().display()
                ),
            }
        }

        for target in targets.iter().rev() {
            if synthetic_mount_marker_dir_has_active_process(&target.marker_dir) {
                continue;
            }
            remove_synthetic_mount_target(&target.target);
            match fs::remove_dir(&target.marker_dir) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) if err.kind() == std::io::ErrorKind::DirectoryNotEmpty => {}
                Err(err) => panic!(
                    "failed to remove synthetic bubblewrap mount marker directory {}: {err}",
                    target.marker_dir.display()
                ),
            }
        }
    });
}

fn cleanup_protected_create_targets(targets: &[ProtectedCreateTargetRegistration]) -> bool {
    with_synthetic_mount_registry_lock(|| {
        for target in targets.iter().rev() {
            match fs::remove_file(&target.marker_file) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => panic!(
                    "failed to unregister protected create target {}: {err}",
                    target.target.path().display()
                ),
            }
        }

        let mut violation = false;
        for target in targets.iter().rev() {
            if synthetic_mount_marker_dir_has_active_process(&target.marker_dir) {
                if target.target.path().exists() {
                    violation = true;
                }
                continue;
            }
            violation |= remove_protected_create_target(&target.target);
            match fs::remove_dir(&target.marker_dir) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) if err.kind() == std::io::ErrorKind::DirectoryNotEmpty => {}
                Err(err) => panic!(
                    "failed to remove protected create marker directory {}: {err}",
                    target.marker_dir.display()
                ),
            }
        }
        violation
    })
}

fn remove_protected_create_target(target: &crate::bwrap::ProtectedCreateTarget) -> bool {
    for attempt in 0..100 {
        match try_remove_protected_create_target(target) {
            Ok(removal) => return removal.is_some(),
            Err(err) if err.kind() == std::io::ErrorKind::DirectoryNotEmpty && attempt < 99 => {
                thread::sleep(Duration::from_millis(1));
            }
            Err(err) => {
                panic!(
                    "failed to remove protected create target {}: {err}",
                    target.path().display()
                );
            }
        }
    }
    unreachable!("protected create removal retry loop should return or panic")
}

fn remove_protected_create_target_best_effort(
    target: &crate::bwrap::ProtectedCreateTarget,
) -> Option<ProtectedCreateRemoval> {
    for _ in 0..100 {
        match try_remove_protected_create_target(target) {
            Ok(removal) => return removal,
            Err(err) if err.kind() == std::io::ErrorKind::DirectoryNotEmpty => {
                thread::sleep(Duration::from_millis(1));
            }
            Err(_) => return Some(ProtectedCreateRemoval::Other),
        }
    }
    Some(ProtectedCreateRemoval::Other)
}

fn try_remove_protected_create_target(
    target: &crate::bwrap::ProtectedCreateTarget,
) -> std::io::Result<Option<ProtectedCreateRemoval>> {
    let path = target.path();
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err),
    };

    let removal = if metadata.is_dir() {
        ProtectedCreateRemoval::Directory
    } else {
        ProtectedCreateRemoval::Other
    };
    let result = if removal == ProtectedCreateRemoval::Directory {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    match result {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err),
    }
    eprintln!(
        "sandbox blocked creation of protected workspace metadata path {}",
        path.display()
    );
    Ok(Some(removal))
}

fn remove_synthetic_mount_target(target: &crate::bwrap::SyntheticMountTarget) {
    let path = target.path();
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return,
        Err(err) => panic!(
            "failed to inspect synthetic bubblewrap mount target {}: {err}",
            path.display()
        ),
    };
    if !target.should_remove_after_bwrap(&metadata) {
        return;
    }
    match target.kind() {
        crate::bwrap::SyntheticMountTargetKind::EmptyFile => match fs::remove_file(path) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => panic!(
                "failed to remove synthetic bubblewrap mount target {}: {err}",
                path.display()
            ),
        },
        crate::bwrap::SyntheticMountTargetKind::EmptyDirectory => match fs::remove_dir(path) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) if err.kind() == std::io::ErrorKind::DirectoryNotEmpty => {}
            Err(err) => panic!(
                "failed to remove synthetic bubblewrap mount target {}: {err}",
                path.display()
            ),
        },
    }
}

fn process_is_active(pid: libc::pid_t) -> bool {
    let result = unsafe { libc::kill(pid, 0) };
    if result == 0 {
        return true;
    }
    let err = std::io::Error::last_os_error();
    !matches!(err.raw_os_error(), Some(libc::ESRCH))
}

fn with_synthetic_mount_registry_lock<T>(f: impl FnOnce() -> T) -> T {
    let registry_root = synthetic_mount_registry_root();
    fs::create_dir_all(&registry_root).unwrap_or_else(|err| {
        panic!(
            "failed to create synthetic bubblewrap mount registry {}: {err}",
            registry_root.display()
        )
    });
    let lock_path = registry_root.join("lock");
    let lock_file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .unwrap_or_else(|err| {
            panic!(
                "failed to open synthetic bubblewrap mount registry lock {}: {err}",
                lock_path.display()
            )
        });
    if unsafe { libc::flock(lock_file.as_raw_fd(), libc::LOCK_EX) } < 0 {
        let err = std::io::Error::last_os_error();
        panic!(
            "failed to lock synthetic bubblewrap mount registry {}: {err}",
            lock_path.display()
        );
    }
    let result = f();
    if unsafe { libc::flock(lock_file.as_raw_fd(), libc::LOCK_UN) } < 0 {
        let err = std::io::Error::last_os_error();
        panic!(
            "failed to unlock synthetic bubblewrap mount registry {}: {err}",
            lock_path.display()
        );
    }
    result
}

fn synthetic_mount_marker_dir(path: &Path) -> PathBuf {
    synthetic_mount_registry_root().join(format!("{:016x}", hash_path(path)))
}

fn synthetic_mount_registry_root() -> PathBuf {
    let effective_uid = unsafe { libc::geteuid() };
    std::env::temp_dir().join(format!(
        "codex-bwrap-synthetic-mount-targets-{effective_uid}"
    ))
}

fn hash_path(path: &Path) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in path.as_os_str().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn exit_with_wait_status(status: libc::c_int) -> ! {
    if libc::WIFEXITED(status) {
        std::process::exit(libc::WEXITSTATUS(status));
    }

    if libc::WIFSIGNALED(status) {
        let signal = libc::WTERMSIG(status);
        unsafe {
            libc::signal(signal, libc::SIG_DFL);
            libc::kill(libc::getpid(), signal);
        }
        std::process::exit(128 + signal);
    }

    std::process::exit(1);
}

fn exit_with_wait_status_or_policy_violation(
    status: libc::c_int,
    protected_create_violation: bool,
) -> ! {
    if protected_create_violation && libc::WIFEXITED(status) && libc::WEXITSTATUS(status) == 0 {
        std::process::exit(1);
    }

    exit_with_wait_status(status);
}

/// Run a short-lived bubblewrap preflight in a child process and capture stderr.
///
/// Strategy:
/// - This is used only by `preflight_proc_mount_support`, which runs `/bin/true`
///   under bubblewrap with `--proc /proc`.
/// - The goal is to detect environments where mounting `/proc` fails (for
///   example, restricted containers), so we can retry the real run with
///   `--no-proc`.
/// - We capture stderr from that preflight to match known mount-failure text.
///   We do not stream it because this is a one-shot probe with a trivial
///   command, and reads are bounded to a fixed max size.
fn run_bwrap_in_child_capture_stderr(bwrap_args: crate::bwrap::BwrapArgs) -> String {
    const MAX_PREFLIGHT_STDERR_BYTES: u64 = 64 * 1024;
    let crate::bwrap::BwrapArgs {
        args,
        preserved_files,
        synthetic_mount_targets,
        protected_create_targets,
    } = bwrap_args;
    let setup_signal_mask = ForwardedSignalMask::block();
    let synthetic_mount_registrations = register_synthetic_mount_targets(&synthetic_mount_targets);
    let protected_create_registrations =
        register_protected_create_targets(&protected_create_targets);

    let mut pipe_fds = [0; 2];
    let pipe_res = unsafe { libc::pipe2(pipe_fds.as_mut_ptr(), libc::O_CLOEXEC) };
    if pipe_res < 0 {
        let err = std::io::Error::last_os_error();
        panic!("failed to create stderr pipe for bubblewrap: {err}");
    }
    let read_fd = pipe_fds[0];
    let write_fd = pipe_fds[1];

    let pid = unsafe { libc::fork() };
    if pid < 0 {
        let err = std::io::Error::last_os_error();
        panic!("failed to fork for bubblewrap: {err}");
    }

    if pid == 0 {
        reset_forwarded_signal_handlers_to_default();
        setup_signal_mask.restore();
        // Child: redirect stderr to the pipe, then run bubblewrap.
        unsafe {
            close_fd_or_panic(read_fd, "close read end in bubblewrap child");
            if libc::dup2(write_fd, libc::STDERR_FILENO) < 0 {
                let err = std::io::Error::last_os_error();
                panic!("failed to redirect stderr for bubblewrap: {err}");
            }
            close_fd_or_panic(write_fd, "close write end in bubblewrap child");
        }

        exec_bwrap(args, preserved_files);
    }

    let signal_forwarders = install_bwrap_signal_forwarders(pid);
    setup_signal_mask.restore();
    // Parent: close the write end and read stderr while the child runs.
    close_fd_or_panic(write_fd, "close write end in bubblewrap parent");

    // SAFETY: `read_fd` is a valid owned fd in the parent.
    let mut read_file = unsafe { File::from_raw_fd(read_fd) };
    let mut stderr_bytes = Vec::new();
    let mut limited_reader = (&mut read_file).take(MAX_PREFLIGHT_STDERR_BYTES);
    if let Err(err) = limited_reader.read_to_end(&mut stderr_bytes) {
        panic!("failed to read bubblewrap stderr: {err}");
    }

    let status = wait_for_bwrap_child(pid);
    let cleanup_signal_mask = ForwardedSignalMask::block();
    BWRAP_CHILD_PID.store(0, Ordering::SeqCst);
    cleanup_synthetic_mount_targets(&synthetic_mount_registrations);
    cleanup_protected_create_targets(&protected_create_registrations);
    signal_forwarders.restore();
    cleanup_signal_mask.restore();
    if libc::WIFSIGNALED(status) {
        exit_with_wait_status(status);
    }

    String::from_utf8_lossy(&stderr_bytes).into_owned()
}

/// Close an owned file descriptor and panic with context on failure.
///
/// We use explicit close() checks here (instead of ignoring return codes)
/// because this code runs in low-level sandbox setup paths where fd leaks or
/// close errors can mask the root cause of later failures.
fn close_fd_or_panic(fd: libc::c_int, context: &str) {
    let close_res = unsafe { libc::close(fd) };
    if close_res < 0 {
        let err = std::io::Error::last_os_error();
        panic!("{context}: {err}");
    }
}

fn is_proc_mount_failure(stderr: &str) -> bool {
    stderr.contains("Can't mount proc")
        && stderr.contains("/newroot/proc")
        && (stderr.contains("Invalid argument")
            || stderr.contains("Operation not permitted")
            || stderr.contains("Permission denied"))
}

struct InnerSeccompCommandArgs<'a> {
    sandbox_policy_cwd: &'a Path,
    command_cwd: Option<&'a Path>,
    permission_profile: &'a PermissionProfile,
    allow_network_for_proxy: bool,
    proxy_route_spec: Option<String>,
    command: Vec<String>,
}

/// Build the inner command that applies seccomp after bubblewrap.
fn build_inner_seccomp_command(args: InnerSeccompCommandArgs<'_>) -> Vec<String> {
    let InnerSeccompCommandArgs {
        sandbox_policy_cwd,
        command_cwd,
        permission_profile,
        allow_network_for_proxy,
        proxy_route_spec,
        command,
    } = args;
    let current_exe = match std::env::current_exe() {
        Ok(path) => path,
        Err(err) => panic!("failed to resolve current executable path: {err}"),
    };
    let permission_profile_json = match serde_json::to_string(permission_profile) {
        Ok(json) => json,
        Err(err) => panic!("failed to serialize permission profile: {err}"),
    };

    let mut inner = vec![
        current_exe.to_string_lossy().to_string(),
        "--sandbox-policy-cwd".to_string(),
        sandbox_policy_cwd.to_string_lossy().to_string(),
    ];
    if let Some(command_cwd) = command_cwd {
        inner.push("--command-cwd".to_string());
        inner.push(command_cwd.to_string_lossy().to_string());
    }
    inner.extend([
        "--permission-profile".to_string(),
        permission_profile_json,
        "--apply-seccomp-then-exec".to_string(),
    ]);
    if allow_network_for_proxy {
        inner.push("--allow-network-for-proxy".to_string());
        let proxy_route_spec = proxy_route_spec
            .unwrap_or_else(|| panic!("managed proxy mode requires a proxy route spec"));
        inner.push("--proxy-route-spec".to_string());
        inner.push(proxy_route_spec);
    }
    inner.push("--".to_string());
    inner.extend(command);
    inner
}

/// Exec the provided argv, panicking with context if it fails.
fn exec_or_panic(command: Vec<String>) -> ! {
    #[expect(clippy::expect_used)]
    let c_command =
        CString::new(command[0].as_str()).expect("Failed to convert command to CString");
    #[expect(clippy::expect_used)]
    let c_args: Vec<CString> = command
        .iter()
        .map(|arg| CString::new(arg.as_str()).expect("Failed to convert arg to CString"))
        .collect();

    let mut c_args_ptrs: Vec<*const libc::c_char> = c_args.iter().map(|arg| arg.as_ptr()).collect();
    c_args_ptrs.push(std::ptr::null());

    unsafe {
        libc::execvp(c_command.as_ptr(), c_args_ptrs.as_ptr());
    }

    // If execvp returns, there was an error.
    let err = std::io::Error::last_os_error();
    panic!("Failed to execvp {}: {err}", command[0].as_str());
}

#[cfg(test)]
#[path = "linux_run_main_tests.rs"]
mod tests;
