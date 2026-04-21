<script lang="ts">
    import { page } from "$app/stores";
    import {
        getChat,
        send,
        abort,
        connectStream,
        disconnectStream,
        deleteMessage,
        editMessage,
    } from "$lib/stores/chat.svelte.js";
    import { getConversations } from "$lib/stores/conversations.svelte.js";
    import { getAuth } from "$lib/stores/auth.svelte.js";
    import { getSettingsStore } from "$lib/stores/settings.svelte.js";
    import {
        ChatAvatar,
        ChatMessage,
        ChatInput,
        ThinkingGroup,
    } from "$lib/components/chat/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area";
    import { Spinner } from "$lib/components/ui/spinner/index.js";
    import Bot from "@lucide/svelte/icons/bot";
    import { listModels } from "$lib/api.js";
    import type { ModelInfo, RenderItem, ThinkingGroup as ThinkingGroupType } from "$lib/types.js";
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";

    let id = $derived($page.params.id);
    const chat = getChat();
    const conversations = getConversations();
    const auth = getAuth();
    const settingsStore = getSettingsStore();

    // Session storage key for in-progress message draft, scoped per conversation
    function draftKey(conversationId: string) {
        return `chat-draft:${conversationId}`;
    }

    let inputText = $state("");
    let viewportEl = $state<HTMLElement | null>(null);
    let availableModels = $state<ModelInfo[]>([]);
    let selectedModelId = $state(""); // Just the model ID — provider is resolved automatically
    let thinkingOpen = $state<Record<string, boolean>>({}); // item id -> whether thinking is expanded

    /** Whether an assistant message is "intermediate" — thinking/tool calls only, no visible text for the user.
     *  These get grouped into ThinkingGroups in the render layer.
     *
     *  Important: a message that is still streaming might start with thinking/tool calls
     *  and later receive text content, so we only group non-streaming messages that
     *  definitively have no content. Streaming messages with thinking but no content yet
     *  are still grouped (they'll stay in the group since tool calls always precede final text
     *  in the agent loop — the text comes in a NEW message/turn). */
    function isIntermediateAssistant(msg: typeof chat.messages[number]): boolean {
        if (msg.role !== "assistant") return false;
        // If it has visible text content (non-empty after trimming), it's not intermediate
        if (msg.content && msg.content.trim()) return false;
        // If it has thinking or tool calls, it IS intermediate
        if (msg.thinking || msg.thinkingStreaming || (msg.toolCalls && msg.toolCalls.length > 0)) return true;
        // Error messages with content are not intermediate
        if (msg.isError) return false;
        // Empty assistant messages with no thinking/tools are not intermediate either
        return false;
    }

    /** Transform the flat message list into render items, grouping consecutive intermediate
     *  assistant messages into single ThinkingGroups with interleaved thinking + tool calls. */
    let renderItems: RenderItem[] = $derived.by(() => {
        const items: RenderItem[] = [];
        let currentGroup: ThinkingGroupType | null = null;

        for (const msg of chat.messages) {
            if (isIntermediateAssistant(msg)) {
                // This message belongs in a thinking group
                if (!currentGroup) {
                    currentGroup = {
                        type: "thinkingGroup",
                        id: `group-${msg.id}`,
                        steps: [],
                        streaming: false,
                        model: msg.model,
                        modelProvider: msg.modelProvider,
                        messageIds: [],
                    };
                }

                // Add thinking step (if present)
                if (msg.thinking || msg.thinkingStreaming) {
                    currentGroup.steps.push({
                        id: `${msg.id}-thinking`,
                        messageId: msg.id,
                        type: "thinking",
                        thinking: msg.thinking,
                        streaming: msg.thinkingStreaming,
                    });
                    if (msg.thinkingStreaming) currentGroup.streaming = true;
                }

                // Add tool call steps (interleaved after the thinking)
                if (msg.toolCalls) {
                    for (let i = 0; i < msg.toolCalls.length; i++) {
                        const tc = msg.toolCalls[i];
                        currentGroup.steps.push({
                            id: `${msg.id}-tool-${i}`,
                            messageId: msg.id,
                            type: "toolCall",
                            toolCall: tc,
                            streaming: tc.status === "running",
                        });
                        if (tc.status === "running") currentGroup.streaming = true;
                    }
                }

                currentGroup.messageIds.push(msg.id);
                if (msg.model) currentGroup.model = msg.model;
                if (msg.modelProvider) currentGroup.modelProvider = msg.modelProvider;
            } else {
                // This message breaks any current group
                if (currentGroup) {
                    items.push(currentGroup);
                    currentGroup = null;
                }
                items.push({ type: "message", msg });
            }
        }

        // Don't forget the last group
        if (currentGroup) {
            items.push(currentGroup);
        }

        return items;
    });

    // Auto-collapse thinking dropdowns when a group or message transitions from streaming to done
    $effect(() => {
        for (const item of renderItems) {
            if (item.type === "thinkingGroup") {
                // When streaming has stopped and we haven't explicitly set open state, close it
                if (!item.streaming && thinkingOpen[item.id] === undefined) {
                    thinkingOpen[item.id] = false;
                }
            } else {
                const msg = item.msg;
                if (msg.thinkingStreaming === false && thinkingOpen[msg.id] === undefined && msg.thinking) {
                    thinkingOpen[msg.id] = false;
                }
            }
        }
    });

    onMount(async () => {
        try {
            availableModels = await listModels();
        } catch {
            // Models will be empty, user can still chat with default
        }
    });

    // Initialize model selector: set the default model once settings load,
    // or fall back to the first available model. We only apply the default
    // once to avoid overwriting a manual user selection or conversation model.
    let defaultApplied = $state(false);
    let conversationTitle = $state("New Chat");

    $effect(() => {
        const conversationInfo = conversations.list.find((x) => x.id === chat.conversationId);
        if (!!conversationInfo) {
            conversationTitle = conversationInfo.title;
        }
    });

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

    // Persist in-progress message to sessionStorage so it survives page reloads
    $effect(() => {
        if (id) {
            const key = draftKey(id);
            if (inputText.trim()) {
                sessionStorage.setItem(key, inputText);
            } else {
                sessionStorage.removeItem(key);
            }
        }
    });

    // Connect to SSE stream on mount and when the conversation id changes; disconnect on cleanup
    $effect(() => {
        const currentId = id;
        if (currentId) {
            connectStream(currentId).then(() => {
                // After connecting (which loads history), set model selector to last used model
                if (chat.lastModel) {
                    selectedModelId = chat.lastModel.modelId;
                    defaultApplied = true; // prevent default from overwriting conversation model
                }

                // Restore in-progress draft from sessionStorage if one exists
                const saved = sessionStorage.getItem(draftKey(currentId));
                if (saved) {
                    inputText = saved;
                }

                // If an initial message was passed (e.g., from the home page), send it now
                const initialMessage = $page.url.searchParams.get("initialMessage");
                const initialModel = $page.url.searchParams.get("initialModel");
                if (initialMessage) {
                    // Use the model ID directly — provider is resolved automatically
                    const modelId = initialModel || selectedModelId;
                    if (modelId) {
                        selectedModelId = modelId;
                    }
                    send(initialMessage, modelId);
                    // Clear the draft and the URL params to avoid re-sending on refresh/reconnect
                    sessionStorage.removeItem(draftKey(currentId));
                    goto(`/chat/${currentId}`, { replaceState: true });
                }
            });
        }
        return () => disconnectStream();
    });

    // Auto-scroll to bottom when messages arrive or streaming content updates
    $effect(() => {
        const count = chat.messages.length;
        const lastMsg = chat.messages[count - 1];
        // Track all reactive content so we re-scroll as deltas arrive
        const _content = lastMsg?.content;
        const _thinking = lastMsg?.thinking;
        const _streaming = lastMsg?.streaming;
        const _thinkingStreaming = lastMsg?.thinkingStreaming;

        // Use nested rAF: first waits for Svelte's DOM update,
        // second ensures the browser has painted the new content
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (viewportEl) {
                    viewportEl.scrollTop = viewportEl.scrollHeight;
                }
            });
        });
    });

    function handleSend() {
        const text = inputText.trim();
        if (!text || !chat.connected || chat.generating) return;
        // Provider is resolved automatically from the model ID on the backend
        send(text, selectedModelId || undefined);
        inputText = "";
        // Clear the draft from sessionStorage since the message has been sent
        sessionStorage.removeItem(draftKey(id));
    }

    function handleAbort() {
        abort();
    }

    // Look up a model's display name from the available models list.
    // Model IDs are unique, so we only need the modelId to find it.
    // Falls back to the modelId if not found.
    function getModelDisplayName(modelId: string | undefined): string {
        if (!modelId) return "AI";
        const found = availableModels.find((m) => m.id === modelId);
        return found?.name || modelId;
    }

    function handleDeleteMessage(messageId: string, role: string) {
        deleteMessage(messageId, role);
    }

    function handleEditMessage(messageId: string, role: string, newText?: string) {
        editMessage(messageId, role, newText);
    }
