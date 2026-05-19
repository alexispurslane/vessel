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

/** Options for creating sandboxed read operations. */
export interface SandboxedReadOpsOptions {
    /** The conversation ID, used to look up in-memory canvas documents. */
    conversationId: string;
    /** The session workspace directory, used to convert absolute paths to workspace-relative paths. */
    workDir: string;
}

/**
 * Create sandboxed read operations.
 * File reads go through zerobox so the sandbox's allowRead/denyRead policies apply.
 *
 * For canvas files that have an active in-memory document, reads are served from
 * that document instead of hitting disk, avoiding race conditions between user
 * edits (applied in-memory first) and agent reads.
 *
 * @param sandbox - The zerobox sandbox instance to route reads through.
 * @param options - Conversation ID and work directory for canvas interception.
 * @returns ReadOperations implementation backed by the sandbox.
 */
export function createSandboxedReadOps(sandbox: Sandbox, options: SandboxedReadOpsOptions): ReadOperations {
    const { conversationId, workDir } = options;

    return {
        async readFile(absolutePath: string): Promise<Buffer> {
            // Check in-memory canvas doc first (authoritative, avoids race conditions)
            if (absolutePath.startsWith(workDir + "/")) {
                const relativePath = absolutePath.slice(workDir.length + 1);
                // Dynamic import to avoid circular dependency at module load time
                const { getCanvasDocContentIfExists } = await import("$lib/server/canvas-store.js");
                const canvasContent = getCanvasDocContentIfExists(conversationId, relativePath);
                if (canvasContent !== null) {
                    return Buffer.from(canvasContent, "utf-8");
                }
            }

            // Fall through to sandbox disk read (macOS base64 via stdin)
            // Pipe with single-quote escaping for spaces.
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
