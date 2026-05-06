/**
 * @file Settings store — manages app-wide settings like default model and secondary model.
 */
import {
    getSettings as apiGet,
    updateSettings as apiUpdate,
    listModels as apiListModels,
} from "$lib/api.js";
import type { ModelInfo } from "$lib/types.js";

let settings = $state<Record<string, string>>({});
let models = $state<ModelInfo[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);

/**
 * Get the settings store state.
 *
 * @returns Settings store accessors
 */
export function getSettingsStore() {
    return {
        get settings() {
            return settings;
        },
        get models() {
            return models;
        },
        get loading() {
            return loading;
        },
        get error() {
            return error;
        },
        get defaultModel() {
            return settings["defaultModel"] ?? "";
        },
        get secondaryModel() {
            return settings["secondaryModel"] ?? "";
        },
    };
}

/**
 * Load settings and available models from the server.
 *
 * @returns {void}
 */
export async function loadSettings(): Promise<void> {
    loading = true;
    error = null;
    try {
        const [settingsResult, modelsResult] = await Promise.all([apiGet(), apiListModels()]);
        settings = settingsResult;
        models = modelsResult;
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to load settings";
    } finally {
        loading = false;
    }
}

/**
 * Save updated settings to the server.
 *
 * @param updates - Key-value pairs to update
 * @returns Whether the save succeeded
 */
export async function saveSettings(updates: Record<string, string>): Promise<boolean> {
    error = null;
    try {
        await apiUpdate(updates);
        settings = { ...settings, ...updates };
        return true;
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to save settings";
        return false;
    }
}

/**
 * Set the default model and persist to server.
 *
 * @param modelId - The model ID to set as default
 * @returns Whether the save succeeded
 */
export async function setDefaultModel(modelId: string): Promise<boolean> {
    return saveSettings({ defaultModel: modelId });
}

/**
 * Set the secondary model and persist to server.
 *
 * @param modelId - The model ID to set as secondary
 * @returns Whether the save succeeded
 */
export async function setSecondaryModel(modelId: string): Promise<boolean> {
    return saveSettings({ secondaryModel: modelId });
}

/**
 * Clear the current error message.
 *
 * @returns {void}
 */
export function clearError(): void {
    error = null;
}
