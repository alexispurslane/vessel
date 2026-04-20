import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getDb } from "$lib/server/db/index.js";

/**
 * GET /api/tags/[tag]
 * List all conversations that have this tag.
 */
export const GET: RequestHandler = async ({ params }) => {
    const db = getDb();
    const tag = params.tag.toLowerCase();

    // Use JSON matching: tags column is a JSON array like ["tag1","tag2"]
    // We search for the tag as a JSON string value within the array.
    // This handles exact matches and avoids false positives like "python" matching "python3".
    const rows = db
        .prepare(
            `SELECT id, title, tags, created_at, updated_at
             FROM conversations
             WHERE tags LIKE ?
             ORDER BY updated_at DESC`
        )
        .all(`%"${tag}"%`) as {
            id: string;
            title: string;
            tags: string;
            created_at: string;
            updated_at: string;
        }[];

    // Filter to only rows that actually have this tag (avoid false LIKE matches)
    const results = rows
        .filter((row) => {
            try {
                const parsed = JSON.parse(row.tags) as string[];
                return parsed.some((t) => t.toLowerCase() === tag);
            } catch {
                return false;
            }
        })
        .map((row) => ({
            id: row.id,
            title: row.title,
            tags: JSON.parse(row.tags) as string[],
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }));

    return json({ tag, conversations: results });
};
