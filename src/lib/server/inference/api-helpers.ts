/**
 * Shared helpers for working with LLM provider APIs.
 */

import { getProviderConfig } from "$lib/providers.js";

/**
 * Infer the pi API type from a provider name.
 * Used by session-store and title-generator.
 */
export function inferApiForProvider(provider: string): string | null {
    return getProviderConfig(provider)?.api ?? null;
}

/**
 * Check if a provider uses an Anthropic-style API.
 */
export function isAnthropicApi(provider: string): boolean {
    return inferApiForProvider(provider) === "anthropic-messages";
}

/**
 * Get the default base URL for a provider.
 */
export function getDefaultBaseUrl(provider: string): string {
    return getProviderConfig(provider)?.defaultBaseUrl ?? "https://api.openai.com/v1";
}
