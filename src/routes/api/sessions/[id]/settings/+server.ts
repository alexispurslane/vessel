import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getDb } from "$lib/server/db/index.js";
import {
    loadConversationSettingsFromDb,
    saveConversationSettingsToDb,
} from "$lib/server/agent/sandbox-factory.js";
import { restartSession } from "$lib/server/agent/session-store.js";
import type { ConversationSettings } from "$lib/types.js";

/**
 * GET /api/sessions/[id]/settings
 * Get per-conversation settings.
 * Returns the effective settings (merged with defaults for null fields).
 */
export const GET: RequestHandler = async ({ params }) => {
    const db = getDb();

    // Verify conversation exists
    const row = db.prepare("SELECT id FROM conversations WHERE id = ?").get(params.id);
    if (!row) {
        return json({ error: "Conversation not found" }, { status: 404 });
    }

    const settings = loadConversationSettingsFromDb(params.id);
    // Return the stored settings (null fields mean "use global default")
    // The client will merge with DEFAULT_CONVERSATION_SETTINGS for display
    return json(settings ?? {});
};

/**
 * PUT /api/sessions/[id]/settings
 * Update per-conversation settings.
 * Replaces all settings for this conversation (full replacement, not partial merge).
 * If sandbox-affecting settings changed, restarts the in-memory session.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
    const db = getDb();

    // Verify conversation exists
    const row = db.prepare("SELECT id FROM conversations WHERE id = ?").get(params.id);
    if (!row) {
        return json({ error: "Conversation not found" }, { status: 404 });
    }

    const body = await request.json();

    // Validate: body must be an object
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json({ error: "Request body must be a JSON object" }, { status: 400 });
    }

    // Build a clean ConversationSettings object from the input
    const settings: ConversationSettings = {};

    // Only include fields that were explicitly provided
    if ("sandboxEnabled" in body) settings.sandboxEnabled = body.sandboxEnabled;
    if ("extraReadPaths" in body) settings.extraReadPaths = body.extraReadPaths;
    if ("extraWritePaths" in body) settings.extraWritePaths = body.extraWritePaths;
    if ("allowNet" in body) settings.allowNet = body.allowNet;
    if ("allowedNetDomains" in body) settings.allowedNetDomains = body.allowedNetDomains;
    if ("secrets" in body) settings.secrets = body.secrets;
    if ("allowEnv" in body) settings.allowEnv = body.allowEnv;
    if ("deleteWorkspaceWithConversation" in body) settings.deleteWorkspaceWithConversation = body.deleteWorkspaceWithConversation;
    if ("disabledTools" in body) settings.disabledTools = body.disabledTools;

    // Check what the old settings were to know if restart is needed
    const oldSettings = loadConversationSettingsFromDb(params.id);

    // Save to DB
    saveConversationSettingsToDb(params.id, settings);

    // Determine if sandbox-affecting settings changed
    const sandboxKeys: (keyof ConversationSettings)[] = [
        "sandboxEnabled",
        "extraReadPaths",
        "extraWritePaths",
        "allowNet",
        "allowedNetDomains",
        "secrets",
        "allowEnv",
        "disabledTools",
    ];

    const sandboxChanged = sandboxKeys.some((key) => {
        const oldVal = oldSettings?.[key];
        const newVal = settings[key];
        return JSON.stringify(oldVal) !== JSON.stringify(newVal);
    });

    // If sandbox-affecting settings changed, restart the in-memory session
    // so it picks up the new settings on next access
    let restarted = false;
    if (sandboxChanged) {
        restarted = restartSession(params.id);
    }

    return json({ success: true, restarted });
};
