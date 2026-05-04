/**
 * GET /api/sessions/search?q=...
 *
 * Full-text search across conversation titles and message content.
 * Returns matching conversations with context snippets.
 */
import { json } from "@sveltejs/kit";
import { z } from "zod";
import { tryApi } from "$lib/server/api-errors.js";
import { searchConversations } from "$lib/server/agent/session-store.js";

const QuerySchema = z.object({
    q: z.string().min(1),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const GET = tryApi(async ({ url }) => {
    const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
        return json({ error: "Invalid query parameters" }, { status: 400 });
    }

    const { q, limit } = parsed.data;
    const results = await searchConversations(q, limit);
    return json(results);
});
