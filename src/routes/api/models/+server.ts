import { json } from "@sveltejs/kit";
import { listCustomModels } from "$lib/server/agent/session-store.js";
import { tryApi } from "$lib/server/api-errors.js";

/**
 * GET /api/models
 *
 * List available models. Only returns models the user has explicitly added
 * (custom_models from our DB) — not pi's built-in defaults.
 */
export const GET = tryApi(() => {
    const customModels = listCustomModels();

    // Map custom models to the ModelInfo format the frontend expects
    const models = customModels.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        api: m.api,
        reasoning: m.reasoning,
        input: m.inputTypes as ("text" | "image")[],
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
    }));

    return json(models);
});
