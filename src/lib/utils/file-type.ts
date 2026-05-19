/**
 * @file Utilities for determining file types (text vs binary).
 *
 * Uses a known-extensions approach: extensions not in the binary set are
 * assumed to be text. This errs on the side of opening files as canvases
 * (which makes sense for the agent workspace — most files are source code).
 */

/** Extensions that are almost always binary (non-text) */
const BINARY_EXTENSIONS = new Set([
    // Images
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "bmp",
    "ico",
    "tiff",
    "tif",
    "svg", // often treated as text but rendered as image in sandbox
    // Audio
    "mp3",
    "wav",
    "ogg",
    "flac",
    "aac",
    "m4a",
    "wma",
    // Video
    "mp4",
    "avi",
    "mkv",
    "mov",
    "wmv",
    "webm",
    "flv",
    // Archives
    "zip",
    "tar",
    "gz",
    "bz2",
    "xz",
    "7z",
    "rar",
    "tgz",
    // Documents
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "odt",
    "ods",
    "odp",
    // Fonts
    "woff",
    "woff2",
    "ttf",
    "otf",
    "eot",
    // Compiled / binary data
    "exe",
    "dll",
    "so",
    "dylib",
    "bin",
    "dat",
    "db",
    "sqlite",
    "pyc",
    "class",
    "o",
    "obj",
    "wasm",
    // Disk images
    "iso",
    "dmg",
    "img",
]);

/**
 * Determine whether a file is likely text (editable as a canvas)
 * based on its extension.
 *
 * @param filePath - A filename or path with extension
 * @returns true if the file is likely text-based
 */
export function isTextFile(filePath: string): boolean {
    const lastDot = filePath.lastIndexOf(".");
    if (lastDot <= 0) return true; // no extension → assume text (e.g. Makefile)
    const ext = filePath.slice(lastDot + 1).toLowerCase();
    return !BINARY_EXTENSIONS.has(ext);
}
