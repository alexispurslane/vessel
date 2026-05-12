/**
 * @file User authentication: bcrypt passwords, JWT sessions, and cookie management.
 */

import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import * as jose from "jose";
import { getDb } from "../db/index.js";

const SALT_ROUNDS = 12;

// --- JWT secret management ---

let jwtSecret: Uint8Array | undefined;

/**
 * Get or lazily initialize the JWT signing secret.
 * Uses JWT_SECRET env var if set, otherwise generates a random secret.
 * @returns The JWT signing key as a Uint8Array
 */
function getJwtSecret(): Uint8Array {
    if (jwtSecret) return jwtSecret;
    const envSecret = process.env.JWT_SECRET;
    if (envSecret) {
        jwtSecret = new TextEncoder().encode(envSecret);
    } else {
        // Generate a random secret on first use if not configured.
        // Tokens are invalid after a restart (acceptable for single-user).

        // oxlint-disable-next-line secure-coding/no-sensitive-data-exposure
        console.warn(
            // log mentions 'secret' conceptually, no actual value exposed
            // oxlint-disable-next-line secure-coding/no-sensitive-data-exposure
            "[auth] JWT_SECRET not set — using random secret. Tokens will not survive server restarts."
        );
        jwtSecret = randomBytes(32);
    }
    return jwtSecret;
}

// --- User management ---

export function userExists(): boolean {
    const db = getDb();
    const row = db.query("SELECT id FROM auth LIMIT 1").get();
    return !!row;
}

export function getUsername(): string | null {
    const db = getDb();
    const row = db.query("SELECT username FROM auth WHERE id = 1").get() as
        | { username: string }
        | undefined;
    return row?.username ?? null;
}

/**
 * Create the single user account. Refuses if a user already exists.
 * @param username - The username to create
 * @param password - The plaintext password (hashed before storage)
 * @returns {void}
 */
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

/**
 * Verify a username and password against the stored credentials.
 * @param username - The username to check
 * @param password - The plaintext password to verify
 * @returns Whether both username and password match
 */
export function verifyUser(username: string, password: string): boolean {
    const db = getDb();
    const row = db.query("SELECT username, password_hash FROM auth WHERE id = 1").get() as
        | { username: string; password_hash: string }
        | undefined;

    if (!row) return false;
    if (row.username !== username) return false;

    return bcrypt.compareSync(password, row.password_hash);
}

/**
 * Verify password without checking username.
 * Since there is only one user, the username check is redundant for login.
 * @param password - The plaintext password to verify
 * @returns Whether the password matches the stored hash
 */
export function verifyPassword(password: string): boolean {
    const db = getDb();
    const row = db.query("SELECT password_hash FROM auth WHERE id = 1").get() as
        | { password_hash: string }
        | undefined;

    if (!row) return false;
    return bcrypt.compareSync(password, row.password_hash);
}

export function getPronouns(): string | null {
    const db = getDb();
    const row = db.query("SELECT pronouns FROM auth WHERE id = 1").get() as
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

/**
 * Create a signed JWT session token for the given username.
 * @param username - The username to encode in the token
 * @returns The signed JWT string
 */
export async function createSessionToken(username: string): Promise<string> {
    const secret = getJwtSecret();
    // oxlint-disable-next-line jwt/require-expiration
    const jwt = await new jose.SignJWT({ username })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(username)
        .setIssuedAt()
        .setExpirationTime("30d")
        .sign(secret);
    return jwt;
}

/**
 * Validate a JWT session token and extract the username.
 * @param token - The JWT token string to validate
 * @returns The decoded username, or null if invalid/expired
 */
export async function validateSessionToken(token: string): Promise<{ username: string } | null> {
    try {
        const secret = getJwtSecret();
        const { payload } = await jose.jwtVerify(token, secret, {
            algorithms: ["HS256"],
        });
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
    return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${String(SESSION_COOKIE_MAX_AGE)}`;
}

export function clearSessionCookie(): string {
    return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`;
}
