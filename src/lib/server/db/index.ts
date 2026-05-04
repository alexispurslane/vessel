import Database from "better-sqlite3";
import { join } from "path";
import { SCHEMA, runMigrations } from "./schema.js";
import { safeJsonParse, tryJsonParse, stringArraySchema } from "$lib/utils.js";
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

/**
 * Get all conversations that have a given tag.
 * Uses LIKE to find candidate rows, then filters for exact tag matches
 * to avoid false positives (e.g. "python" matching "python3").
 */
export function getConversationsByTag(tag: string): import("$lib/types.js").ConversationListItem[] {
    const db = getDb();
    const normalizedTag = tag.toLowerCase();

    const rows = db
        .prepare(
            `SELECT id, title, tags, pinned, created_at, updated_at
             FROM conversations
             WHERE tags LIKE ?
             ORDER BY updated_at DESC`
        )
        .all(`%"${normalizedTag}"%`) as {
            id: string;
            title: string;
            tags: string;
            pinned: number;
            created_at: string;
            updated_at: string;
        }[];

    return rows
        .filter((row) => {
            try {
                const parsed = tryJsonParse(row.tags, stringArraySchema);
                return parsed.some((t) => t.toLowerCase() === normalizedTag);
            } catch {
                return false;
            }
        })
        .map((row) => ({
            id: row.id,
            title: row.title,
            tags: safeJsonParse(row.tags, stringArraySchema) ?? [],
            pinned: Boolean(row.pinned),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }));
}
