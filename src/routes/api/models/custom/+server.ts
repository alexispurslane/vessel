import { json } from "@sveltejs/kit";
import { z } from "zod";
import {
    listCustomModels,
    upsertCustomModel,
    deleteCustomModel,
    refreshModelsJson,
} from "$lib/server/agent/session-store.js";
import type { CustomModelDef } from "$lib/server/agent/types.js";
import { apiError, apiHandler, tryApi } from "$lib/server/api-errors.js";

const PutBody = z.object({
    id: z.string().min(1),
    provider: z.string().min(1),
    name: z.string().min(1),
    baseUrl: z.string().min(1),
    api: z.string().min(1),
    reasoning: z.boolean().optional(),
    inputTypes: z.array(z.string()).optional(),
    contextWindow: z.number().optional(),
    maxTokens: z.number().optional(),
    cost: z.object({
        input: z.number(),
        output: z.number(),
        cacheRead: z.number(),
        cacheWrite: z.number(),
    }).optional(),
    compat: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const DeleteBody = z.object({
    id: z.string().min(1),
});

/**
 * GET /api/models/custom
 * List all custom model definitions.
 */
export const GET = tryApi(async () => {
    return json(listCustomModels());
});

/**
 * PUT /api/models/custom
 * Add or update a custom model definition.
 * Validates that model IDs are unique across all providers.
 */
export const PUT = apiHandler(PutBody, async ({ body }) => {
    try {
        upsertCustomModel(body as CustomModelDef);
    } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to upsert custom model";
        return apiError(message, 409);
    }

    try {
        refreshModelsJson();
    } catch (e) {
        // Models saved but refresh failed — non-fatal
        console.error("Failed to refresh models.json after upsert:", e);
    }

    return json({ success: true });
});

/**
 * DELETE /api/models/custom
 * Remove a custom model definition. Only the model ID is needed.
 */
export const DELETE = apiHandler(DeleteBody, async ({ body }) => {
    deleteCustomModel(body.id);
    refreshModelsJson();
    return json({ success: true });
});
