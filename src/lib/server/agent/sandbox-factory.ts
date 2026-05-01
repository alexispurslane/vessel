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
 * Sandbox dependencies:
 *
 * The sandbox does NOT get read access to the project's own source code or
 * node_modules. Instead, a dedicated `data/deps` directory contains a minimal
 * node_modules with only the packages that sandboxed tools need (e.g. happy-dom
 * for the fetch tool). This keeps the sandbox's attack surface small — the
 * agent can't read Vessel's source code or its full dependency tree.
 *
 * `ensureSandboxDeps()` is called at sandbox creation time to set up this
 * directory if it doesn't exist yet (or if the deps are out of date).
 *
 * Settings are stored in the DB `settings` table under keys prefixed with `sandbox.`
 * and are loaded when creating a new sandbox. See the "Sandbox" tab in Settings
 * for the UI to configure these.
 */

import { Sandbox, type SecretConfig } from "zerobox";
import { resolve } from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { getDb } from "../db/index.js";
import { tryJsonParse } from "$lib/utils.js";
import { type ConversationSettings, conversationSettingsSchema } from "$lib/types.js";
import { log } from "$lib/server/logger.js";

const execFileAsync = promisify(execFile);

// --- Constants ---

const DATA_DIR = resolve(process.cwd(), "data");
const SESSIONS_DIR = resolve(DATA_DIR, "sessions");

/**
 * Dedicated dependency directory for sandboxed tool execution.
 *
 * Contains a minimal node_modules with packages that sandboxed tools need
 * (e.g. happy-dom). This is the ONLY filesystem path (beyond the session
 * workspace) that sandboxes can read from — they do NOT get access to the
 * project's own source code or its full node_modules.
 */
export const SANDBOX_DEPS_DIR = resolve(DATA_DIR, "deps");

/**
 * Path to the lockfile that tracks which dependencies are installed in
 * SANDBOX_DEPS_DIR. Used by ensureSandboxDeps() to detect when deps
 * are out of date and need re-installing.
 */
const SANDBOX_DEPS_LOCKFILE = resolve(SANDBOX_DEPS_DIR, ".installed-deps.json");

/**
 * Packages that sandboxed tools need access to.
 *
 * When a sandboxed tool runs `require("happy-dom")` or similar, it resolves
 * from SANDBOX_DEPS_DIR/node_modules/.
 *
 * Add new entries here when sandboxed tools need additional npm packages.
 * After changing this list, existing sandboxes will pick up the new deps
 * on the next `ensureSandboxDeps()` call (triggered at sandbox creation).
 */
const SANDBOX_DEPS_PACKAGES: Record<string, string> = {
    "happy-dom": "^20.9.0",
    "defuddle": "^0.18.1",
    "impit": "^0.13.1",
};

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

// --- Sandbox dependency setup ---

/**
 * Ensure that the sandbox dependency directory exists and is up to date.
 *
 * Creates `data/deps/node_modules/` with the packages listed in
 * SANDBOX_DEPS_PACKAGES. If the directory already exists and the
 * installed versions match the lockfile, this is a no-op.
 *
 * Called at sandbox creation time so that deps are guaranteed to be
 * available before any sandboxed tool tries to require() them.
 */
export async function ensureSandboxDeps(): Promise<void> {
    const nodeModulesDir = resolve(SANDBOX_DEPS_DIR, "node_modules");

    // Check if we need to install/update deps
    const needsInstall = !existsSync(nodeModulesDir) || !existsSync(SANDBOX_DEPS_LOCKFILE);

    if (!needsInstall) {
        // Compare installed deps against the current spec
        try {
            const installed = JSON.parse(readFileSync(SANDBOX_DEPS_LOCKFILE, "utf-8")) as Record<string, string>;
            const specKeys = Object.keys(SANDBOX_DEPS_PACKAGES).sort().join(",");
            const installedKeys = Object.keys(installed).sort().join(",");
            if (specKeys !== installedKeys) {
                // Deps list has changed — reinstall
                await installSandboxDeps();
                return;
            }
        } catch {
            // Lockfile is corrupted — reinstall
            await installSandboxDeps();
            return;
        }
        // Deps are up to date
        return;
    }

    await installSandboxDeps();
}

/**
 * Run npm install for sandbox dependencies and write the lockfile.
 */
