import { userExists, getUsername } from "$lib/server/auth/index.js";

/**
 * Server-side auth check — runs during SSR so the layout can render
 * the authenticated view immediately without a client-side loading spinner.
 *
 * This mirrors what the /api/auth/status endpoint does, but makes the data
 * available to the page as $page.data.auth instead of requiring a client-side
 * fetch in onMount.
 */
export const load = async ({ locals }: { locals: App.Locals }) => {
    const setup = userExists();
    return {
        auth: {
            setup,
            authenticated: !!locals.authenticated,
            username: setup ? (locals.username ?? getUsername() ?? undefined) : undefined,
        },
    };
};
