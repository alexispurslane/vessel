import { basename, resolve, join, sep } from "path";
import { realpathSync } from "fs";

/**
 * Characters that are never valid in a filename regardless of platform.
 * This excludes control characters, path separators, and null bytes.
 * We intentionally allow spaces, unicode, hyphens, and dots.
 */
const FORBIDDEN_FILENAME_CHARS = /[\x00-\x1f\x7f\\/]/;

/**
 * Sanitize a user-supplied filename by stripping directory components and
 * rejecting path traversal attempts. Returns just the basename.
 *
 * Use this when you expect a filename only (no directory path),
 * e.g., for X-Filename headers or uploaded filenames.
 *
 * @param filename - The user-supplied filename to sanitize
 * @returns The sanitized filename (basename only)
 * @throws Error if the filename is empty, is `.` or `..`, or contains forbidden characters
 */
export function sanitizeFilename(filename: string): string {
    const name = basename(filename);

    if (!name || name.length === 0) {
        throw new Error("Filename must not be empty after sanitization");
    }

    if (name === "." || name === "..") {
        throw new Error('Filename must not be "." or ".."');
    }

    if (FORBIDDEN_FILENAME_CHARS.test(name)) {
        throw new Error("Filename contains forbidden characters");
    }

    return name;
}

/**
 * Sanitize a user-supplied relative path and verify it stays within
 * a base directory. Resolves symlinks on the base directory.
 *
 * Use this when you expect a relative path within a directory tree,
 * e.g., for workspace file operations.
 *
 * @param basePath - The allowed base directory (resolved with realpath)
 * @param relativePath - The user-supplied relative path to sanitize
 * @returns The fully resolved, verified absolute path
 * @throws Error if the path escapes the base directory or contains `..` components
 */
export function sanitizeAndResolvePath(basePath: string, relativePath: string): string {
    // Reject any path component that is `..` to prevent traversal
    const components = relativePath.split(sep);
    for (const component of components) {
        if (component === "..") {
            throw new Error("Path must not contain '..' components");
        }
    }

    // Resolve symlinks on the base directory so we know the true root
    const resolvedBase = realpathSync(basePath);

    // Join and resolve the full path
    const fullPath = resolve(resolvedBase, relativePath);

    // Verify the final resolved path is still within the allowed base directory.
    // We add a trailing separator to prevent prefix attacks like:
    //   basePath = /home/user/work  matching  /home/user/workspace
    if (!fullPath.startsWith(resolvedBase + sep) && fullPath !== resolvedBase) {
        throw new Error("Resolved path escapes the allowed base directory");
    }

    return fullPath;
}