async function installSandboxDeps(): Promise<void> {
    // Ensure the directory exists
    mkdirSync(SANDBOX_DEPS_DIR, { recursive: true });

    // Write a minimal package.json for npm install
    const packageJson = {
        name: "vessel-sandbox-deps",
        private: true,
        description: "Dependencies for Vessel's sandbox tool execution. Managed by ensureSandboxDeps() — do not edit.",
        dependencies: { ...SANDBOX_DEPS_PACKAGES },
    };
    writeFileSync(
        resolve(SANDBOX_DEPS_DIR, "package.json"),
        JSON.stringify(packageJson, null, 2)
    );

    // Install deps — async so it doesn't block the event loop
    await execFileAsync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
        cwd: SANDBOX_DEPS_DIR,
    });

    // Write the lockfile so we can detect stale installs
    writeFileSync(
        SANDBOX_DEPS_LOCKFILE,
        JSON.stringify(SANDBOX_DEPS_PACKAGES)
    );

    log.info("sandbox", `Installed deps to ${SANDBOX_DEPS_DIR}`);
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
    } catch (e) {
        log.debug("sandbox", "Failed to parse sandbox setting JSON, using fallback", e);
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
    const extraReadPaths = conversationSettings?.extraReadPaths ?? globalExtraReadPaths;
    const extraWritePaths = conversationSettings?.extraWritePaths ?? globalExtraWritePaths;
    const allowEnv = conversationSettings?.allowEnv ?? globalAllowEnv;
    const secrets = conversationSettings?.secrets ?? globalSecrets;

    // Determine allowAllDomains: conversation override takes precedence
    const allowAllDomains = conversationSettings?.allowAllDomains ?? globalAllowAllDomains;

    // Determine allowNet: conversation override takes precedence
    let allowNet: boolean | string[];
    if (conversationSettings?.allowNet !== null && conversationSettings?.allowNet !== undefined) {
        // Per-conversation override is set
        if (!conversationSettings.allowNet) {
            allowNet = false;
        } else {
            // allowNet is true-ish
            if (allowAllDomains) {
                // All domains allowed
                allowNet = true;
            } else {
                // Use specific domains: conversation domains if set, else global domains
                const domains = conversationSettings.allowedNetDomains ?? globalAllowedNetDomains;
                allowNet = domains.length > 0 ? domains : true;
            }
        }
    } else {
        // Use global allowNet
        if (globalAllowNetRaw === "true") {
            if (allowAllDomains) {
                // All domains allowed
                allowNet = true;
            } else {
                allowNet = globalAllowedNetDomains.length > 0 ? globalAllowedNetDomains : true;
            }
        } else {
            allowNet = false;
        }
    }

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
 * - Reads are allowed from the deps directory (happy-dom, etc.) and session workspace
 * - Network is denied by default (AI inference runs outside the sandbox)
 * - Filesystem changes are snapshotted for audit
 *
 * The sandbox does NOT get read access to the project's source code or its
 * full node_modules — only the curated deps in data/deps/node_modules.
 *
 * Returns null if sandboxing is disabled in settings.
 */
export async function createSessionSandbox(
    conversationId: string,
    conversationSettings?: ConversationSettings | null
): Promise<Sandbox | null> {
    const policy = loadSandboxPolicyFromDb(conversationSettings);

    // If policy is null, sandboxing is disabled
    if (policy === null) return null;

    // Ensure sandbox deps are installed before creating the sandbox
    await ensureSandboxDeps();

    const sessionWorkDir = resolve(SESSIONS_DIR, conversationId, "workspace");
    mkdirSync(sessionWorkDir, { recursive: true });

    const sandbox = Sandbox.create({
        cwd: sessionWorkDir,
        // Allow reads from the sandbox deps directory and session workspace.
        // NOT from process.cwd() — sandboxes should not read Vessel's source.
        allowRead: [SANDBOX_DEPS_DIR, sessionWorkDir, ...(policy.extraReadPaths ?? [])],
        // Allow writes only to the session workspace (plus any extra paths)
        allowWrite: [sessionWorkDir, ...(policy.extraWritePaths ?? [])],
        // Network: configured by policy (false, true, or specific domains)
        allowNet: policy.allowNet ?? false,
        // Snapshot filesystem changes for audit/undo
        snapshot: policy.snapshot,
        snapshotPaths: [sessionWorkDir],
        snapshotExclude: ["node_modules", ".git", ".upload-tmp"],
        // Environment: configured by policy, plus NODE_PATH so require() resolves
        // from the sandbox deps directory inside sandboxed node processes
        allowEnv: policy.allowEnv ?? ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "NODE_ENV"],
        env: {
            NODE_PATH: resolve(SANDBOX_DEPS_DIR, "node_modules"),
        },
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
 */
export function createFileManagementSandbox(
    conversationId: string,
    conversationSettings?: ConversationSettings | null
): Sandbox | null {
    const policy = loadSandboxPolicyFromDb(conversationSettings);

    // If policy is null, sandboxing is disabled
    if (policy === null) return null;

    const sessionWorkDir = resolve(SESSIONS_DIR, conversationId, "workspace");
    mkdirSync(sessionWorkDir, { recursive: true });

    return Sandbox.create({
        cwd: sessionWorkDir,
        // Full read/write access to the workspace — user file ops are never restricted
        allowRead: [sessionWorkDir],
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
 */
export function getEffectiveAgentMode(conversationSettings?: ConversationSettings | null): "agent" | "chat" {
    const globalMode = getSetting("sandbox.defaultAgentMode") ?? "agent";
    return conversationSettings?.agentMode ?? (globalMode as "agent" | "chat");
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
