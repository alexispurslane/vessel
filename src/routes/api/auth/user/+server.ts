import { json } from "@sveltejs/kit";
import { z } from "zod";
import {
    userExists,
    getUsername,
    getPronouns,
    updateUsername,
    updatePassword,
    updatePronouns,
    verifyPassword,
} from "$lib/server/auth/index.js";
import { apiError, apiHandler, tryApi, unauthorized } from "$lib/server/api-errors.js";

/**
 * GET /api/auth/user
 * Get the current user's info (username, pronouns).
 */
export const GET = tryApi((event) => {
    if (!userExists()) {
        return apiError("No user exists yet", 404);
    }

    // Must be authenticated
    if (!event.locals.authenticated) {
        return unauthorized("Not authenticated");
    }

    return json({
        username: getUsername(),
        pronouns: getPronouns(),
    });
});

const PatchBody = z.object({
    username: z.string().min(1).optional(),
    currentPassword: z.string().min(1).optional(),
    newPassword: z.string().min(8).optional(),
    pronouns: z.string().nullable().optional(),
});

/**
 * PATCH /api/auth/user
 * Update the current user's info.
 * - username: change display name
 * - currentPassword + newPassword: change password (requires current password)
 * - pronouns: set or clear pronouns (null to clear)
 */
export const PATCH = apiHandler(PatchBody, ({ body, event }) => {
    if (!userExists()) {
        return apiError("No user exists yet", 404);
    }

    // Must be authenticated
    if (!event.locals.authenticated) {
        return unauthorized("Not authenticated");
    }

    // If password change requested, verify current password first
    if (body.newPassword) {
        if (!body.currentPassword) {
            return apiError("Current password is required to change password", 400);
        }
        if (!verifyPassword(body.currentPassword)) {
            return apiError("Current password is incorrect", 400);
        }
        updatePassword(body.newPassword);
    }

    if (body.username) {
        updateUsername(body.username);
    }

    if (body.pronouns !== undefined) {
        updatePronouns(body.pronouns);
    }

    return json({
        success: true,
        username: getUsername(),
        pronouns: getPronouns(),
    });
});
