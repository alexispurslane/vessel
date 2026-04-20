import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { generateTitleAndTags } from "$lib/server/agent/title-generator.js";
import { getDb } from "$lib/server/db/index.js";

/**
 * POST /api/sessions/[id]/generate-title
 *
 * Generate a title and tags for a conversation using the secondary model.
 * Returns the generated title and tags, or the current title if already set.
 *
 * Body params:
 * - force: boolean — if true, regenerate even if a title is already set
 */
export const POST: RequestHandler = async ({ params, request }) => {
    let force = false;
    try {
        const body = await request.json().catch(() => ({}));
        force = !!body.force;
    } catch {
        // No body or invalid JSON — defaults to force=false
    }

    try {
        const result = await generateTitleAndTags(params.id, force);
        if (result) {
            return json({ generated: true, title: result.title, tags: result.tags });
        }

        // No first user message found, or no model configured
        const db = getDb();
        const row = db
            .prepare("SELECT title, tags FROM conversations WHERE id = ?")
            .get(params.id) as { title: string; tags: string } | undefined;

        if (row) {
            return json({
                generated: false,
                title: row.title,
                tags: JSON.parse(row.tags) as string[],
            });
        }

        return json({ generated: false });
    } catch (err) {
        console.error(`Failed to generate title for session ${params.id}:`, err);
        return json({ error: "Failed to generate title" }, { status: 500 });
    }
};
