/**
 * Auth store — tracks setup/auth state, provides login/logout/setup actions.
 */
import {
    getAuthStatus,
    login as apiLogin,
    logout as apiLogout,
    setupUser as apiSetup,
} from "$lib/api.js";
import type { AuthStatus } from "$lib/types.js";
import { goto } from "$app/navigation";
import { resolve } from "$app/paths";

let status = $state<AuthStatus>({ setup: false, authenticated: false, username: undefined });
let loading = $state(false);
let error = $state<string | null>(null);

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
 */
export function initAuth(authStatus: AuthStatus): void {
    // Only initialize if the store hasn't been populated yet.
    // This prevents overwriting a fresh checkAuth() result.
    if (!status.setup || (!status.authenticated && !loading)) {
        status = authStatus;
    }
}

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

export async function setup(username: string, password: string): Promise<boolean> {
    loading = true;
    error = null;
    try {
        await apiSetup(username, password);
        // After setup, auto-login
        return await doLogin(username, password);
    } catch (e) {
        error = e instanceof Error ? e.message : "Setup failed";
        return false;
    } finally {
        loading = false;
    }
}

export async function doLogin(username: string, password: string): Promise<boolean> {
    loading = true;
    error = null;
    try {
        await apiLogin(username, password);
        status = { setup: true, authenticated: true };
        void goto(resolve("/"));
        return true;
    } catch (e) {
        error = e instanceof Error ? e.message : "Login failed";
        return false;
    } finally {
        loading = false;
    }
}

export async function doLogout(): Promise<void> {
    loading = true;
    try {
        await apiLogout();
        status = { setup: true, authenticated: false };
        void goto(resolve("/login"));
    } catch (e) {
        error = e instanceof Error ? e.message : "Logout failed";
    } finally {
        loading = false;
    }
}

export function clearError(): void {
    error = null;
}
