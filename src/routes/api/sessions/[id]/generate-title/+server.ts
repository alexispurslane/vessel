import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler, badRequest } from "$lib/server/api-errors.js";
import { generateTitleAndTags } from "$lib/server/agent/title-generator.js";
import { getDb } from "$lib/server/db/index.js";
import { safeJsonParse, stringArraySchema } from "$lib/utils.js";

const PostBody = z.object({
    force: z.boolean().optional(),
});

/**
 * POST /api/sessions/[id]/generate-title
 *
 * Generate a title and tags for a conversation using the secondary model.
 * Returns the generated title and tags, or the current title if already set.
 *
 * Body params:
 * - force: boolean — if true, regenerate even if a title is already set
 */
export const POST = apiHandler(PostBody, async ({ body, event }) => {
    const id = event.params.id;
    if (!id) return badRequest("Missing session id");
    const force = body.force ?? false;

    const result = await generateTitleAndTags(id, force);
    if (result) {
        return json({ generated: true, title: result.title, tags: result.tags });
    }

    // No first user message found, or no model configured
    const db = getDb();
    const row = db
        .prepare("SELECT title, tags FROM conversations WHERE id = ?")
        .get(id) as { title: string; tags: string } | undefined;

    if (row) {
        return json({
            generated: false,
            title: row.title,
            tags: safeJsonParse(row.tags, stringArraySchema) ?? [],
        });
    }

    return json({ generated: false });
});
