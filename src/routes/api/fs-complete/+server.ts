import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { readdir, stat } from "fs/promises";
import { resolve, dirname, basename, join } from "path";

/**
 * POST /api/fs-complete
 * Get filesystem path completions for a partial path.
 * Body: { partial: string, type?: "file" | "directory" | "all" }
 * Returns: { completions: string[] }
 */
export const POST: RequestHandler = async ({ request }) => {
    const { partial, type = "all" } = (await request.json()) as {
        partial: string;
        type?: "file" | "directory" | "all";
    };

    if (!partial || typeof partial !== "string") {
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
        const pathStat = await stat(searchPath);
        if (pathStat.isDirectory()) {
            // If the path is a complete directory, list its contents
            dirPath = searchPath;
            prefix = "";
        } else {
            // It's a file - return completions based on its directory
            dirPath = dirname(searchPath);
            prefix = basename(searchPath);
        }
    } catch {
        // Path doesn't exist or is incomplete - treat as partial
        dirPath = dirname(searchPath);
        prefix = basename(searchPath);
    }

    // Resolve to absolute path
    const resolvedDir = resolve(dirPath);

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

            // Build the completion path
            let completionPath: string;
            const parentDir = dirname(partial);

            if (partial.endsWith("/")) {
                completionPath = partial + name;
            } else if (prefix === "") {
                // The partial was a complete directory path
                completionPath = searchPath + "/" + name;
            } else if (parentDir === ".") {
                // User just typed a name without any path separator - don't add leading slash
                completionPath = name;
            } else if (parentDir === "/") {
                // Parent is root - don't add extra slash
                completionPath = "/" + name;
            } else {
                // Normal path - join with slash
                completionPath = parentDir + "/" + name;
            }

            // Add trailing slash for directories
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

            completions.push(completionPath);
        }

        // Sort: directories first, then alphabetically
        completions.sort((a, b) => {
            const aIsDir = a.endsWith("/");
            const bIsDir = b.endsWith("/");
            if (aIsDir && !bIsDir) return -1;
            if (!aIsDir && bIsDir) return 1;
            return a.localeCompare(b);
        });

        return json({ completions: completions.slice(0, 50) }); // Limit to 50 results
    } catch {
        return json({ completions: [] });
    }
};
