/**
 * @file Safe filesystem operations with logging.
 *
 * Wraps Bun file operations (delete file, delete directory) with existence checks,
 * try/catch, and structured logging — so callers don't need to nest error handling.
 */
import { rm } from "node:fs/promises";
import { log } from "$lib/server/logger.js";

/**
 * Safely delete a file, logging success or failure.
 *
 * @param path - The file path to delete
 * @param label - A human-readable label for log messages
 * @returns {void}
 */
export async function safeDeleteFile(path: string, label: string): Promise<void> {
    const file = Bun.file(path);
    if (!(await file.exists())) return;
    try {
        await file.unlink();
        log.info("session-store", `Deleted ${label}: ${path}`);
    } catch (err) {
        log.error("session-store", `Failed to delete ${label} ${path}`, err);
    }
}

/**
 * Safely delete a directory recursively, logging success or failure.
 *
 * @param path - The directory path to delete
 * @param label - A human-readable label for log messages
 * @returns {void}
 */
export async function safeDeleteDir(path: string, label: string): Promise<void> {
    const dirExists = await Bun.file(path).exists();
    if (!dirExists) return;
    try {
        await rm(path, { recursive: true });
        log.info("session-store", `Deleted ${label}: ${path}`);
    } catch (err) {
        log.error("session-store", `Failed to delete ${label} ${path}`, err);
    }
}
