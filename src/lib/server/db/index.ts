import Database from "better-sqlite3";
import { join } from "path";
import { SCHEMA, runMigrations } from "./schema.js";
import type { Database as DatabaseType } from "better-sqlite3";

const DB_PATH = join(process.cwd(), "data", "vessel.db");

let _db: DatabaseType | null = null;

export function getDb(): DatabaseType {
    if (_db) return _db;

    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");

    // Run schema migration
    _db.exec(SCHEMA);

    // Run incremental migrations for existing databases
    runMigrations(_db);

    return _db;
}

export function closeDb(): void {
    if (_db) {
        _db.close();
        _db = null;
    }
}

/**
 * Get all unique tag names from the tags table, sorted alphabetically.
 */
export function getAllTags(): string[] {
    const db = getDb();
    const rows = db.prepare("SELECT name FROM tags ORDER BY name").all() as { name: string }[];
    return rows.map((r) => r.name);
}

/**
 * Upsert tags into the tags table.
 * Ensures each tag exists in the global tags table for AI tag suggestions.
 */
export function upsertTags(tags: string[]): void {
    if (tags.length === 0) return;
    const db = getDb();
    const insert = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
    const insertMany = db.transaction((tagList: string[]) => {
        for (const tag of tagList) {
            const normalized = tag.trim().toLowerCase();
            if (normalized) {
                insert.run(normalized);
            }
        }
    });
    insertMany(tags);
}
