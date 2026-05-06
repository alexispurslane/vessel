/**
 * @file SQLite schema for Vessel.
 *
 * pi-coding-agent owns message/conversation history via .jsonl session files.
 * This DB only stores: auth, web sessions, provider config, custom models, settings, and conversation metadata.
 */

import type { Database as DatabaseType } from "bun:sqlite";
import { tryJsonParse, stringArraySchema } from "$lib/utils.js";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS providers (
  provider TEXT PRIMARY KEY,
  -- API keys are stored unencrypted. Security relies on filesystem-level
  -- protection of the SQLite DB file. This is acceptable for a single-user
  -- self-hosted application, but the DB file must not be exposed publicly.
  api_key TEXT NOT NULL,
  base_url TEXT,
  display_name TEXT,
  models_endpoint TEXT
);

CREATE TABLE IF NOT EXISTS custom_models (
  id TEXT NOT NULL PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  api TEXT NOT NULL DEFAULT 'openai-completions',
  base_url TEXT NOT NULL,
  reasoning INTEGER NOT NULL DEFAULT 0,
  input_types TEXT NOT NULL DEFAULT '["text"]',
  context_window INTEGER NOT NULL DEFAULT 128000,
  max_tokens INTEGER NOT NULL DEFAULT 16384,
  cost_input REAL NOT NULL DEFAULT 0,
  cost_output REAL NOT NULL DEFAULT 0,
  cost_cache_read REAL NOT NULL DEFAULT 0,
  cost_cache_write REAL NOT NULL DEFAULT 0,
  compat TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New Chat',
  tags TEXT NOT NULL DEFAULT '[]',
  session_file_path TEXT NOT NULL,
  model_provider TEXT,
  model_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
  name TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_settings (
  conversation_id TEXT NOT NULL PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  settings JSON NOT NULL DEFAULT '{}'
);
`;

/**
 * Migrate custom_models to enforce unique model IDs (id as sole primary key).
 * Model IDs must be globally unique — each model belongs to exactly one provider.
 *
 * @param db - The SQLite database instance
 */
export function migrateCustomModelsPk(db: DatabaseType): void {
    // Check if we still have the old composite PK (id, provider)
    const tableInfo = db.prepare("PRAGMA table_info(custom_models)").all() as { pk: number }[];
    const pkColumns = tableInfo.filter((col) => col.pk > 0);
    const hasCompositePk = pkColumns.length > 1;

    if (hasCompositePk) {
        // Recreate the table with `id` as sole primary key.
        // Duplicates keep the last row (INSERT OR REPLACE) and log a warning.
        const duplicates = db
            .prepare("SELECT id, COUNT(*) as cnt FROM custom_models GROUP BY id HAVING cnt > 1")
            .all() as { id: string; cnt: number }[];

        if (duplicates.length > 0) {
            console.warn(
                `[migration] custom_models has duplicate model IDs: ${duplicates.map((d) => d.id).join(", ")}. ` +
                `Keeping the most recently inserted row for each duplicate.`
            );
        }

        db.run(`
      CREATE TABLE IF NOT EXISTS custom_models_new (
        id TEXT NOT NULL PRIMARY KEY,
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        api TEXT NOT NULL DEFAULT 'openai-completions',
        base_url TEXT NOT NULL,
        reasoning INTEGER NOT NULL DEFAULT 0,
        input_types TEXT NOT NULL DEFAULT '["text"]',
        context_window INTEGER NOT NULL DEFAULT 128000,
        max_tokens INTEGER NOT NULL DEFAULT 16384,
        cost_input REAL NOT NULL DEFAULT 0,
        cost_output REAL NOT NULL DEFAULT 0,
        cost_cache_read REAL NOT NULL DEFAULT 0,
        cost_cache_write REAL NOT NULL DEFAULT 0,
        compat TEXT
      );
    `);

        // INSERT OR REPLACE keeps the last row for duplicate IDs
        db.run(`
      INSERT OR REPLACE INTO custom_models_new
      SELECT id, provider, name, api, base_url, reasoning, input_types,
             context_window, max_tokens, cost_input, cost_output,
             cost_cache_read, cost_cache_write, compat
      FROM custom_models;
    `);

        db.run("DROP TABLE custom_models;");
        db.run("ALTER TABLE custom_models_new RENAME TO custom_models;");
    }
}

/**
 * Parse tags from a single conversation row's JSON `tags` column.
 *
 * @param tagsJson - The raw JSON string from the `tags` column.
 * @returns An array of trimmed, lowercased tag strings.
 */
function parseTagsFromRow(tagsJson: string): string[] {
    try {
        const parsed = tryJsonParse(tagsJson, stringArraySchema);
        const result: string[] = [];
        for (const tag of parsed) {
            const trimmed = tag.trim().toLowerCase();
            if (trimmed) result.push(trimmed);
        }
        return result;
    } catch {
        // Skip malformed JSON
        return [];
    }
}

/**
 * Backfill tags table from existing conversations.
 * Each conversation stores tags as a JSON array in the `tags` column.
 *
 * @param db - The SQLite database instance
 */
export function backfillTags(db: DatabaseType): void {
    const tableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tags'")
        .get();
    if (!tableExists) return;

    const rows = db
        .prepare("SELECT tags FROM conversations WHERE tags != '[]'")
        .all() as { tags: string }[];
    const insertTag = db.prepare(
        "INSERT OR IGNORE INTO tags (name) VALUES (?)"
    );
    const insertMany = db.transaction((tags: string[]) => {
        for (const tag of tags) {
            insertTag.run(tag);
        }
    });
    const allTags: string[] = [];
    for (const row of rows) {
        allTags.push(...parseTagsFromRow(row.tags));
    }
    if (allTags.length > 0) {
        insertMany([...new Set(allTags)]);
        console.log(`[migration] Backfilled ${String(allTags.length)} unique tags into tags table`);
    }
}

/**
 * Migrations for existing databases.
 * These ALTER TABLE statements add columns that were introduced after the initial schema.
 * Each is wrapped in a try/catch since the column may already exist.
 *
 * @param db - The SQLite database instance
 */
export function runMigrations(db: DatabaseType): void {
    // Drop deprecated web_sessions table (auth now uses JWTs, not DB-stored tokens)
    try {
        db.run("DROP TABLE IF EXISTS web_sessions");
    } catch {
        // Table doesn't exist — ignore
    }

    // Column additions
    const columnMigrations = [
        "ALTER TABLE providers ADD COLUMN display_name TEXT",
        "ALTER TABLE providers ADD COLUMN models_endpoint TEXT",
        "ALTER TABLE auth ADD COLUMN pronouns TEXT",
        "ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
    ];

    for (const sql of columnMigrations) {
        try {
            db.run(sql);
        } catch {
            // Column already exists — ignore
        }
    }

    // Rename encrypted_key → api_key (the column was misleadingly named;
    // keys have never been encrypted, just stored as-is).
    try {
        db.run("ALTER TABLE providers RENAME COLUMN encrypted_key TO api_key");
    } catch {
        // Column already renamed — ignore
    }

    // Migrate custom_models to enforce unique model IDs (id as sole primary key).
    try {
        migrateCustomModelsPk(db);
    } catch (e) {
        console.error("[migration] Failed to migrate custom_models to unique model IDs:", e);
        throw e;
    }

    // Backfill tags table from existing conversations.
    try {
        backfillTags(db);
    } catch (e) {
        console.error("[migration] Failed to backfill tags table:", e);
        throw e;
    }
}
