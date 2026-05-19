/**
 * @file Canvas toggle and list API routes.
 *
 * PUT  — Toggle a file as a canvas (add/remove from tracking).
 * GET  — List all canvas files for a conversation.
 */

import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler, tryApi, notFound, badRequest } from "$lib/server/api-errors.js";
import {
    toggleCanvas,
    listCanvasFiles,
    getOrCreateCanvasDoc,
} from "$lib/server/canvas-store.js";
import { getOrHydrateSession } from "$lib/server/agent/session-store.js";
import type { CanvasToggleResponse } from "$lib/types/canvas.js";

const ToggleBody = z.object({
    filePath: z.string().min(1),
});

/**
 * PUT /api/sessions/[id]/canvas
 *
 * Toggle a file as a canvas. If the file is already tracked, removes it.
 * If not tracked, adds it and initializes the OT state from the file on disk.
 * Returns whether the file is now a canvas.
 */
export const PUT = apiHandler(ToggleBody, async ({ body, event }) => {
    const conversationId = event.params.id;
    if (!conversationId) return notFound("Conversation not found");

    const filePath = body.filePath;

    const isCanvas = await toggleCanvas(conversationId, filePath);

    const response: CanvasToggleResponse = { isCanvas };

    if (isCanvas) {
        // Ensure the session is loaded so SSE can broadcast canvas events
        await getOrHydrateSession(conversationId);

        const canvasDoc = await getOrCreateCanvasDoc(conversationId, filePath);
        response.version = canvasDoc.version;
    }

    return json(response);
});

/**
 * GET /api/sessions/[id]/canvas
 *
 * List all canvas files for a conversation.
 */
export const GET = tryApi(async ({ params }) => {
    const conversationId = params.id;
    if (!conversationId) return badRequest("Missing session id");

    const canvases = await listCanvasFiles(conversationId);
    return json({ canvases });
});
