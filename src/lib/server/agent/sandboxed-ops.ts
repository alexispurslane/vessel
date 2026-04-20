/**
 * Sandboxed tool operations backed by zerobox.
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

// --- Bash ---

/**
 * Create sandboxed bash operations.
 * All shell commands execute inside the zerobox sandbox.
 */
export function createSandboxedBashOps(sandbox: Sandbox): BashOperations {
    return {
        async exec(command, cwd, options) {
            // Run the command inside the sandbox, collect all output
            const result: CommandOutput = await sandbox.exec("sh", ["-c", command]).output();

            // Dump the full output as one stream — the model gets it all at once anyway.
            // The onData callback is for TUI rendering; in our web app context it just
            // buffers into the tool result string.
            const combined = result.stdout + result.stderr;
            if (combined) {
                options.onData(Buffer.from(combined));
            }

            return { exitCode: result.code ?? null };
        },
    };
}

// --- Read ---

/**
 * Create sandboxed read operations.
 * File reads go through zerobox so the sandbox's allowRead/denyRead policies apply.
 */
export function createSandboxedReadOps(sandbox: Sandbox): ReadOperations {
    return {
        async readFile(absolutePath: string): Promise<Buffer> {
            // Use cat inside the sandbox to read the file
            const output = await sandbox.exec("cat", [absolutePath]).output();
            if (output.code !== 0) {
                throw new Error(`Failed to read ${absolutePath}: ${output.stderr}`);
            }
            return Buffer.from(output.stdout);
        },
        async access(absolutePath: string): Promise<void> {
            // Use test inside the sandbox to check readability
            const result = await sandbox.exec("test", ["-r", absolutePath]).output();
            if (result.code !== 0) {
                throw new Error(`File not readable: ${absolutePath}`);
            }
        },
    };
}

// --- Write ---

/**
 * Create sandboxed write operations.
 * File writes go through zerobox so the sandbox's allowWrite/denyWrite policies apply.
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
 */
export function createSandboxedFindOps(sandbox: Sandbox): FindOperations {
    return {
        exists(absolutePath: string): Promise<boolean> | boolean {
            return sandbox
                .exec("test", ["-e", absolutePath])
                .output()
                .then((r) => r.code === 0);
        },
        async glob(pattern: string, cwd: string, options: { ignore: string[]; limit: number }) {
            // Use find inside the sandbox for glob matching
            const ignoreArgs = options.ignore
                .flatMap((i) => ["-not", "-path", `*/${i}/*`])
                .join(" ");
            const cmd = `find '${cwd}' -name '${pattern}' ${ignoreArgs || ""} -type f 2>/dev/null | head -n ${options.limit}`;
            const r = await sandbox
                .exec("sh", ["-c", cmd])
                .output();
            if (r.code !== 0 && !r.stdout) return [];
            return r.stdout
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean);
        },
    };
}

// --- Ls ---

/**
 * Create sandboxed ls operations.
 * Directory listing and stat go through the sandbox.
 */
export function createSandboxedLsOps(sandbox: Sandbox): LsOperations {
    return {
        exists(absolutePath: string): Promise<boolean> | boolean {
            return sandbox
                .exec("test", ["-e", absolutePath])
                .output()
                .then((r) => r.code === 0);
        },
        stat(absolutePath: string) {
            // We need isDirectory — use test -d inside the sandbox
            return sandbox.exec("test", ["-d", absolutePath]).output().then((r) => {
                const isDir = r.code === 0;
                // Also check if path exists at all
                return sandbox.exec("test", ["-e", absolutePath]).output().then((existsResult) => {
                    if (existsResult.code !== 0) {
                        throw new Error(`path does not exist: ${absolutePath}`);
                    }
                    return { isDirectory: () => isDir };
                });
            });
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
