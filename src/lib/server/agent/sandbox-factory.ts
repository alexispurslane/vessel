/**
 * @file Per-session zerobox sandbox factory.
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
import { mkdir } from "node:fs/promises";
import { getDb } from "../db/index.js";
import { tryJsonParse } from "$lib/utils.js";
import { type ConversationSettings, conversationSettingsSchema } from "$lib/types.js";
import { log } from "$lib/server/logger.js";
import { SESSIONS_DIR } from "$lib/server/data-dir.js";

// --- Constants ---

const IS_LINUX = process.platform === "linux";

// --- Linux bash config workaround ---

/**
 * System-level bash config paths on Linux.
 *
 * These are always available at fixed paths regardless of the user's HOME.
 */
const LINUX_SYSTEM_BASH_CONFIGS: readonly string[] = [
    "/etc/profile",
    "/etc/bash.bashrc",
    "/etc/profile.d",
];

/**
 * Basenames of user-level bash config files under $HOME.
 *
 * These are joined with HOME at runtime to produce absolute paths.
 */
const USER_BASH_CONFIG_BASENAMES: readonly string[] = [
    ".bashrc",
    ".bash_profile",
    ".profile",
    ".bash_login",
    ".bash_logout",
];

/**
 * Return bash configuration file paths for the current platform.
 *
 * On Linux, returns system-level paths (e.g. `/etc/profile`) and user-level
 * paths under $HOME (e.g. `$HOME/.bashrc`) so the sandboxed child process
 * can read them directly from the filesystem in read-only mode. This avoids
 * a race condition in Codex's sandbox runtime where file descriptors passed
 * by the parent process can become invalid during the policy handoff
 * (see openai/codex#18337).
 *
 * On non-Linux platforms, returns an empty array — macOS uses Seatbelt which
 * doesn't have this race condition.
 *
 * @returns Array of absolute paths to bash config files (Linux only).
 */
function linuxBashConfigPaths(): string[] {
    if (!IS_LINUX) return [];

    const home = process.env.HOME;
    const userPaths = home
        ? USER_BASH_CONFIG_BASENAMES.map((name) => resolve(home, name))
        : [];

    return [...LINUX_SYSTEM_BASH_CONFIGS, ...userPaths];
}

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
    /** Whether all domains are allowed when network is on ("true"/"false") */
    ALLOW_ALL_DOMAINS: "sandbox.allowAllDomains",
    /** JSON array of allowed network domains (used when allowNet is true and allowAllDomains is false) */
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
    /** Paths the agent can read from (in addition to deps dir and session workspace) */
    extraReadPaths?: string[];
    /** Whether to allow network access for tool execution */
    allowNet?: boolean | string[];
    /** Whether to allow all domains when network is on (false = use specific domains from allowNet) */
    allowAllDomains?: boolean;
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
 *
 * @param key - The settings key to look up.
 * @returns The setting value, or undefined if not found.
 */
function getSetting(key: string): string | undefined {
    const db = getDb();
    const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
    return row?.value;
}

/**
 * Parse a JSON setting from the DB, with a fallback default.
 *
 * @param key - The settings key to look up.
 * @param fallback - Default value if the key is missing or unparseable.
 * @returns The parsed setting value, or the fallback.
 */
function getJsonSetting<T>(key: string, fallback: T): T {
    const raw = getSetting(key);
    if (raw === undefined || raw === "") return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch (e) {
        log.debug("sandbox", "Failed to parse sandbox setting JSON, using fallback", e);
        return fallback;
    }
}

/**
 * Resolve a per-conversation override, falling back to the global default.
 *
 * Returns the conversation value if it is non-null and non-undefined;
 * otherwise returns the global value.
 *
 * @param conversationValue - Per-conversation override (null/undefined = use global).
 * @param globalValue - The global default value.
 * @returns The resolved value.
 */
