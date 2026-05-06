/**
 * @file Simple structured logger with log levels.
 *
 * Set LOG_LEVEL environment variable to control verbosity:
 * - "debug": everything
 * - "info": info, warn, error (default in development)
 * - "warn": warn, error
 * - "error": error only (default in production)
 *
 * Debug logs are stripped in production builds if LOG_LEVEL is not set.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const DEFAULT_LEVEL: LogLevel = process.env.NODE_ENV === "production" ? "error" : "debug";

function getCurrentLevel(): LogLevel {
    const env = process.env.LOG_LEVEL as LogLevel | undefined;
    if (env && env in LOG_LEVELS) return env;
    return DEFAULT_LEVEL;
}

function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[getCurrentLevel()];
}

function formatMessage(level: LogLevel, context: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}`;
}

export const log = {
    debug(context: string, message: string, ...args: unknown[]): void {
        if (shouldLog("debug")) {
            console.debug(formatMessage("debug", context, message), ...args);
        }
    },

    info(context: string, message: string, ...args: unknown[]): void {
        if (shouldLog("info")) {
            console.info(formatMessage("info", context, message), ...args);
        }
    },

    warn(context: string, message: string, ...args: unknown[]): void {
        if (shouldLog("warn")) {
            console.warn(formatMessage("warn", context, message), ...args);
        }
    },

    error(context: string, message: string, ...args: unknown[]): void {
        if (shouldLog("error")) {
            console.error(formatMessage("error", context, message), ...args);
        }
    },
};
