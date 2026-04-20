<script lang="ts">
    import { goto } from "$app/navigation";
    import { createConversation } from "$lib/stores/conversations.svelte.js";
    import { getConversations, loadConversations } from "$lib/stores/conversations.svelte.js";
    import { getSettingsStore } from "$lib/stores/settings.svelte.js";
    import { ChatInput } from "$lib/components/chat/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import MessageSquare from "@lucide/svelte/icons/message-square";
    import Bot from "@lucide/svelte/icons/bot";
    import { listModels } from "$lib/api.js";
    import type { ModelInfo } from "$lib/types.js";
    import { onMount } from "svelte";

    const convs = getConversations();
    const settingsStore = getSettingsStore();
    let inputValue = $state("");
    let isCreating = $state(false);
    let availableModels = $state<ModelInfo[]>([]);
    let selectedModelId = $state(""); // Just the model ID

    onMount(async () => {
        loadConversations();
        try {
            availableModels = await listModels();
        } catch {
            // Models will be empty, user can still chat with default
        }
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
        const id = await createConversation();
        if (id) {
            // Navigate to chat page with the initial message and model selection as URL parameters.
            // The chat page will send the message after connecting to the SSE stream,
            // ensuring the user message is displayed immediately and the response streams properly.
            isCreating = false;
            let url = `/chat/${id}?initialMessage=${encodeURIComponent(messageText)}`;
            if (selectedModelId) {
                url += `&initialModel=${encodeURIComponent(selectedModelId)}`;
            }
            goto(url);
        } else {
            isCreating = false;
        }
    }

    function selectConversation(id: string) {
        goto(`/chat/${id}`);
    }
</script>

<div class="flex flex-1 flex-col items-center justify-center p-4">
    <div class="w-full max-w-2xl">
        <!-- Logo/Header -->
        <div class="mb-8 text-center">
            <div
                class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted"
            >
                <Bot class="size-8 text-muted-foreground" />
            </div>
            <h1 class="text-2xl font-bold">TalkAI</h1>
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
                defaultModelId={settingsStore.defaultModel}
                onsend={handleStartChat}
            />
        </div>

        <!-- Recent Chats -->
        {#if recentConversations.length > 0}
            <div class="w-full">
                <h2 class="mb-3 text-sm font-medium text-muted-foreground">Recent Conversations</h2>
                <div class="space-y-1">
                    {#each recentConversations as conv (conv.id)}
                        <Button
                            variant="ghost"
                            class="w-full justify-start gap-3 px-3 py-2 h-auto text-left"
                            onclick={() => selectConversation(conv.id)}
                        >
                            <MessageSquare class="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span class="truncate">{conv.title}</span>
                        </Button>
                    {/each}
                </div>
            </div>
        {/if}
    </div>
</div>
