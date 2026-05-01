import bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import * as jose from "jose";
import { getDb } from "../db/index.js";

const SALT_ROUNDS = 12;

// --- JWT secret management ---

let jwtSecret: Uint8Array | undefined;

function getJwtSecret(): Uint8Array {
    if (jwtSecret) return jwtSecret;
    const envSecret = process.env.JWT_SECRET;
    if (envSecret) {
        jwtSecret = new TextEncoder().encode(envSecret);
    } else {
        // Generate a random secret on first use if not configured.
        // This means tokens are invalid after a server restart,
        // which is acceptable for a single-user app.
        console.warn(
            "[auth] JWT_SECRET not set — using random secret. Tokens will not survive server restarts."
        );
        jwtSecret = randomBytes(32);
    }
    return jwtSecret;
}

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

/**
 * Verify password without checking username.
 * Since there is only one user, the username check is redundant for login.
 */
export function verifyPassword(password: string): boolean {
    const db = getDb();
    const row = db.prepare("SELECT password_hash FROM auth WHERE id = 1").get() as
        | { password_hash: string }
        | undefined;

    if (!row) return false;
    return bcrypt.compareSync(password, row.password_hash);
}

export function getPronouns(): string | null {
    const db = getDb();
    const row = db.prepare("SELECT pronouns FROM auth WHERE id = 1").get() as
        | { pronouns: string | null }
        | undefined;
    return row?.pronouns ?? null;
}

export function updateUsername(newUsername: string): void {
    const db = getDb();
    db.prepare("UPDATE auth SET username = ? WHERE id = 1").run(newUsername);
}

export function updatePassword(newPassword: string): void {
    const db = getDb();
    const hash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
    db.prepare("UPDATE auth SET password_hash = ? WHERE id = 1").run(hash);
}

export function updatePronouns(newPronouns: string | null): void {
    const db = getDb();
    db.prepare("UPDATE auth SET pronouns = ? WHERE id = 1").run(newPronouns);
}

// --- JWT session token management ---

export async function createSessionToken(username: string): Promise<string> {
    const secret = getJwtSecret();
    const jwt = await new jose.SignJWT({ username })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(username)
        .setIssuedAt()
        .setExpirationTime("30d")
        .sign(secret);
    return jwt;
}

export async function validateSessionToken(token: string): Promise<{ username: string } | null> {
    try {
        const secret = getJwtSecret();
        const { payload } = await jose.jwtVerify(token, secret);
        if (typeof payload.sub === "string") {
            return { username: payload.sub };
        }
        return null;
    } catch {
        // Token is invalid, expired, or malformed
        return null;
    }
}

// --- Cookie helpers ---

export const SESSION_COOKIE_NAME = "vessel_session";
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function sessionCookie(token: string): string {
    return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${SESSION_COOKIE_MAX_AGE}`;
}

export function clearSessionCookie(): string {
    return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`;
}
