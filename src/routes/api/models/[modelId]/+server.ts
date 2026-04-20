import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { resolveModel } from "$lib/server/agent/session-store.js";

/**
 * GET /api/models/[modelId]
 *
 * Look up a model by its ID and return full model info including the provider.
 * This is the backend for the "model ID → provider" pattern: given just a
 * model ID, the caller can determine which provider that model belongs to.
 *
 * Returns 404 if the model ID is not found.
 */
export const GET: RequestHandler = async ({ params }) => {
    const { modelId } = params;

    const model = resolveModel(modelId);

    if (!model) {
        return json({ error: `Model "${modelId}" not found` }, { status: 404 });
    }

    return json(model);
};
