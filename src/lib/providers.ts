/**
 * @file Central provider configuration.
 *
 * Single source of truth for all provider metadata: display names,
 * API types, default base URLs, and feature flags. Both frontend
 * and backend import from here.
 */

export interface ProviderConfig {
    /** Machine-readable provider ID (e.g., "openai", "anthropic") */
    id: string;
    /** Human-readable display name */
    displayName: string;
    /** The pi API type this provider uses */
    api: string;
    /** Default base URL for this provider's API */
    defaultBaseUrl: string;
    /** Whether this provider uses an OpenAI-compatible /v1/models endpoint */
    openaiCompatible: boolean;
}

export const PROVIDERS: ProviderConfig[] = [
    {
        id: "openai",
        displayName: "OpenAI",
        api: "openai-responses",
        defaultBaseUrl: "https://api.openai.com/v1",
        openaiCompatible: false,
    },
    {
        id: "openai-compatible",
        displayName: "OpenAI Compatible",
        api: "openai-completions",
        defaultBaseUrl: "https://api.openai.com/v1",
        openaiCompatible: true,
    },
    {
        id: "anthropic",
        displayName: "Anthropic",
        api: "anthropic-messages",
        defaultBaseUrl: "https://api.anthropic.com",
        openaiCompatible: false,
    },
    {
        id: "google",
        displayName: "Google",
        api: "google-generative-ai",
        defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        openaiCompatible: false,
    },
    {
        id: "gemini",
        displayName: "Gemini",
        api: "google-generative-ai",
        defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        openaiCompatible: false,
    },
    {
        id: "mistral",
        displayName: "Mistral",
        api: "mistral-conversations",
        defaultBaseUrl: "https://api.mistral.ai/v1",
        openaiCompatible: false,
    },
    {
        id: "groq",
        displayName: "Groq",
        api: "openai-completions",
        defaultBaseUrl: "https://api.groq.com/openai/v1",
        openaiCompatible: true,
    },
    {
        id: "cerebras",
        displayName: "Cerebras",
        api: "openai-completions",
        defaultBaseUrl: "https://api.cerebras.ai/v1",
        openaiCompatible: true,
    },
    {
        id: "xai",
        displayName: "xAI",
        api: "openai-completions",
        defaultBaseUrl: "https://api.x.ai/v1",
        openaiCompatible: true,
    },
    {
        id: "openrouter",
        displayName: "OpenRouter",
        api: "openai-completions",
        defaultBaseUrl: "https://openrouter.ai/api/v1",
        openaiCompatible: true,
    },
    {
        id: "ollama",
        displayName: "Ollama",
        api: "openai-completions",
        defaultBaseUrl: "http://localhost:11434/v1",
        openaiCompatible: true,
    },
    {
        id: "lm-studio",
        displayName: "LM Studio",
        api: "openai-completions",
        defaultBaseUrl: "http://localhost:1234/v1",
        openaiCompatible: true,
    },
    {
        id: "vllm",
        displayName: "vLLM",
        api: "openai-completions",
        defaultBaseUrl: "http://localhost:8000/v1",
        openaiCompatible: true,
    },
];

/** Lookup map from provider ID to its config */
const providerById = new Map(PROVIDERS.map((p) => [p.id, p]));

/**
 * Get a provider config by ID, or undefined if not found.
 *
 * @param id - The provider ID
 * @returns The provider config, or undefined
 */
export function getProviderConfig(id: string): ProviderConfig | undefined {
    return providerById.get(id);
}

/**
 * Check if a provider uses an OpenAI-compatible API.
 *
 * @param id - The provider ID
 * @returns Whether the provider is OpenAI-compatible
 */
export function isOpenAICompatibleProvider(id: string): boolean {
    return providerById.get(id)?.openaiCompatible ?? false;
}

/**
 * Get the list of provider IDs for dropdowns.
 *
 * @returns Array of provider ID strings
 */
export function getProviderIds(): string[] {
    return PROVIDERS.map((p) => p.id);
}

/**
 * Get the list of distinct API types.
 *
 * @returns Array of unique API type strings
 */
export function getApiTypes(): string[] {
    return [...new Set(PROVIDERS.map((p) => p.api))];
}
