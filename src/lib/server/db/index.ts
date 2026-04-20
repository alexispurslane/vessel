import Database from "better-sqlite3";
import { join } from "path";
import { SCHEMA, runMigrations } from "./schema.js";
import type { Database as DatabaseType } from "better-sqlite3";

const DB_PATH = join(process.cwd(), "data", "talkai.db");

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