function resolveOverride<T>(conversationValue: T | null | undefined, globalValue: T): T {
    return conversationValue !== null && conversationValue !== undefined
        ? conversationValue
        : globalValue;
}

/** Input for resolving the `allowNet` policy from conversation overrides and global settings. */
interface ResolveAllowNetInput {
    /** Per-conversation allowNet override (null/undefined = use global). */
    conversationAllowNet: boolean | null | undefined;
    /** Per-conversation allowed domains (used when conversation allowNet is true). */
    conversationAllowedNetDomains: string[] | null | undefined;
    /** Global raw allowNet setting string ("true"/"false"/undefined). */
    globalAllowNetRaw: string | undefined;
    /** Global allowed domains list. */
    globalAllowedNetDomains: string[];
    /** Whether all domains are allowed when net is on. */
    allowAllDomains: boolean;
}

/**
 * Resolve the `allowNet` policy from conversation overrides and global settings.
 *
 * Per-conversation `allowNet` takes precedence; if not set, the global raw
 * string value ("true"/"false"/undefined) is used.  When network access is
 * granted and `allowAllDomains` is true the result is `true`; otherwise a
 * specific domain list is returned (or `true` if no domains are configured,
 * which effectively means allow-all as a fallback).
 *
 * @param input - The resolved network policy input.
 * @returns The resolved network policy: false, true, or a domain list.
 */
function resolveAllowNet(input: ResolveAllowNetInput): boolean | string[] {
    const { conversationAllowNet, conversationAllowedNetDomains, globalAllowNetRaw, globalAllowedNetDomains, allowAllDomains } = input;
    let result: boolean | string[];

    // Per-conversation override takes precedence
    if (conversationAllowNet !== null && conversationAllowNet !== undefined) {
        if (!conversationAllowNet) {
            result = false;
        } else {
            result = allowAllDomains
                ? true
                : resolveNetDomains(conversationAllowedNetDomains ?? globalAllowedNetDomains);
        }
    } else if (globalAllowNetRaw === "true") {
        result = allowAllDomains
            ? true
            : resolveNetDomains(globalAllowedNetDomains);
    } else {
        result = false;
    }

    return result;
}

/**
 * Return the net domain list, or `true` (allow-all) as a fallback when empty.
 *
 * @param domains - The list of allowed network domains.
 * @returns The domain list, or true if empty (allow-all fallback).
 */
function resolveNetDomains(domains: string[]): boolean | string[] {
    return domains.length > 0 ? domains : true;
}

/**
 * Load the full sandbox policy from DB settings, with optional per-conversation overrides.
 *
 * Per-conversation settings (from `conversation_settings` table) override global settings.
 * A null value in the conversation settings means "use the global default."
 *
 * Returns null if sandboxing is disabled (either globally or per-conversation).
 *
 * @param conversationSettings - Optional per-conversation settings overrides.
 * @returns The resolved sandbox policy, or null if sandboxing is disabled.
 */
