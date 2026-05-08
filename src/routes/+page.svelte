<script lang="ts">
    import { goto } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { createConversation } from "$lib/stores/conversations.svelte.js";
    import { getConversations, loadConversations } from "$lib/stores/conversations.svelte.js";
    import { getSettingsStore } from "$lib/stores/settings.svelte.js";
    import { ChatInput } from "$lib/components/chat/index.js";
    import { Button } from "$lib/components/ui/button/index.js";

    import MessageSquare from "@lucide/svelte/icons/message-square";
    import Box from "@lucide/svelte/icons/box";
    import Globe from "@lucide/svelte/icons/globe";
    import Puzzle from "@lucide/svelte/icons/puzzle";
    import Wrench from "@lucide/svelte/icons/wrench";
    import Settings from "@lucide/svelte/icons/settings";
    import ArrowRight from "@lucide/svelte/icons/arrow-right";
    import {
        Tooltip,
        TooltipContent,
        TooltipProvider,
        TooltipTrigger,
    } from "$lib/components/ui/tooltip/index.js";

    import { listModels, listProviders } from "$lib/api.js";
    import type { ModelInfo, ProviderInfo } from "$lib/types.js";
    import { onMount } from "svelte";

    const convs = getConversations();
    const settingsStore = getSettingsStore();
    let inputValue = $state("");
    let isCreating = $state(false);

    // Sandbox quick-toggle states – defaults applied here; actual values
    // restored from localStorage inside onMount (client-only)
    let sandboxOn = $state(true);
    let netAllDomainsOn = $state(false);
    let mcpServersOn = $state(true);
    let agentMode: "agent" | "chat" = $state("agent");

    /** Persist the current toggle states to localStorage */
    function persistToggles() {
        localStorage.setItem("home_sandboxOn", String(sandboxOn));
        localStorage.setItem("home_netAllDomainsOn", String(netAllDomainsOn));
        localStorage.setItem("home_mcpServersOn", String(mcpServersOn));
        localStorage.setItem("home_agentMode", agentMode);
    }
    let availableModels = $state<ModelInfo[]>([]);
    let providers = $state<ProviderInfo[]>([]);
    let isSetupLoading = $state(true);
    let selectedModelId = $state(""); // Just the model ID

    /** Whether the app has at least one provider and one model configured */
    let isSetupComplete = $derived(providers.length > 0 && availableModels.length > 0);

    onMount(async () => {
        void loadConversations();
        try {
            const [modelsResult, providersResult] = await Promise.all([
                listModels(),
                listProviders(),
            ]);
            availableModels = modelsResult;
            providers = providersResult;
        } catch {
            // Models/providers will be empty, setup prompt will show
        } finally {
            isSetupLoading = false;
        }

        // Restore toggle states from localStorage on mount (handles SSR mismatch)
        const storedSandbox = localStorage.getItem("home_sandboxOn");
        if (storedSandbox !== null) sandboxOn = storedSandbox !== "false";
        const storedNetAll = localStorage.getItem("home_netAllDomainsOn");
        if (storedNetAll !== null) netAllDomainsOn = storedNetAll === "true";
        const storedMcp = localStorage.getItem("home_mcpServersOn");
        if (storedMcp !== null) mcpServersOn = storedMcp !== "false";
        const storedAgent = localStorage.getItem("home_agentMode");
        if (storedAgent !== null) agentMode = storedAgent === "chat" ? "chat" : "agent";
    });

    // Initialize model selector: set the default model once settings load,
    // or fall back to the first available model. We only apply the default
    // once to avoid overwriting a manual user selection.
    let defaultApplied = $state(false);

    $effect(() => {
        // When models are loaded and no model is selected yet, use the fallback
        if (availableModels.length > 0 && !selectedModelId && !defaultApplied) {
            selectedModelId = availableModels[0]?.id || "";
        }
        // When the default model setting becomes available, override the fallback
        if (!defaultApplied && settingsStore.defaultModel) {
            selectedModelId = settingsStore.defaultModel;
            defaultApplied = true;
        }
    });

    // Get last 5 conversations
    let recentConversations = $derived(convs.list.slice(0, 5));

    async function handleStartChat() {
        if (!inputValue.trim() || isCreating) return;
        isCreating = true;
        const messageText = inputValue.trim();
        const id = await createConversation(undefined, selectedModelId || undefined);
        if (id) {
            // Navigate to chat page with the initial message and model selection
            // as URL params. The chat page sends after connecting to the SSE stream.
            isCreating = false;
            // oxlint-disable-next-line secure-coding/no-ldap-injection -- URL params, not LDAP
            let url = `/chat/${id}?initialMessage=${encodeURIComponent(messageText)}`;
            if (selectedModelId) {
                url += `&initialModel=${encodeURIComponent(selectedModelId)}`;
            }
            // Sandbox quick-toggle query params
            // (always send so conversation gets explicit settings)
            url += `&sandboxOn=${String(sandboxOn)}`;
            url += `&netAllDomainsOn=${String(netAllDomainsOn)}`;
            url += `&mcpServersOn=${String(mcpServersOn)}`;
            url += `&agentMode=${agentMode}`;
            persistToggles();
            // @ts-expect-error
            // dynamic URL with query params can't satisfy SvelteKit typed routes
            void goto(resolve(url));
        } else {
            isCreating = false;
        }
    }

    function selectConversation(id: string) {
        void goto(resolve(`/chat/${id}`));
    }
</script>

