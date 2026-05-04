/**
 * Safe filesystem operations with logging.
 *
 * Wraps fs operations (delete file, delete directory) with existence checks,
 * try/catch, and structured logging — so callers don't need to nest error handling.
 */
import { existsSync, rmSync } from "fs";
import { log } from "$lib/server/logger.js";

/** Safely delete a file, logging success or failure. */
export function safeDeleteFile(path: string, label: string): void {
    if (!existsSync(path)) return;
    try {
        rmSync(path);
        log.info("session-store", `Deleted ${label}: ${path}`);
    } catch (err) {
        log.error("session-store", `Failed to delete ${label} ${path}`, err);
    }
}

/** Safely delete a directory recursively, logging success or failure. */
export function safeDeleteDir(path: string, label: string): void {
    if (!existsSync(path)) return;
    try {
        rmSync(path, { recursive: true });
        log.info("session-store", `Deleted ${label}: ${path}`);
    } catch (err) {
        log.error("session-store", `Failed to delete ${label} ${path}`, err);
    }
}
