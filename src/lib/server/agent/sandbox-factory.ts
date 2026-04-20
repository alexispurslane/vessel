/**
 * Per-session zerobox sandbox factory.
 *
 * Each conversation gets an isolated sandbox that controls:
 * - Filesystem: agent can only read/write within its workspace
 * - Network: denied by default (tools shouldn't need network; AI inference runs outside the sandbox)
 * - Snapshots: filesystem changes are recorded for audit and undo
 *
 * Note: pi-coding-agent's model inference runs in the main process, NOT inside
 * the sandbox. Only tool execution (bash, read, write, etc.) goes through zerobox.
 * So AI provider domains and API keys are irrelevant here — they never traverse
 * the sandbox boundary.
 *
 * Settings are stored in the DB `settings` table under keys prefixed with `sandbox.`
 * and are loaded when creating a new sandbox. See the "Sandbox" tab in Settings
 * for the UI to configure these.
 */

import { Sandbox, type SecretConfig } from "zerobox";
import { resolve } from "path";
import { mkdirSync } from "fs";
import { getDb } from "../db/index.js";
import type { ConversationSettings } from "$lib/types.js";

// --- Constants ---

const DATA_DIR = resolve(process.cwd(), "data");
const SESSIONS_DIR = resolve(DATA_DIR, "sessions");

// --- DB settings keys ---

/** Settings keys used for sandbox configuration. Stored in the `settings` table. */
export const SANDBOX_SETTINGS_KEYS = {
    /** Whether sandboxing is enabled (default: true) */
    ENABLED: "sandbox.enabled",
    /** JSON array of extra readable paths */
    EXTRA_READ_PATHS: "sandbox.extraReadPaths",
    /** JSON array of extra writable paths */
    EXTRA_WRITE_PATHS: "sandbox.extraWritePaths",
    /** Whether network access is allowed ("true"/"false") */
    ALLOW_NET: "sandbox.allowNet",
    /** JSON array of allowed network domains (used when allowNet is true) */
    ALLOWED_NET_DOMAINS: "sandbox.allowedNetDomains",
    /** JSON object of secrets: { ENV_VAR_NAME: { value: string, hosts: string[] } } */
    SECRETS: "sandbox.secrets",
    /** Whether snapshot is enabled (default: true) */
    SNAPSHOT_ENABLED: "sandbox.snapshotEnabled",
    /** JSON array of environment variable names to allow */
    ALLOW_ENV: "sandbox.allowEnv",
} as const;

// --- Types ---

export interface SandboxPolicy {
    /** Paths the agent can write to (in addition to its session workspace) */
    extraWritePaths?: string[];
    /** Paths the agent can read from (in addition to project cwd and session workspace) */
    extraReadPaths?: string[];
    /** Whether to allow network access for tool execution */
    allowNet?: boolean | string[];
    /** Whether to snapshot filesystem changes for audit/undo */
    snapshot: boolean;
    /** Secrets to inject (env var name → { value, hosts }) */
    secrets?: Record<string, SecretConfig>;
    /** Environment variable names to allow in the sandbox */
    allowEnv?: string[];
}

// --- DB helpers ---

/**
 * Load a sandbox setting from the DB, returning undefined if not found.
 */
function getSetting(key: string): string | undefined {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
    return row?.value;
}

/**
 * Parse a JSON setting from the DB, with a fallback default.
 */
