import bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import { getDb } from "../db/index.js";

const SALT_ROUNDS = 12;
const SESSION_TOKEN_BYTES = 32;

// --- User management ---

export function userExists(): boolean {
    const db = getDb();
    const row = db.prepare("SELECT id FROM auth LIMIT 1").get();
    return !!row;
}

export function getUsername(): string | null {
    const db = getDb();
    const row = db.prepare("SELECT username FROM auth WHERE id = 1").get() as
        | { username: string }
        | undefined;
    return row?.username ?? null;
}

export function createUser(username: string, password: string): void {
    const db = getDb();

    // DB-level guard: refuse if a user already exists
    if (userExists()) {
        throw new Error("User already exists");
    }

    const hash = bcrypt.hashSync(password, SALT_ROUNDS);
    db.prepare("INSERT INTO auth (id, username, password_hash) VALUES (1, ?, ?)").run(
        username,
        hash
    );
}

export function verifyUser(username: string, password: string): boolean {
    const db = getDb();
    const row = db.prepare("SELECT username, password_hash FROM auth WHERE id = 1").get() as
        | { username: string; password_hash: string }
        | undefined;

    if (!row) return false;
    if (row.username !== username) return false;

    return bcrypt.compareSync(password, row.password_hash);
}

// --- Session token management ---

export function createSession(): string {
    const db = getDb();
    const token = randomBytes(SESSION_TOKEN_BYTES).toString("hex");
    db.prepare("INSERT INTO web_sessions (token) VALUES (?)").run(token);
    return token;
}

export function validateSession(token: string): boolean {
    const db = getDb();
    const row = db.prepare("SELECT token FROM web_sessions WHERE token = ?").get(token) as
        | { token: string }
        | undefined;
    return !!row;
}

export function deleteSession(token: string): void {
    const db = getDb();
    db.prepare("DELETE FROM web_sessions WHERE token = ?").run(token);
}

// --- Cookie helpers ---

export const SESSION_COOKIE_NAME = "vessel_session";
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function sessionCookie(token: string): string {
    return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_COOKIE_MAX_AGE}`;
}

export function clearSessionCookie(): string {
    return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
