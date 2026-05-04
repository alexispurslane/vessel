import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler } from "$lib/server/api-errors.js";
import { resolve, dirname, basename, join } from "path";
import { readdir } from "node:fs/promises";

const FsCompleteBody = z.object({
    partial: z.string(),
    type: z.enum(["file", "directory", "all"]).optional(),
});

const PATH_BLACKLIST = [
    "/etc",
    "/proc",
    "/sys",
    "/dev",
    "/boot",
    "/root",
    "/var/log",
    "/private/etc",     // macOS
    "/private/var",     // macOS
];

function isBlacklistedPath(resolvedPath: string): boolean {
    return PATH_BLACKLIST.some(prefix => resolvedPath === prefix || resolvedPath.startsWith(prefix + "/"));
}

interface CompletionPathOptions {
    name: string;
    isDir: boolean;
    partial: string;
    searchPath: string;
    prefix: string;
}

/** Build the completion path for a directory entry. */
function buildCompletionPath(opts: CompletionPathOptions): string {
    const { name, isDir, partial, searchPath, prefix } = opts;
    const parentDir = dirname(partial);
    let completionPath: string;

    if (partial.endsWith("/")) {
        completionPath = partial + name;
    } else if (prefix === "") {
        completionPath = searchPath + "/" + name;
    } else if (parentDir === ".") {
        completionPath = name;
    } else if (parentDir === "/") {
        completionPath = "/" + name;
    } else {
        completionPath = parentDir + "/" + name;
    }

    if (isDir) {
        completionPath += "/";
    }

    // Preserve ~ prefix if original used it
    if (partial.startsWith("~")) {
        const home = process.env.HOME || "";
        if (completionPath.startsWith(home)) {
            completionPath = "~" + completionPath.slice(home.length);
        }
    }

    return completionPath;
}

/** Sort completions: directories first, then alphabetically. */
function sortCompletions(a: string, b: string): number {
    const aIsDir = a.endsWith("/");
    const bIsDir = b.endsWith("/");
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.localeCompare(b);
}

/**
 * POST /api/fs-complete
 * Get filesystem path completions for a partial path.
 * Body: { partial: string, type?: "file" | "directory" | "all" }
 * Returns: { completions: string[] }
 */
export const POST = apiHandler(FsCompleteBody, async ({ body }) => {
    const { partial } = body;
    const type = body.type ?? "all";

    if (!partial) {
        return json({ completions: [] });
    }

    // Expand ~ to home directory
    let searchPath = partial;
    if (searchPath.startsWith("~")) {
        const home = process.env.HOME || process.env.USERPROFILE || "/";
        searchPath = join(home, searchPath.slice(1));
    }

    // Determine the directory to list and the prefix to filter by
    let dirPath: string;
    let prefix: string;

    try {
        const pathFile = Bun.file(searchPath);
        const pathStat = await pathFile.stat();
        if (pathStat.isDirectory()) {
            dirPath = searchPath;
            prefix = "";
        } else {
            dirPath = dirname(searchPath);
            prefix = basename(searchPath);
        }
    } catch {
        dirPath = dirname(searchPath);
        prefix = basename(searchPath);
    }

    // Resolve to absolute path
    const resolvedDir = resolve(dirPath);

    // Block autocompletion of sensitive system paths
    if (isBlacklistedPath(resolvedDir)) {
        return json({ completions: [] });
    }

    try {
        const entries = await readdir(resolvedDir, { withFileTypes: true });
        const completions: string[] = [];

        for (const entry of entries) {
            const name = entry.name;

            // Skip hidden files unless prefix starts with .
            if (name.startsWith(".") && !prefix.startsWith(".")) {
                continue;
            }

            // Filter by prefix
            if (!name.toLowerCase().startsWith(prefix.toLowerCase())) {
                continue;
            }

            // Filter by type
            const isDir = entry.isDirectory();
            if (type === "directory" && !isDir) continue;
            if (type === "file" && isDir) continue;

            completions.push(buildCompletionPath({ name, isDir, partial, searchPath, prefix }));
        }

        completions.sort(sortCompletions);
        return json({ completions: completions.slice(0, 50) });
    } catch {
        return json({ completions: [] });
    }
});
