/**
 * Shared helpers for working with LLM provider APIs.
 */

/**
 * Infer the pi API type from a provider name.
 * Used by session-store and title-generator.
 */
export function inferApiForProvider(provider: string): string | null {
    const apiMap: Record<string, string> = {
        openai: "openai-responses",
        "openai-compatible": "openai-completions",
        anthropic: "anthropic-messages",
        google: "google-generative-ai",
        gemini: "google-generative-ai",
        mistral: "mistral-conversations",
        groq: "openai-completions",
        cerebras: "openai-completions",
        xai: "openai-completions",
        openrouter: "openai-completions",
        ollama: "openai-completions",
        "lm-studio": "openai-completions",
        vllm: "openai-completions",
    };
    return apiMap[provider] ?? null;
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
    const defaults: Record<string, string> = {
        openai: "https://api.openai.com/v1",
        anthropic: "https://api.anthropic.com",
        google: "https://generativelanguage.googleapis.com/v1beta",
        gemini: "https://generativelanguage.googleapis.com/v1beta",
        mistral: "https://api.mistral.ai/v1",
        groq: "https://api.groq.com/openai/v1",
        cerebras: "https://api.cerebras.ai/v1",
        xai: "https://api.x.ai/v1",
        openrouter: "https://openrouter.ai/api/v1",
        ollama: "http://localhost:11434/v1",
        "lm-studio": "http://localhost:1234/v1",
        vllm: "http://localhost:8000/v1",
    };
    return defaults[provider] ?? "https://api.openai.com/v1";
}
