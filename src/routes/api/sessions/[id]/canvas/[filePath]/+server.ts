/**
 * @file Canvas collaborative editing API routes.
 *
 * POST — Client pushes changes (OT protocol).
 * GET  — Client catches up on missed updates (reconnection).
 */

import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler, tryApi, badRequest, notFound } from "$lib/server/api-errors.js";
import {
    pushCanvasChanges,
    getCanvasUpdatesSince,
    isCanvasFile,
    formatCanvasSSEEvent,
} from "$lib/server/canvas-store.js";
import { broadcastCanvasUpdate } from "$lib/server/canvas-broadcast.js";
import type { SerializedUpdate } from "$lib/types/canvas.js";

const changePart = z.union([z.number(), z.array(z.union([z.number(), z.string()]))]);

const SerializedUpdateSchema = z.object({
    changes: z.array(changePart),
    clientID: z.string(),
});

const PushBody = z.object({
    version: z.number().int().min(0),
    updates: z.array(SerializedUpdateSchema),
});

/**
 * POST /api/sessions/[id]/canvas/[filePath]
 *
 * Push client changes to the server. The server is the OT authority.
 * - If version matches: accept changes, broadcast, respond with new version.
 * - If version is behind: rebase client changes, respond with missing updates.
 */
export const POST = apiHandler(PushBody, async ({ body, event }) => {
    const conversationId = event.params.id;
    if (!conversationId) return notFound("Conversation not found");

    const filePath = event.params.filePath;
    if (!filePath) return badRequest("Missing filePath");

    // Ensure the file is a canvas
    const isCanvas = await isCanvasFile(conversationId, filePath);
    if (!isCanvas) {
        return badRequest("File is not a canvas");
    }

    // Push changes through OT
    const result = await pushCanvasChanges(
        conversationId,
        filePath,
        body.version,
        body.updates as SerializedUpdate[]
    );

    // Broadcast canvas_update to all SSE subscribers (the new changes)
    const sseEvent = formatCanvasSSEEvent({
        filePath,
        version: result.version,
        updates: result.broadcastUpdates,
    });
    await broadcastCanvasUpdate(conversationId, sseEvent);

    // Agent diff notifications are handled lazily by the canvas-diff-tracker
    // extension at the before_agent_start boundary, not on every push.

    return json({ version: result.version, serverUpdates: result.serverUpdates });
});

/**
 * GET /api/sessions/[id]/canvas/[filePath]?since=N
 *
 * Catch up on missed canvas updates after SSE reconnection.
 * Returns all updates since the given version.
 */
export const GET = tryApi(async ({ params, url }) => {
    const conversationId = params.id;
    if (!conversationId) return notFound("Conversation not found");

    const filePath = params.filePath;
    if (!filePath) return badRequest("Missing filePath");

    const sinceVersion = parseInt(url.searchParams.get("since") ?? "0", 10);
    if (isNaN(sinceVersion) || sinceVersion < 0) {
        return badRequest("Invalid 'since' parameter");
    }

    const isCanvas = await isCanvasFile(conversationId, filePath);
    if (!isCanvas) {
        return notFound("Canvas not found");
    }

    const result = await getCanvasUpdatesSince(conversationId, filePath, sinceVersion);
    return json(result);
});
