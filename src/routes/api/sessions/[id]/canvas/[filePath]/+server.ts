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
    getOrCreateCanvasDoc,
    formatCanvasSSEEvent,
    computeWordDiff,
    formatCanvasEditNotification,
} from "$lib/server/canvas-store.js";
import { sendCustomMessage } from "$lib/server/agent/session-store.js";
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

    // Capture pre-push content for diff computation
    const prePushDoc = await getOrCreateCanvasDoc(conversationId, filePath);
    const oldContent = prePushDoc.doc.toString();

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

    // Notify the agent about the edit with a word-level diff (best-effort)
    const newContent = (await getOrCreateCanvasDoc(conversationId, filePath)).doc.toString();
    if (oldContent !== newContent) {
        try {
            const diff = computeWordDiff(oldContent, newContent);
            const notification = formatCanvasEditNotification(filePath, diff);
            await sendCustomMessage(
                conversationId,
                "canvas_edit",
                notification,
                { triggerTurn: true, deliverAs: "nextTurn" }
            );
        } catch {
            // Agent notification is best-effort
        }
    }

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