</script>

<svelte:head>
    <title>Vessel - {conversationTitle}</title>
</svelte:head>

<div class="h-full w-full flex flex-col overflow-hidden min-w-0 max-w-[100ch] mx-auto">
    <!-- Message area -->
    <ScrollArea class="flex-1 min-h-0 overflow-hidden" bind:viewportRef={viewportEl}>
        <div class="flex flex-col gap-6 p-6">
            {#if chat.messages.length === 0}
                <div class="flex items-center justify-center py-24">
                    <div class="flex flex-col items-center gap-4 text-muted-foreground">
                        <div class="rounded-full bg-muted p-4">
                            <Bot class="size-8 opacity-60" />
                        </div>
                        <div class="text-center">
                            <p class="text-sm font-medium">Start a conversation</p>
                            <p class="text-xs mt-1 opacity-70">
                                Send a message to begin chatting with the AI assistant.
                            </p>
                        </div>
                    </div>
                </div>
            {:else}
                {#each renderItems as item, i (item.type === "thinkingGroup" ? item.id : item.msg.id)}
                    {#if item.type === "thinkingGroup"}
                        <!-- Grouped thinking + tool calls -->
                        <div class="flex w-full justify-start">
                            <div class="flex gap-3 w-[min(75%,65ch)] font-serif">
                                <ChatAvatar
                                    role="assistant"
                                    isConsecutive={false}
                                    model={item.model}
                                    modelProvider={item.modelProvider}
                                    {getModelDisplayName}
                                    hasContent={true}
                                />
                                <div class="min-w-0 flex-1">
                                    <ThinkingGroup
                                        group={item}
                                        thinkingIsOpen={thinkingOpen[item.id]}
                                        onthinkingtoggle={(open) => (thinkingOpen[item.id] = open)}
                                    />
                                </div>
                            </div>
                        </div>
                    {:else}
                        {@const msg = item.msg}
                        {@const nextItem = renderItems[i + 1]}
                        {@const isLastConsecutive = nextItem?.type !== "message" || nextItem.msg.role !== msg.role}
                        <div class="flex w-full {msg.role === 'user' ? 'justify-end' : 'justify-start'} {!isLastConsecutive ? '-mt-4' : ''}">
                            <div
                                class="flex gap-3 w-[min(75%,65ch)] font-serif {msg.role === 'user'
                                    ? 'flex-row-reverse items-end'
                                    : ''}"
                            >
                                <!-- Avatar -->
                                <ChatAvatar
                                    role={msg.role}
                                    isConsecutive={!isLastConsecutive}
                                    username={auth.username}
                                    model={msg.model}
                                    modelProvider={msg.modelProvider}
                                    {getModelDisplayName}
                                    hasContent={!!(msg.content || msg.thinking)}
                                />

                                <!-- Message bubble and tool calls -->
                                <div class="min-w-0 flex-1">
                                <ChatMessage
                                    {msg}
                                    thinkingIsOpen={thinkingOpen[msg.id]}
                                    onthinkingtoggle={(open) => (thinkingOpen[msg.id] = open)}
                                    scrollContainer={viewportEl}
                                    ondelete={handleDeleteMessage}
                                    onedit={handleEditMessage}
                                    navigating={chat.navigating}
                                />
                                </div>
                            </div>
                        </div>
                    {/if}
                {/each}
            {/if}
        </div>
    </ScrollArea>

    <!-- Input area -->
    <div class="shrink-0 px-4 py-3 bg-background">
        <ChatInput
            bind:value={inputText}
            placeholder={chat.connected ? "Type a message..." : "Connecting..."}
            disabled={!chat.connected}
            generating={chat.generating}
            connected={chat.connected}
            models={availableModels}
            bind:selectedModelId
            defaultModelId={settingsStore.defaultModel}
            onsend={handleSend}
            onabort={handleAbort}
        />
        <!-- Connection status / error -->
        <div class="flex items-center gap-1.5 mt-1.5 min-h-4">
            {#if chat.error}
                <p class="text-xs text-destructive">{chat.error}</p>
            {:else if !chat.connected}
                <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span class="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse"
                    ></span>
                    Connecting...
                </span>
            {:else if chat.generating}
                <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Spinner class="size-3" />
                    Generating...
                </span>
            {/if}
        </div>
    </div>
</div>