function getJsonSetting<T>(key: string, fallback: T): T {
    const raw = getSetting(key);
    if (raw === undefined || raw === "") return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

/**
 * Load the full sandbox policy from DB settings, with optional per-conversation overrides.
 *
 * Per-conversation settings (from `conversation_settings` table) override global settings.
 * A null value in the conversation settings means "use the global default."
 *
 * Returns null if sandboxing is disabled (either globally or per-conversation).
 */
export function loadSandboxPolicyFromDb(conversationSettings?: ConversationSettings | null): SandboxPolicy | null {
    // Per-conversation sandboxEnabled takes precedence; null = use global default
    const globalEnabled = getSetting(SANDBOX_SETTINGS_KEYS.ENABLED);
    const enabled = conversationSettings?.sandboxEnabled ?? (globalEnabled !== "false");
    if (!enabled) return null;

    // Per-conversation overrides: null = use global, otherwise use the conversation value
    const globalExtraReadPaths = getJsonSetting<string[]>(
        SANDBOX_SETTINGS_KEYS.EXTRA_READ_PATHS,
        []
    );
    const globalExtraWritePaths = getJsonSetting<string[]>(
        SANDBOX_SETTINGS_KEYS.EXTRA_WRITE_PATHS,
        []
    );
    const globalAllowNetRaw = getSetting(SANDBOX_SETTINGS_KEYS.ALLOW_NET);
    const globalAllowedNetDomains = getJsonSetting<string[]>(
        SANDBOX_SETTINGS_KEYS.ALLOWED_NET_DOMAINS,
        []
    );
    const globalSecrets = getJsonSetting<Record<string, SecretConfig>>(
        SANDBOX_SETTINGS_KEYS.SECRETS,
        {}
    );
    const snapshotEnabled = getSetting(SANDBOX_SETTINGS_KEYS.SNAPSHOT_ENABLED) !== "false";
    const globalAllowEnv = getJsonSetting<string[]>(
        SANDBOX_SETTINGS_KEYS.ALLOW_ENV,
        ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "NODE_ENV"]
    );

    // Merge per-conversation overrides with global defaults
    const extraReadPaths = conversationSettings?.extraReadPaths ?? globalExtraReadPaths;
    const extraWritePaths = conversationSettings?.extraWritePaths ?? globalExtraWritePaths;
    const allowEnv = conversationSettings?.allowEnv ?? globalAllowEnv;
    const secrets = conversationSettings?.secrets ?? globalSecrets;

    // Determine allowNet: conversation override takes precedence
    let allowNet: boolean | string[];
    if (conversationSettings?.allowNet !== null && conversationSettings?.allowNet !== undefined) {
        // Per-conversation override is set
        if (conversationSettings.allowNet === false) {
            allowNet = false;
        } else {
            // allowNet is true-ish — use conversation domains if set, else global domains, else true
            const domains = conversationSettings.allowedNetDomains ?? globalAllowedNetDomains;
            allowNet = domains.length > 0 ? domains : true;
        }
    } else {
        // Use global allowNet
        if (globalAllowNetRaw === "true") {
            allowNet = globalAllowedNetDomains.length > 0 ? globalAllowedNetDomains : true;
        } else {
            allowNet = false;
        }
    }

    // Determine allowedNetDomains for secrets host matching
    const allowedNetDomains = conversationSettings?.allowedNetDomains ?? globalAllowedNetDomains;

    return {
        extraReadPaths,
        extraWritePaths,
        allowNet,
        snapshot: snapshotEnabled,
        secrets: Object.keys(secrets).length > 0 ? secrets : undefined,
        allowEnv,
    };
}

// --- Public API ---

/**
 * Create a per-session zerobox sandbox for a conversation.
 *
 * The sandbox isolates the agent's tool execution so that:
 * - Writes are confined to the session workspace
 * - Reads are allowed from the project cwd and session workspace
 * - Network is denied by default (AI inference runs outside the sandbox)
 * - Filesystem changes are snapshotted for audit
 *
 * Returns null if sandboxing is disabled in settings.
 */
export function createSessionSandbox(
    conversationId: string,
    conversationSettings?: ConversationSettings | null
): Sandbox | null {
    const policy = loadSandboxPolicyFromDb(conversationSettings);

    // If policy is null, sandboxing is disabled
    if (policy === null) return null;

    const sessionWorkDir = resolve(SESSIONS_DIR, conversationId, "workspace");
    mkdirSync(sessionWorkDir, { recursive: true });

    const projectCwd = process.cwd();

    const sandbox = Sandbox.create({
        cwd: sessionWorkDir,
        // Allow reads from the project and session workspace
        allowRead: [projectCwd, sessionWorkDir, ...(policy.extraReadPaths ?? [])],
        // Allow writes only to the session workspace (plus any extra paths)
        allowWrite: [sessionWorkDir, ...(policy.extraWritePaths ?? [])],
        // Block writes to .git to prevent accidental repo corruption
        denyWrite: [resolve(projectCwd, ".git")],
        // Network: configured by policy (false, true, or specific domains)
        allowNet: policy.allowNet ?? false,
        // Snapshot filesystem changes for audit/undo
        snapshot: policy.snapshot,
        snapshotPaths: [sessionWorkDir],
        snapshotExclude: ["node_modules", ".git"],
        // Environment: configured by policy
        allowEnv: policy.allowEnv ?? ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "NODE_ENV"],
        // Secrets: optional credential injection
        secrets: policy.secrets,
    });

    return sandbox;
}

/**
 * Get the session workspace directory for a conversation.
 * This is where the agent's sandboxed file operations are rooted.
 */
export function getSessionWorkDir(conversationId: string): string {
    return resolve(SESSIONS_DIR, conversationId, "workspace");
}

/**
 * Load per-conversation settings from the conversation_settings table.
 * Returns null if no row exists (meaning: all defaults apply, inherit from global).
 */
export function loadConversationSettingsFromDb(conversationId: string): ConversationSettings | null {
    const db = getDb();
    const row = db
        .prepare("SELECT settings FROM conversation_settings WHERE conversation_id = ?")
        .get(conversationId) as { settings: string } | undefined;
    if (!row) return null;
    try {
        return JSON.parse(row.settings) as ConversationSettings;
    } catch {
        return null;
    }
}

/**
 * Save per-conversation settings to the conversation_settings table.
 */
export function saveConversationSettingsToDb(conversationId: string, settings: ConversationSettings): void {
    const db = getDb();
    db.prepare(
        `INSERT INTO conversation_settings (conversation_id, settings) VALUES (?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET settings = excluded.settings`
    ).run(conversationId, JSON.stringify(settings));
}
