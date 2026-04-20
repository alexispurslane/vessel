/**
 * Settings store — manages app-wide settings like default model and secondary model.
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

export async function setDefaultModel(modelId: string): Promise<boolean> {
    return saveSettings({ defaultModel: modelId });
}

export async function setSecondaryModel(modelId: string): Promise<boolean> {
    return saveSettings({ secondaryModel: modelId });
}

export function clearError(): void {
    error = null;
}
