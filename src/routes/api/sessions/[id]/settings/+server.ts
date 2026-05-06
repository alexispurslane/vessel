import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler, notFound, tryApi } from "$lib/server/api-errors.js";
import { getDb } from "$lib/server/db/index.js";
import {
    loadConversationSettingsFromDb,
    saveConversationSettingsToDb,
} from "$lib/server/agent/sandbox-factory.js";
import { restartSession } from "$lib/server/agent/session-store.js";
import type { ConversationSettings } from "$lib/types.js";

const PutBody = z.object({
    sandboxEnabled: z.boolean().nullable().optional(),
    extraReadPaths: z.array(z.string()).nullable().optional(),
    extraWritePaths: z.array(z.string()).nullable().optional(),
    allowNet: z.boolean().nullable().optional(),
    allowAllDomains: z.boolean().nullable().optional(),
    allowedNetDomains: z.array(z.string()).nullable().optional(),
    secrets: z.record(z.string(), z.object({ value: z.string(), hosts: z.array(z.string()) })).nullable().optional(),
    allowEnv: z.array(z.string()).nullable().optional(),
    deleteWorkspaceWithConversation: z.boolean().optional(),
    agentMode: z.enum(["agent", "chat"]).nullable().optional(),
    customSystemPrompt: z.string().nullable().optional(),
    appendSystemPrompt: z.array(z.string()).nullable().optional(),
    enabledMcpServers: z.array(z.string()).nullable().optional(),
});

/**
 * GET /api/sessions/[id]/settings
 * Get per-conversation settings.
 * Returns the effective settings (merged with defaults for null fields).
 */
export const GET = tryApi(({ params }) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const id = params.id!;
    const db = getDb();

    // Verify conversation exists
    const row = db.query("SELECT id FROM conversations WHERE id = ?").get(id);
    if (!row) {
        return notFound("Conversation not found");
    }

    const settings = loadConversationSettingsFromDb(id);
    // Return the stored settings (null fields mean "use global default")
    // The client will merge with DEFAULT_CONVERSATION_SETTINGS for display
    return json(settings ?? {});
});

/**
 * PUT /api/sessions/[id]/settings
 * Update per-conversation settings.
 * Replaces all settings for this conversation (full replacement, not partial merge).
 * If sandbox-affecting settings changed, restarts the in-memory session.
 */
export const PUT = apiHandler(PutBody, ({ body, event }) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const id = event.params.id!;
    // Build a clean ConversationSettings object from the validated input
    const settings: ConversationSettings = {};

    // Only include fields that were explicitly provided
    if (body.sandboxEnabled !== undefined) settings.sandboxEnabled = body.sandboxEnabled;
    if (body.extraReadPaths !== undefined) settings.extraReadPaths = body.extraReadPaths;
    if (body.extraWritePaths !== undefined) settings.extraWritePaths = body.extraWritePaths;
    if (body.allowNet !== undefined) settings.allowNet = body.allowNet;
    if (body.allowAllDomains !== undefined) settings.allowAllDomains = body.allowAllDomains;
    if (body.allowedNetDomains !== undefined) settings.allowedNetDomains = body.allowedNetDomains;
    if (body.secrets !== undefined) settings.secrets = body.secrets;
    if (body.allowEnv !== undefined) settings.allowEnv = body.allowEnv;
    if (body.deleteWorkspaceWithConversation !== undefined) settings.deleteWorkspaceWithConversation = body.deleteWorkspaceWithConversation;
    if (body.agentMode !== undefined) settings.agentMode = body.agentMode;
    if (body.customSystemPrompt !== undefined) settings.customSystemPrompt = body.customSystemPrompt;
    if (body.appendSystemPrompt !== undefined) settings.appendSystemPrompt = body.appendSystemPrompt;
    if (body.enabledMcpServers !== undefined) settings.enabledMcpServers = body.enabledMcpServers;

    const db = getDb();

    // Verify conversation exists
    const row = db.query("SELECT id FROM conversations WHERE id = ?").get(id);
    if (!row) {
        return notFound("Conversation not found");
    }

    // Check what the old settings were to know if restart is needed
    const oldSettings = loadConversationSettingsFromDb(id);

    // Save to DB
    saveConversationSettingsToDb(id, settings);

    // Determine if sandbox-affecting settings changed
    const restartKeys: (keyof ConversationSettings)[] = [
        "sandboxEnabled",
        "extraReadPaths",
        "extraWritePaths",
        "allowNet",
        "allowAllDomains",
        "allowedNetDomains",
        "secrets",
        "allowEnv",
        "agentMode",
        "enabledMcpServers",
    ];

    const settingsChanged = restartKeys.some((key) => {
        // key iterates over hardcoded restartKeys array, not user input
        // oxlint-disable-next-line secure-coding/detect-object-injection
        const oldVal = oldSettings?.[key];
        // same: key from hardcoded restartKeys
        // oxlint-disable-next-line secure-coding/detect-object-injection
        const newVal = settings[key];
        return JSON.stringify(oldVal) !== JSON.stringify(newVal);
    });

    // If sandbox-affecting settings changed, restart the in-memory session
    // so it picks up the new settings on next access
    let restarted = false;
    if (settingsChanged) {
        restarted = restartSession(id);
    }

    return json({ success: true, restarted });
});
