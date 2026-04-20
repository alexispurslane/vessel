import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import {
    listCustomModels,
    upsertCustomModel,
    deleteCustomModel,
    refreshModelsJson,
} from "$lib/server/agent/session-store.js";
import type { CustomModelDef } from "$lib/server/agent/types.js";

/**
 * GET /api/models/custom
 * List all custom model definitions.
 */
export const GET: RequestHandler = async () => {
    return json(listCustomModels());
};

/**
 * PUT /api/models/custom
 * Add or update a custom model definition.
 * Validates that model IDs are unique across all providers.
 */
export const PUT: RequestHandler = async ({ request }) => {
    const model: CustomModelDef = await request.json();

    if (!model.id || !model.provider || !model.name || !model.baseUrl || !model.api) {
        return json(
            { error: "id, provider, name, baseUrl, and api are required" },
            { status: 400 }
        );
    }

    try {
        upsertCustomModel(model);
    } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to upsert custom model";
        return json({ error: message }, { status: 409 });
    }
    refreshModelsJson();

    return json({ success: true });
};

/**
 * DELETE /api/models/custom
 * Remove a custom model definition. Only the model ID is needed.
 */
export const DELETE: RequestHandler = async ({ request }) => {
    const { id } = await request.json();

    if (!id) {
        return json({ error: "id is required" }, { status: 400 });
    }

    deleteCustomModel(id);
    refreshModelsJson();

    return json({ success: true });
};
