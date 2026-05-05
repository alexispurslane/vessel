/**
 * Notifications store — manages completion notification preferences and dispatches
 * browser notifications, tab title updates, and optional sounds when a long-running
 * generation completes.
 *
 * All notification features are off by default (opt-in via settings).
 * Settings keys stored server-side:
 *   - "notificationBrowser"  → "true" / "false"
 *   - "notificationSound"    → "true" / "false"
 *   - "notificationTabTitle" → "true" / "false"
 */
import { getSettingsStore, saveSettings } from "./settings.svelte.js";

// --- Internal reactive state (not exported directly) ---

let browserEnabled = $state(false);
let soundEnabled = $state(false);
let tabTitleEnabled = $state(false);

let permissionGranted = $state(
    typeof Notification !== "undefined" ? Notification.permission === "granted" : false
);

// Track the original document title so we can restore it
let originalTitle: string | null = null;
let titleTimeout: ReturnType<typeof setTimeout> | null = null;

// --- Public API ---

export function getNotificationsStore() {
    return {
        get browserEnabled() {
            return browserEnabled;
        },
        get soundEnabled() {
            return soundEnabled;
        },
        get tabTitleEnabled() {
            return tabTitleEnabled;
        },
        get permissionGranted() {
            return permissionGranted;
        },
        /** Whether any notification type is enabled */
        get anyEnabled() {
            return browserEnabled || soundEnabled || tabTitleEnabled;
        },
    };
}

/**
 * Sync local state from the settings store (key-value pairs from the server).
 * Called once after settings load and whenever settings change.
 */
export function syncNotificationSettings(): void {
    const settings = getSettingsStore().settings;
    browserEnabled = settings["notificationBrowser"] === "true";
    soundEnabled = settings["notificationSound"] === "true";
    tabTitleEnabled = settings["notificationTabTitle"] === "true";
}

/**
 * Request browser notification permission. Returns the new permission state.
 */
export async function requestBrowserPermission(): Promise<boolean> {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") {
        permissionGranted = true;
        return true;
    }
    if (Notification.permission === "denied") {
        permissionGranted = false;
        return false;
    }
    const result = await Notification.requestPermission();
    permissionGranted = result === "granted";
    return permissionGranted;
}

/**
 * Toggle a notification setting and persist it to the server.
 */
export async function setNotificationSetting(key: string, value: boolean): Promise<void> {
    await saveSettings({ [key]: value ? "true" : "false" });
    syncNotificationSettings();
}

/**
 * Call this when a long-running generation completes.
 * Dispatches the enabled notification types.
 *
 * @param conversationTitle - The title of the conversation that completed
 */
export function notifyCompletion(conversationTitle: string): void {
    if (browserEnabled) {
        sendBrowserNotification(conversationTitle);
    }
    if (soundEnabled) {
        playNotificationSound();
    }
    if (tabTitleEnabled) {
        updateTabTitle(conversationTitle);
    }
}

/**
 * Clear the "(Done)" prefix from the tab title and restore the original.
 * Called when the user returns to the tab or starts a new generation.
 */
export function clearTabTitleNotification(): void {
    if (titleTimeout) {
        clearTimeout(titleTimeout);
        titleTimeout = null;
    }
    if (originalTitle !== null) {
        document.title = originalTitle;
        originalTitle = null;
    }
}

// --- Internal helpers ---

function sendBrowserNotification(title: string): void {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;

    // Only show when the page is not visible (user switched tabs / minimized).
    // document.hasFocus() is unreliable across browsers — visibilityState
    // is the standard API for detecting whether a page is actually visible.
    if (document.visibilityState === "visible") return;

    try {
        const notification = new Notification("Vessel — Generation Complete", {
            body: title || "Your AI response is ready.",
            icon: "/favicon-192x192.png",
            // No tag — reusing a tag can cause silent replacement when the
            // previous notification hasn't been dismissed yet.
        });

        // Focus the tab when the user clicks the notification
        notification.onclick = () => {
            window.focus();
            notification.close();
        };

        // Auto-close after 8 seconds
        setTimeout(function () {
            notification.close();
        }, 8000);
    } catch {
        // Notification constructor can throw on some platforms — fail silently
    }
}

function playNotificationSound(): void {
    try {
        const audio = new Audio("/sounds/notification.mp3");
        audio.volume = 0.5;
        audio.play().catch(() => {
            // Audio playback may fail due to autoplay restrictions — ignore
        });
    } catch {
        // Audio playback may fail due to autoplay restrictions — ignore
    }
}

function updateTabTitle(conversationTitle: string): void {
    // Save the original title only once (before we modify it)
    if (originalTitle === null) {
        originalTitle = document.title;
    }

    const display = conversationTitle || "Vessel";
    document.title = `(Done) ${display}`;

    // Auto-restore the title after 15 seconds
    if (titleTimeout) clearTimeout(titleTimeout);
    titleTimeout = setTimeout(() => {
        document.title = originalTitle ?? "Vessel";
        originalTitle = null;
        titleTimeout = null;
    }, 15000);
}
