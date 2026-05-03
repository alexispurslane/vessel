import { json } from "@sveltejs/kit";
import { resolveModel } from "$lib/server/agent/session-store.js";
import { tryApi } from "$lib/server/api-errors.js";

/**
 * GET /api/models/[modelId]
 *
 * Look up a model by its ID and return full model info including the provider.
 * This is the backend for the "model ID → provider" pattern: given just a
 * model ID, the caller can determine which provider that model belongs to.
 *
 * Returns 404 if the model ID is not found.
 */
export const GET = tryApi(({ params }) => {
    const { modelId } = params as { modelId: string };

    const model = resolveModel(modelId);

    if (!model) {
        return json({ error: `Model "${modelId}" not found` }, { status: 404 });
    }

    return json(model);
});
