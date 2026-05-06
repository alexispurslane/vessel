/**
 * @file Auth store — tracks setup/auth state, provides login/logout/setup actions.
 */
import {
    getAuthStatus,
    login as apiLogin,
    logout as apiLogout,
    setupUser as apiSetup,
} from "$lib/api.js";
import type { AuthStatus } from "$lib/types.js";
import { goto, invalidateAll } from "$app/navigation";
import { resolve } from "$app/paths";

let status = $state<AuthStatus>({ setup: false, authenticated: false, username: undefined });
let loading = $state(false);
let error = $state<string | null>(null);

/**
 * Get the auth store state (status, loading, error, etc.).
 *
 * @returns Auth store accessors
 */
export function getAuth() {
    return {
        get status() {
            return status;
        },
        get loading() {
            return loading;
        },
        get error() {
            return error;
        },
        get isAuthenticated() {
            return status.authenticated;
        },
        get needsSetup() {
            return !status.setup;
        },
        get username() {
            return status.username;
        },
    };
}

/**
 * Initialize the auth store from server-side data (e.g., from +layout.server.ts).
 * This avoids the loading spinner — the store is populated before the client-side
 * checkAuth() fetch completes.
 *
 * @param authStatus - The auth status from the server
 * @returns {void}
 */
export function initAuth(authStatus: AuthStatus): void {
    // Only initialize if the store hasn't been populated yet.
    // This prevents overwriting a fresh checkAuth() result.
    if (!status.setup || (!status.authenticated && !loading)) {
        status = authStatus;
    }
}

/**
 * Check auth status from the server and update the store.
 *
 * @returns The current auth status
 */
export async function checkAuth(): Promise<AuthStatus> {
    loading = true;
    error = null;
    try {
        status = await getAuthStatus();
        return status;
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to check auth status";
        status = { setup: false, authenticated: false };
        return status;
    } finally {
        loading = false;
    }
}

/**
 * Set up a new user account and auto-login.
 *
 * @param username - The new username
 * @param password - The new password
 * @returns Whether setup and login succeeded
 */
export async function setup(username: string, password: string): Promise<boolean> {
    loading = true;
    error = null;
    try {
        await apiSetup(username, password);
        // After setup, auto-login

        // password passed to API call, never logged
        // oxlint-disable-next-line secure-coding/no-sensitive-data-exposure
        return await doLogin(username, password);
    } catch (e) {
        error = e instanceof Error ? e.message : "Setup failed";
        return false;
    } finally {
        loading = false;
    }
}

/**
 * Log in with credentials and redirect to home.
 *
 * @param username - The username
 * @param password - The password
 * @returns Whether login succeeded
 */
export async function doLogin(username: string, password: string): Promise<boolean> {
    loading = true;
    error = null;
    try {
        // password passed to API call, never logged
        // oxlint-disable-next-line secure-coding/no-sensitive-data-exposure
        await apiLogin(username, password);
        status = { setup: true, authenticated: true };
        // Invalidate all load data so the layout re-fetches auth
        // status from the server (prevents stale $page.data.auth).
        await invalidateAll();
        void goto(resolve("/"));
        return true;
    } catch (e) {
        error = e instanceof Error ? e.message : "Login failed";
        return false;
    } finally {
        loading = false;
    }
}

/**
 * Log out and redirect to login page.
 *
 * @returns {void}
 */
export async function doLogout(): Promise<void> {
    loading = true;
    try {
        await apiLogout();
        status = { setup: true, authenticated: false };
        // Invalidate all load data so the layout re-fetches auth status.
        await invalidateAll();
        void goto(resolve("/login"));
    } catch (e) {
        error = e instanceof Error ? e.message : "Logout failed";
    } finally {
        loading = false;
    }
}

/**
 * Clear the current error message.
 *
 * @returns {void}
 */
export function clearError(): void {
    error = null;
}
