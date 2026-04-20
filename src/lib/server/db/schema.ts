/**
 * SQLite schema for Vessel.
 *
 * pi-coding-agent owns message/conversation history via .jsonl session files.
 * This DB only stores: auth, web sessions, provider config, custom models, settings, and conversation metadata.
 */

import type { Database as DatabaseType } from "better-sqlite3";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS web_sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS providers (
  provider TEXT PRIMARY KEY,
  encrypted_key TEXT NOT NULL,
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
 * Migrations for existing databases.
 * These ALTER TABLE statements add columns that were introduced after the initial schema.
 * Each is wrapped in a try/catch since the column may already exist.
 */
export function runMigrations(db: DatabaseType): void {
    // Column additions
    const columnMigrations = [
        "ALTER TABLE providers ADD COLUMN display_name TEXT",
        "ALTER TABLE providers ADD COLUMN models_endpoint TEXT",
    ];

    for (const sql of columnMigrations) {
        try {
            db.exec(sql);
        } catch {
            // Column already exists — ignore
        }
    }

    // Migrate custom_models to enforce unique model IDs (id as sole primary key).
    // Model IDs must be globally unique — each model belongs to exactly one provider.
    try {
        // Check if we still have the old composite PK (id, provider)
        const tableInfo = db.prepare("PRAGMA table_info(custom_models)").all() as { pk: number }[];
        const pkColumns = tableInfo.filter((col) => col.pk > 0);
        const hasCompositePk = pkColumns.length > 1;

        if (hasCompositePk) {
            // Recreate the table with `id` as sole primary key.
            // If there are duplicate IDs across providers, we keep the last one inserted
            // (INSERT OR REPLACE semantics) and log a warning.
            const duplicates = db
                .prepare("SELECT id, COUNT(*) as cnt FROM custom_models GROUP BY id HAVING cnt > 1")
                .all() as { id: string; cnt: number }[];

            if (duplicates.length > 0) {
                console.warn(
                    `[migration] custom_models has duplicate model IDs: ${duplicates.map((d) => d.id).join(", ")}. ` +
                    `Keeping the most recently inserted row for each duplicate.`
                );
            }

            db.exec(`
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
            db.exec(`
        INSERT OR REPLACE INTO custom_models_new
        SELECT id, provider, name, api, base_url, reasoning, input_types,
               context_window, max_tokens, cost_input, cost_output,
               cost_cache_read, cost_cache_write, compat
        FROM custom_models;
      `);

            db.exec("DROP TABLE custom_models;");
            db.exec("ALTER TABLE custom_models_new RENAME TO custom_models;");
        }
    } catch (e) {
        console.error("[migration] Failed to migrate custom_models to unique model IDs:", e);
        throw e;
    }

    // Backfill tags table from existing conversations
    // Each conversation stores tags as a JSON array of strings in the `tags` column.
    // Extract all unique tag values and insert them into the `tags` table.
    try {
        const tableExists = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tags'")
            .get();
        if (tableExists) {
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
                try {
                    const parsed = JSON.parse(row.tags) as string[];
                    if (Array.isArray(parsed)) {
                        for (const tag of parsed) {
                            if (typeof tag === "string" && tag.trim()) {
                                allTags.push(tag.trim().toLowerCase());
                            }
                        }
                    }
                } catch {
                    // Skip malformed JSON
                }
            }
            if (allTags.length > 0) {
                insertMany([...new Set(allTags)]);
                console.log(`[migration] Backfilled ${allTags.length} unique tags into tags table`);
            }
        }
    } catch (e) {
        console.error("[migration] Failed to backfill tags table:", e);
        throw e;
    }
}
