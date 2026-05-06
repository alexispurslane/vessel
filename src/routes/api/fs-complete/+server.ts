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
    // filesystem path prefix check, not XPath
    // oxlint-disable-next-line secure-coding/no-xpath-injection
    return PATH_BLACKLIST.some(prefix => resolvedPath === prefix || resolvedPath.startsWith(prefix + "/"));
}

interface CompletionPathOptions {
    name: string;
    isDir: boolean;
    partial: string;
    searchPath: string;
    prefix: string;
}

/**
 * Build the completion path for a directory entry.
 *
 * @param opts - Completion path options
 * @param opts.name - The entry name
 * @param opts.isDir - Whether the entry is a directory
 * @param opts.partial - The original partial path
 * @param opts.searchPath - The expanded search path
 * @param opts.prefix - The prefix to filter by
 * @returns The full completion path string
 */
function buildCompletionPath(opts: CompletionPathOptions): string {
    const { name, isDir, partial, searchPath, prefix } = opts;
    const parentDir = dirname(partial);
    let completionPath: string;

    if (partial.endsWith("/")) {
        completionPath = partial + name;
    } else if (prefix === "") {
        // oxlint-disable-next-line secure-coding/no-xpath-injection
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

/**
 * Sort completions: directories first, then alphabetically.
 *
 * @param a - First completion path
 * @param b - Second completion path
 * @returns Sort comparison value
 */
function sortCompletions(a: string, b: string): number {
    const aIsDir = a.endsWith("/");
    const bIsDir = b.endsWith("/");
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.localeCompare(b);
}

/**
 * Resolve a search path into a directory to list and a prefix to filter by.
 *
 * @param searchPath - The expanded search path
 * @returns An object with dirPath and prefix
 */
async function resolveSearchPath(searchPath: string): Promise<{ dirPath: string; prefix: string }> {
    try {
        const pathFile = Bun.file(searchPath);
        const pathStat = await pathFile.stat();
        if (pathStat.isDirectory()) {
            return { dirPath: searchPath, prefix: "" };
        }
        return { dirPath: dirname(searchPath), prefix: basename(searchPath) };
    } catch {
        return { dirPath: dirname(searchPath), prefix: basename(searchPath) };
    }
}

/**
 * Check whether a directory entry matches the filter criteria.
 *
 * @param name - The entry name
 * @param isDir - Whether the entry is a directory
 * @param prefix - The prefix to filter by
 * @param type - The type filter ("file", "directory", or "all")
 * @returns True if the entry should be included in completions
 */
function entryMatchesFilter(name: string, isDir: boolean, prefix: string, type: string): boolean {
    if (name.startsWith(".") && !prefix.startsWith(".")) return false;
    if (!name.toLowerCase().startsWith(prefix.toLowerCase())) return false;
    if (type === "directory" && !isDir) return false;
    if (type === "file" && isDir) return false;
    return true;
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
    const { dirPath, prefix } = await resolveSearchPath(searchPath);

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
            const isDir = entry.isDirectory();
            if (!entryMatchesFilter(entry.name, isDir, prefix, type)) continue;

            completions.push(buildCompletionPath({
                name: entry.name,
                isDir,
                partial,
                searchPath,
                prefix,
            }));
        }

        completions.sort(sortCompletions);
        return json({ completions: completions.slice(0, 50) });
    } catch {
        return json({ completions: [] });
    }
});