<div class="flex flex-1 flex-col items-center justify-center p-4">
    <div class="w-full max-w-2xl">
        {#if isSetupLoading}
            <!-- Loading state -->
            <div class="flex items-center justify-center py-16">
                <div
                    class="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
                ></div>
            </div>
        {:else if !isSetupComplete}
            <!-- Setup prompt -->
            <div class="text-center">
                <div
                    class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted overflow-hidden"
                >
                    <img src="/vessel.png" alt="Vessel" class="size-16 rounded-full" />
                </div>
                <h1 class="text-2xl font-bold">Welcome to Vessel</h1>
                <p class="mt-2 text-muted-foreground">
                    Before you can start chatting, you need to add at least one provider and model.
                </p>

                <div class="mt-8 space-y-3 text-left">
                    {#if providers.length === 0}
                        <div class="rounded-lg border p-4">
                            <div class="flex items-center gap-3">
                                <div
                                    class="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold"
                                >
                                    1
                                </div>
                                <div>
                                    <p class="font-medium">Add an API provider</p>
                                    <p class="text-sm text-muted-foreground">
                                        Configure an LLM provider like OpenAI, Anthropic, or Ollama.
                                    </p>
                                </div>
                            </div>
                        </div>
                    {/if}
                    {#if providers.length > 0 && availableModels.length === 0}
                        <div class="rounded-lg border p-4">
                            <div class="flex items-center gap-3">
                                <div
                                    class="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold"
                                >
                                    1
                                </div>
                                <div>
                                    <p class="font-medium">Add a model</p>
                                    <p class="text-sm text-muted-foreground">
                                        Define a model from one of your configured providers, or
                                        fetch models automatically.
                                    </p>
                                </div>
                            </div>
                        </div>
                    {/if}
                </div>

                <Button class="mt-6" onclick={() => goto(resolve("/settings"))}>
                    <Settings class="mr-2 h-4 w-4" />
                    Go to Settings
                    <ArrowRight class="ml-2 h-4 w-4" />
                </Button>
            </div>
        {:else}
            <!-- Logo/Header -->
            <div class="mb-8 text-center">
                <div
                    class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted overflow-hidden"
                >
                    <img src="/vessel.png" alt="Vessel" class="size-16 rounded-full" />
                </div>
                <h1 class="text-2xl font-bold">Vessel</h1>
                <p class="mt-2 text-muted-foreground">Start a conversation with a message</p>
            </div>

            <!-- Input Box -->
            <div class="mb-6">
                <ChatInput
                    bind:value={inputValue}
                    placeholder="Type your message..."
                    disabled={isCreating}
                    connected={true}
                    generating={false}
                    models={availableModels}
                    bind:selectedModelId
                    conversationDefaultModelId={settingsStore.defaultModel}
                    globalDefaultModelId={settingsStore.defaultModel}
                    onsend={handleStartChat}
                />

                <!-- Sandbox quick-toggle buttons -->
                <div class="flex items-center gap-1 mt-2">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                {#snippet child({ props })}
                                    <button
                                        {...props}
                                        type="button"
                                        class="inline-flex items-center justify-center size-7 rounded-md transition-colors {sandboxOn
                                            ? 'bg-primary text-primary-foreground'
                                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
                                        onclick={() => (sandboxOn = !sandboxOn)}
                                        aria-label="Toggle sandbox"
                                    >
                                        <Box class="size-4" />
                                    </button>
                                {/snippet}
                            </TooltipTrigger>
                            <TooltipContent>Sandbox</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                {#snippet child({ props })}
                                    <button
                                        {...props}
                                        type="button"
                                        class="inline-flex items-center justify-center size-7 rounded-md transition-colors {netAllDomainsOn
                                            ? 'bg-primary text-primary-foreground'
                                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
                                        onclick={() => (netAllDomainsOn = !netAllDomainsOn)}
                                        aria-label="Toggle network & all domains"
                                    >
                                        <Globe class="size-4" />
                                    </button>
                                {/snippet}
                            </TooltipTrigger>
                            <TooltipContent>Network &amp; all domains</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                {#snippet child({ props })}
                                    <button
                                        {...props}
                                        type="button"
                                        class="inline-flex items-center justify-center size-7 rounded-md transition-colors {mcpServersOn
                                            ? 'bg-primary text-primary-foreground'
                                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
                                        onclick={() => (mcpServersOn = !mcpServersOn)}
                                        aria-label="Toggle MCP servers"
                                    >
                                        <Puzzle class="size-4" />
                                    </button>
                                {/snippet}
                            </TooltipTrigger>
                            <TooltipContent>MCP servers</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                {#snippet child({ props })}
                                    <button
                                        {...props}
                                        type="button"
                                        class="inline-flex items-center justify-center size-7 rounded-md transition-colors {agentMode ===
                                        'agent'
                                            ? 'bg-primary text-primary-foreground'
                                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
                                        onclick={() =>
                                            (agentMode = agentMode === "agent" ? "chat" : "agent")}
                                        aria-label="Toggle agent/chat mode"
                                    >
                                        <Wrench class="size-4" />
                                    </button>
                                {/snippet}
                            </TooltipTrigger>
                            <TooltipContent
                                >{agentMode === "agent"
                                    ? "Agent mode (tools on)"
                                    : "Chat mode (tools off)"}</TooltipContent
                            >
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>

            <!-- Recent Chats -->
            {#if recentConversations.length > 0}
                <div class="w-full">
                    <h2 class="mb-3 text-sm font-medium text-muted-foreground">
                        Recent Conversations
                    </h2>
                    <div class="space-y-1">
                        {#each recentConversations as conv (conv.id)}
                            <Button
                                variant="ghost"
                                class="w-full justify-start gap-3 px-3 py-2 h-auto text-left"
                                onclick={() => {
                                    selectConversation(conv.id);
                                }}
                            >
                                <MessageSquare class="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span class="truncate">{conv.title}</span>
                            </Button>
                        {/each}
                    </div>
                </div>
            {/if}
        {/if}
    </div>
</div>
