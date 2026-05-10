/**
 * @file Centralized data directory resolution and initialization.
 *
 * All server modules that need the data directory (for the SQLite DB,
 * session JSONL files, agent workspace, MCP config, etc.) should import
 * from here instead of computing their own path.
 *
 * The data directory is resolved from the `VESSEL_DATA_DIR` environment
 * variable, falling back to `<cwd>/data` if unset. It is auto-created
 * on first access via `mkdirSync({ recursive: true })`.
 */

import { resolve } from "path";
import { mkdirSync } from "node:fs";

/**
 * Resolved data directory path.
 *
 * Reads `VESSEL_DATA_DIR` from the environment, falling back to
 * `<cwd>/data`. Created on first import if it doesn't exist.
 */
export const DATA_DIR: string = resolve(
    process.env.VESSEL_DATA_DIR || resolve(process.cwd(), "data"),
);

mkdirSync(DATA_DIR, { recursive: true });

/** Path to the sessions directory inside the data directory. */
export const SESSIONS_DIR: string = resolve(DATA_DIR, "sessions");

/** Path to the agent directory inside the data directory. */
export const AGENT_DIR: string = resolve(DATA_DIR, "agent");