export function loadSandboxPolicyFromDb(conversationSettings?: ConversationSettings | null): SandboxPolicy | null {
    // Per-conversation sandboxEnabled takes precedence; null = use global default
    const globalEnabled = getSetting(SANDBOX_SETTINGS_KEYS.ENABLED);
    const enabled = conversationSettings?.sandboxEnabled ?? (globalEnabled !== "false");
    if (!enabled) return null;

    // Per-conversation overrides: null = use global, otherwise use conversation value
    const globalExtraReadPaths = getJsonSetting<string[]>(
        SANDBOX_SETTINGS_KEYS.EXTRA_READ_PATHS,
        []
    );
    const globalExtraWritePaths = getJsonSetting<string[]>(
        SANDBOX_SETTINGS_KEYS.EXTRA_WRITE_PATHS,
        []
    );
    const globalAllowNetRaw = getSetting(SANDBOX_SETTINGS_KEYS.ALLOW_NET);
    const globalAllowAllDomains = getSetting(SANDBOX_SETTINGS_KEYS.ALLOW_ALL_DOMAINS) === "true";
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
    const extraReadPaths = resolveOverride(conversationSettings?.extraReadPaths, globalExtraReadPaths);
    const extraWritePaths = resolveOverride(conversationSettings?.extraWritePaths, globalExtraWritePaths);
    const allowEnv = resolveOverride(conversationSettings?.allowEnv, globalAllowEnv);
    const secrets = resolveOverride(conversationSettings?.secrets, globalSecrets);

    // Determine allowAllDomains: conversation override takes precedence
    const allowAllDomains = resolveOverride(conversationSettings?.allowAllDomains, globalAllowAllDomains);

    // Determine allowNet: conversation override takes precedence
    const allowNet = resolveAllowNet({
        conversationAllowNet: conversationSettings?.allowNet,
        conversationAllowedNetDomains: conversationSettings?.allowedNetDomains,
        globalAllowNetRaw,
        globalAllowedNetDomains,
        allowAllDomains,
    });

    return {
        extraReadPaths,
        extraWritePaths,
        allowNet,
        allowAllDomains,
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
 * - Reads are allowed only from the session workspace
 * - Network is denied by default (AI inference runs outside the sandbox)
 * - Filesystem changes are snapshotted for audit
 *
 * Returns null if sandboxing is disabled in settings.
 *
 * @param conversationId - The conversation ID to create a sandbox for.
 * @param conversationSettings - Optional per-conversation settings overrides.
 * @returns A configured Sandbox instance, or null if sandboxing is disabled.
 */
export async function createSessionSandbox(
    conversationId: string,
    conversationSettings?: ConversationSettings | null
): Promise<Sandbox | null> {
    const policy = loadSandboxPolicyFromDb(conversationSettings);

    // If policy is null, sandboxing is disabled
    if (policy === null) return null;

    const sessionWorkDir = resolve(SESSIONS_DIR, conversationId, "workspace");
    await mkdir(sessionWorkDir, { recursive: true });

    const sandbox = Sandbox.create({
        cwd: sessionWorkDir,
        // Allow reads from session workspace only (not Vessel source).
        // Linux: bash configs read directly to avoid parent-FD race (openai/codex#18337).
        allowRead: [sessionWorkDir, ...linuxBashConfigPaths(), ...(policy.extraReadPaths ?? [])],
        // Allow writes only to the session workspace (plus any extra paths)
        allowWrite: [sessionWorkDir, ...(policy.extraWritePaths ?? [])],
        // Network: configured by policy (false, true, or specific domains)
        allowNet: policy.allowNet ?? false,
        // Snapshot filesystem changes for audit/undo
        snapshot: policy.snapshot,
        snapshotPaths: [sessionWorkDir],
        snapshotExclude: ["node_modules", ".git", ".upload-tmp"],
        // Environment: configured by policy
        allowEnv: policy.allowEnv ?? ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "NODE_ENV"],
        // Secrets: optional credential injection
        secrets: policy.secrets,
    });

    return sandbox;
}

/**
 * Create a sandbox specifically for user-initiated file management operations
 * (upload, delete) on a conversation's workspace.
 *
 * Unlike the agent's sandbox (which applies the agent's read/write/network
 * restrictions), this sandbox always has full read and write access to the
 * session workspace. The user's file operations should never be blocked by
 * the agent's security policy — only the agent is restricted.
 *
 * However, snapshots ARE included (when enabled in settings) so that user
 * file changes are recorded in the same audit trail as agent operations.
 * The snapshotExclude list includes .upload-tmp so that temporary upload
 * staging files don't pollute the snapshot diffs.
 *
 * Returns null if sandboxing is disabled in settings.
 *
 * @param conversationId - The conversation ID to create a sandbox for.
 * @param conversationSettings - Optional per-conversation settings overrides.
 * @returns A configured Sandbox instance, or null if sandboxing is disabled.
 */
export async function createFileManagementSandbox(
    conversationId: string,
    conversationSettings?: ConversationSettings | null
): Promise<Sandbox | null> {
    const policy = loadSandboxPolicyFromDb(conversationSettings);

    // If policy is null, sandboxing is disabled
    if (policy === null) return null;

    const sessionWorkDir = resolve(SESSIONS_DIR, conversationId, "workspace");
    await mkdir(sessionWorkDir, { recursive: true });

    return Sandbox.create({
        cwd: sessionWorkDir,
        // Full read/write access to the workspace — user file ops are never restricted.
        // Linux: include bash config paths for FD-race workaround (openai/codex#18337).
        allowRead: [sessionWorkDir, ...linuxBashConfigPaths()],
        allowWrite: [sessionWorkDir],
        // No network needed for file management
        allowNet: false,
        // Snapshot filesystem changes for audit/undo (same as agent sandbox)
        snapshot: policy.snapshot,
        snapshotPaths: [sessionWorkDir],
        snapshotExclude: ["node_modules", ".git", ".upload-tmp"],
        // Minimal env
        allowEnv: ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG"],
    });
}

/**
 * Get the session workspace directory for a conversation.
 * This is where the agent's sandboxed file operations are rooted.
 *
 * @param conversationId - The conversation ID.
 * @returns The absolute path to the session workspace directory.
 */
export function getSessionWorkDir(conversationId: string): string {
    return resolve(SESSIONS_DIR, conversationId, "workspace");
}

/**
 * Load per-conversation settings from the conversation_settings table.
 * Returns null if no row exists (meaning: all defaults apply, inherit from global).
 *
 * @param conversationId - The conversation ID to load settings for.
 * @returns The conversation settings, or null if none exist.
 */
export function loadConversationSettingsFromDb(conversationId: string): ConversationSettings | null {
    const db = getDb();
    const row = db
        .query("SELECT settings FROM conversation_settings WHERE conversation_id = ?")
        .get(conversationId) as { settings: string } | undefined;
    if (!row) return null;
    try {
        return tryJsonParse(row.settings, conversationSettingsSchema);
    } catch {
        return null;
    }
}

/**
 * Determine whether network access is effectively allowed for a conversation.
 *
 * This checks the global and per-conversation settings to determine if
 * network access is enabled, regardless of sandbox state. Used by
 * resolveActiveToolNames() to auto-disable the fetch tool when network
 * is off.
 *
 * @param conversationSettings - Optional per-conversation settings overrides.
 * @returns Whether network access is allowed.
 */
export function isNetworkAllowed(conversationSettings?: ConversationSettings | null): boolean {
    const globalAllowNetRaw = getSetting(SANDBOX_SETTINGS_KEYS.ALLOW_NET);
    const effectiveAllowNet = conversationSettings?.allowNet ?? (globalAllowNetRaw === "true");
    return effectiveAllowNet;
}

/**
 * Determine the effective agent mode for a conversation.
 *
 * Returns "agent" (all tools enabled) or "chat" (no tools).
 * Per-conversation agentMode overrides the global default. A null
 * conversation agentMode means "inherit global".
 *
 * @param conversationSettings - Optional per-conversation settings overrides.
 * @returns The effective agent mode ("agent" or "chat").
 */
export function getEffectiveAgentMode(conversationSettings?: ConversationSettings | null): "agent" | "chat" {
    const globalMode = getSetting("sandbox.defaultAgentMode") ?? "agent";
    return conversationSettings?.agentMode ?? (globalMode as "agent" | "chat");
}

/**
 * Save per-conversation settings to the conversation_settings table.
 *
 * @param conversationId - The conversation ID to save settings for.
 * @param settings - The conversation settings to persist.
 */
export function saveConversationSettingsToDb(conversationId: string, settings: ConversationSettings): void {
    const db = getDb();
    db.prepare(
        `INSERT INTO conversation_settings (conversation_id, settings) VALUES (?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET settings = excluded.settings`
    ).run(conversationId, JSON.stringify(settings));
}
