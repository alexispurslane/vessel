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
        editAssistantMessage,
        reloadMessages,
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
    import Bot from "@lucide/svelte/icons/bot";
    import { listModels, getSessionTree, setSessionLeaf, updateConversationSettings } from "$lib/api.js";
    import type { ChatMessage as ChatMessageType, ConversationSettings, ModelInfo, RenderItem, ThinkingGroup as ThinkingGroupType } from "$lib/types.js";
    import type { SessionTreeNodeData } from "$lib/api.js";
    import { MessageDag } from "$lib/components/chat/index.js";
    import GitBranch from "@lucide/svelte/icons/git-branch";
    import Shield from "@lucide/svelte/icons/shield";
    import FileText from "@lucide/svelte/icons/file-text";
    import { onMount, untrack } from "svelte";
    import { fade } from "svelte/transition";
    import { goto } from "$app/navigation";
    import { ContextUsageRing } from "$lib/components/ui/context-usage-ring";
    import ArrowUp from "@lucide/svelte/icons/arrow-up";
    import ArrowDown from "@lucide/svelte/icons/arrow-down";
    import {
        Tooltip,
        TooltipContent,
        TooltipProvider,
        TooltipTrigger,
    } from "$lib/components/ui/tooltip";
    import { Skeleton } from "$lib/components/ui/skeleton";
    import ConversationSecurityPanel from "$lib/components/conversation-settings/ConversationSecurityPanel.svelte";
    import AgentInfoPanel from "$lib/components/conversation-settings/AgentInfoPanel.svelte";

    let id = $derived($page.params.id);
    const chat = getChat();
    const conversations = getConversations();
    const auth = getAuth();
    const settingsStore = getSettingsStore();

    // Whether the chat store has taken over from SSR data.
    // Initially false (renders from $page.data.messages), set to true once
    // connectStream populates the live store — then chat.messages drives rendering.
    let hydrated = $state(false);

    // Messages to render: SSR data first, then live chat store after hydration.
    // This gives us true SSR — messages in the HTML before JS runs — while
    // seamlessly transitioning to the live SSE-driven store once the client takes over.
    let displayMessages = $derived.by(() => {
        if (hydrated) return chat.messages;
        // SSR path: use pre-converted ChatMessage[] from the server load.
        // Fall back to empty array if no SSR data (shouldn't normally happen).
        return $page.data.messages ?? [];
    });

    // Session storage key for in-progress message draft, scoped per conversation
    function draftKey(conversationId: string) {
        return `chat-draft:${conversationId}`;
    }

    let inputText = $state("");
    let viewportEl = $state<HTMLElement | null>(null);
    let availableModels = $state<ModelInfo[]>([]);
    let selectedModelId = $state(""); // Just the model ID — provider is resolved automatically
    let thinkingOpen = $state<Record<string, boolean>>({}); // item id -> whether thinking is expanded

    // DAG history sidebar state
    let dagOpen = $state(false);

    // Security panel state
    let securityOpen = $state(false);
    // Agent info panel state
    let agentInfoOpen = $state(false);
    // Top bar auto-hide state
    let topBarVisible = $state(false);
    let topBarTimeout: ReturnType<typeof setTimeout> | null = null;
    const TOP_BAR_HIDE_DELAY = 2000; // ms before auto-hiding

    function showTopBar() {
        if (topBarTimeout) {
            clearTimeout(topBarTimeout);
            topBarTimeout = null;
        }
        topBarVisible = true;
        // Schedule auto-hide
        topBarTimeout = setTimeout(() => {
            topBarVisible = false;
            topBarTimeout = null;
        }, TOP_BAR_HIDE_DELAY);
    }

    function hideTopBar() {
        if (topBarTimeout) {
            clearTimeout(topBarTimeout);
            topBarTimeout = null;
        }
        topBarVisible = false;
    }

    let dagNodes = $state<SessionTreeNodeData[]>([]);
    let dagLeafId = $state<string | null>(null);
    let dagLoading = $state(false);

    // Context window usage fraction (based on currently selected model)
    let contextUsageFraction = $derived.by(() => {
        const model = availableModels.find((m) => m.id === selectedModelId);
        if (!model || model.contextWindow <= 0) return 0;
        const totalTokens = chat.totalInputTokens + chat.totalOutputTokens;
        return totalTokens / model.contextWindow;
    });

    // Format token counts with k/M suffixes
    function formatTokens(n: number): string {
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
        if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
        return String(n);
    }

    // Whether we're waiting for the model to start responding
    // (generating is true but no assistant message has visible content yet)
    let waitingForResponse = $derived.by(() => {
        if (!chat.generating) return false;
        // Check if any assistant message is currently streaming with content
        const streamingMsg = displayMessages.find((m) => m.streaming);
        if (!streamingMsg) return true; // no streaming message at all yet
        // If the streaming message has no content, thinking, or tool calls, we're still waiting
        if (!streamingMsg.content?.trim() && !streamingMsg.thinking && !streamingMsg.thinkingStreaming && !(streamingMsg.toolCalls && streamingMsg.toolCalls.length > 0)) {
            return true;
        }
        return false;
    });

    /** Whether an assistant message is "intermediate" — thinking/tool calls only, no visible text for the user.
     *  These get grouped into ThinkingGroups in the render layer.
     *
     *  Important: a message that is still streaming might start with thinking/tool calls
     *  and later receive text content, so we only group non-streaming messages that
     *  definitively have no content. Streaming messages with thinking but no content yet
     *  are still grouped (they'll stay in the group since tool calls always precede final text
     *  in the agent loop — the text comes in a NEW message/turn). */
    function isIntermediateAssistant(msg: ChatMessageType): boolean {
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

        for (const msg of displayMessages) {
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
        // When SSR provides a lastModel and no model is selected yet, use it
        // (this runs before connectStream, so chat.lastModel is still empty)
        if (!defaultApplied && $page.data.lastModel) {
            selectedModelId = $page.data.lastModel.modelId;
            defaultApplied = true;
        }
    });

    // Persist in-progress message to sessionStorage so it survives page reloads.
    // We skip clearing sessionStorage until after the draft has been restored
    // (or we've confirmed no draft exists) — otherwise the $effect fires on page
    // load with inputText="" and deletes the saved draft before connectStream
    // can restore it.
    let draftRestored = $state(false);

    $effect(() => {
        if (id && draftRestored) {
            const key = draftKey(id);
            if (inputText.trim()) {
                sessionStorage.setItem(key, inputText);
            } else {
                sessionStorage.removeItem(key);
            }
        }
    });

    // Connect to SSE stream on mount and when the conversation id changes; disconnect on cleanup.
    // Use untrack() so reactive reads inside connectStream/disconnectStream
    // (e.g. reading `generating`, `currentConversationId`) don't become
    // dependencies of this effect — only `id` is tracked.
    // Without untrack, the effect would re-run every time `generating`
    // changes during streaming, creating an infinite disconnect/reconnect loop.
    //
    // When SSR data is available (from +page.server.ts), we pass it to connectStream
    // as preloadedHistory, which skips the client-side fetch and populates the chat store
    // immediately. The rendering starts from $page.data.messages (SSR HTML), then
    // transitions to chat.messages (live store) once hydrated=true after connectStream completes.
    $effect(() => {
        const currentId = id;
        // Reset the draft-restored flag — the new conversation's draft hasn't been restored yet
        draftRestored = false;
        // Reset hydrated — we want to render from SSR data for the new conversation first,
        // then transition to the live store once connectStream completes.
        hydrated = false;
        if (currentId) {
            untrack(() => {
                // Use SSR-provided history if available — avoids a client-side fetch
                // and renders messages immediately (before SSE connects).
                const ssrHistory = $page.data.messageHistory;
                const connectPromise = connectStream(currentId, ssrHistory);

                connectPromise.then(async () => {
                    // The chat store now has messages from the server — switch rendering
                    // from SSR data ($page.data.messages) to the live store (chat.messages).
                    hydrated = true;

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
                    // Now that we've attempted the restore, allow the $effect to manage sessionStorage
                    draftRestored = true;

                    // If an initial message was passed (e.g., from the home page), send it now
                    const initialMessage = $page.url.searchParams.get("initialMessage");
                    const initialModel = $page.url.searchParams.get("initialModel");
                    if (initialMessage) {
                        // Use the model ID directly — provider is resolved automatically
                        const modelId = initialModel || selectedModelId;
                        if (modelId) {
                            selectedModelId = modelId;
                        }

                        // Apply any sandbox quick-toggle settings from the home page before sending.
                        // Each param is always present (true or false) matching the toggle state.
                        // We set conversation-level overrides so the session picks them up.
                        const sandboxSettings: ConversationSettings = {};
                        const sandboxOnParam = $page.url.searchParams.get("sandboxOn");
                        const netAllDomainsOnParam = $page.url.searchParams.get("netAllDomainsOn");
                        const mcpServersOnParam = $page.url.searchParams.get("mcpServersOn");
                        const agentModeParam = $page.url.searchParams.get("agentMode");

                        if (sandboxOnParam !== null) sandboxSettings.sandboxEnabled = sandboxOnParam === "true";
                        if (netAllDomainsOnParam === "true") {
                            sandboxSettings.allowNet = true;
                            sandboxSettings.allowAllDomains = true;
                        } else if (netAllDomainsOnParam === "false") {
                            sandboxSettings.allowNet = false;
                            sandboxSettings.allowAllDomains = false;
                        }
                        // null = use per-server defaultEnabled (effectively "on" for servers not explicitly disabled)
                        // []  = explicitly no MCP servers
                        if (mcpServersOnParam === "true") sandboxSettings.enabledMcpServers = null;
                        else if (mcpServersOnParam === "false") sandboxSettings.enabledMcpServers = [];
                        // Agent mode: "agent" = all tools, "chat" = no tools
                        if (agentModeParam === "agent") sandboxSettings.agentMode = "agent";
                        else if (agentModeParam === "chat") sandboxSettings.agentMode = "chat";

                        // Apply sandbox settings if any were specified
                        if (Object.keys(sandboxSettings).length > 0) {
                            try {
                                await updateConversationSettings(currentId, sandboxSettings);
                            } catch {
                                // Best-effort; don't block sending the message
                            }
                        }

                        send(initialMessage, modelId);
                        // Clear the draft and the URL params to avoid re-sending on refresh/reconnect
                        sessionStorage.removeItem(draftKey(currentId));
                        goto(`/chat/${currentId}`, { replaceState: true });
                    }
                });
            });
        }
        return () => untrack(() => disconnectStream());
    });

    // Auto-scroll to bottom when messages arrive or streaming content updates.
    // Debounced: cancels any pending scroll and schedules a single rAF.
    // This avoids stacking dozens of nested-rAF callbacks during fast streaming,
    // which caused increasing lag as messages grew longer.
    let scrollRaf: number | undefined;
    $effect(() => {
        const count = displayMessages.length;
        const lastMsg = displayMessages[count - 1];
        // Track all reactive content so we re-scroll as deltas arrive
        const _content = lastMsg?.content;
        const _thinking = lastMsg?.thinking;
        const _streaming = lastMsg?.streaming;
        const _thinkingStreaming = lastMsg?.thinkingStreaming;

        // Cancel any pending scroll — only the latest one matters
        if (scrollRaf !== undefined) cancelAnimationFrame(scrollRaf);
        scrollRaf = requestAnimationFrame(() => {
            scrollRaf = undefined;
            if (viewportEl) {
                viewportEl.scrollTop = viewportEl.scrollHeight;
            }
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
        // Hide the top bar when user sends a message
        hideTopBar();
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

    function handleEditAssistantMessage(messageId: string, newText: string) {
        editAssistantMessage(messageId, newText);
    }

    async function toggleDag() {
        dagOpen = !dagOpen;
        if (dagOpen) {
            await loadDagData();
        }
    }

    async function loadDagData() {
        if (!id) return;
        dagLoading = true;
        try {
            const tree = await getSessionTree(id);
            dagNodes = tree.nodes;
            dagLeafId = tree.leafId;
        } catch (e) {
            console.error("Failed to load session tree:", e);
        } finally {
            dagLoading = false;
        }
    }

    async function handleDagNavigate(entryId: string) {
        if (!id) return;
        try {
            await setSessionLeaf(id, entryId);
            // Reload the chat messages to reflect the new branch
            await reloadMessages();
            // Reload the DAG to update active branch highlighting
            await loadDagData();
        } catch (e) {
            console.error("Failed to navigate to entry:", e);
        }
    }

    // Refresh DAG data when the chat navigation state changes (e.g., after delete/edit/regenerate)
    $effect(() => {
        if (dagOpen && !chat.navigating) {
            loadDagData();
        }
    });

    /** ESC pressed anywhere on the page cancels in-progress AI inference */
    function handleGlobalKeydown(e: KeyboardEvent) {
        if (e.key === "Escape" && chat.generating) {
            e.preventDefault();
            abort();
        }
    }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<svelte:head>
    <title>Vessel - {conversationTitle}</title>
</svelte:head>

<div class="h-full w-full flex flex-col overflow-hidden relative" onmousemove={showTopBar}>
    <!-- Main content -->
    <!-- Top bar: hidden by default, shows on mouse movement, auto-hides after timeout or on send -->
    {#if topBarVisible}
        <div class="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-1.5 border-b h-9 bg-background/80 backdrop-blur-sm" transition:fade={{ duration: 150 }}>
            <!-- Left: Context usage + token counts -->
            <div class="flex items-center gap-3">
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div class="flex items-center gap-1.5">
                                <ContextUsageRing fraction={contextUsageFraction} size={22} strokeWidth={2.5} />
                            </div>
                        </TooltipTrigger>
                        <TooltipContent>Context window: {Math.round(contextUsageFraction * 100)}% used</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div class="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <ArrowUp class="size-3" />
                                <span>{formatTokens(chat.totalInputTokens)}</span>
                            </div>
                        </TooltipTrigger>
                        <TooltipContent>Input tokens: {chat.totalInputTokens.toLocaleString()}</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div class="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <ArrowDown class="size-3" />
                                <span>{formatTokens(chat.totalOutputTokens)}</span>
                            </div>
                        </TooltipTrigger>
                        <TooltipContent>Output tokens: {chat.totalOutputTokens.toLocaleString()}</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
            <!-- Right: Action buttons -->
            <div class="flex items-center gap-1">
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onclick={() => (securityOpen = !securityOpen)}
                                class="inline-flex items-center gap-1 text-[11px] {securityOpen ? 'text-foreground bg-muted' : 'text-muted-foreground hover:text-foreground'} transition-colors cursor-pointer px-2 py-1 rounded hover:bg-muted"
                                aria-label="Toggle security panel"
                            >
                                <Shield class="size-3" />
                                <span>Security</span>
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>Security settings</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onclick={toggleDag}
                                class="inline-flex items-center gap-1 text-[11px] {dagOpen ? 'text-foreground bg-muted' : 'text-muted-foreground hover:text-foreground'} transition-colors cursor-pointer px-2 py-1 rounded hover:bg-muted"
                                aria-label={dagOpen ? 'Close history view' : 'Open history view'}
                            >
                                <GitBranch class="size-3" />
                                <span>History</span>
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>Message history</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onclick={() => (agentInfoOpen = !agentInfoOpen)}
                                class="inline-flex items-center gap-1 text-[11px] {agentInfoOpen ? 'text-foreground bg-muted' : 'text-muted-foreground hover:text-foreground'} transition-colors cursor-pointer px-2 py-1 rounded hover:bg-muted"
                                aria-label="Toggle agent info panel"
                            >
                                <FileText class="size-3" />
                                <span>Agent</span>
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>Agent configuration</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
        </div>
    {/if}

    <!-- Content area below the top bar -->
    <div class="flex-1 min-w-0 flex overflow-hidden">
    <div class="flex-1 min-w-0 flex flex-col overflow-hidden max-w-[100ch] mx-auto">

        <!-- Message area -->
        <ScrollArea class="flex-1 min-h-0 overflow-hidden" bind:viewportRef={viewportEl}>
            <div class="flex flex-col gap-6 p-6">
            {#if displayMessages.length === 0}
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
                                        ondelete={handleDeleteMessage}
                                        onregenerate={handleEditMessage}
                                        navigating={chat.navigating}
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
                                class="flex gap-3 w-max-[65ch] font-serif {msg.role === 'user'
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
                                    oneditassistant={handleEditAssistantMessage}
                                    navigating={chat.navigating}
                                />
                                </div>
                            </div>
                        </div>
                    {/if}
                {/each}

                <!-- Skeleton placeholder while waiting for model to start responding -->
                {#if waitingForResponse}
                    <div class="flex w-full justify-start">
                        <div class="flex gap-3 w-[min(75%,65ch)] font-serif">
                            <ChatAvatar
                                role="assistant"
                                isConsecutive={false}
                                model={chat.lastModel?.modelId}
                                modelProvider={chat.lastModel?.provider}
                                {getModelDisplayName}
                                hasContent={false}
                            />
                            <div class="min-w-0 flex-1 flex flex-col gap-2 py-1">
                                <Skeleton class="h-4 w-3/4" />
                                <Skeleton class="h-4 w-1/2" />
                            </div>
                        </div>
                    </div>
                {/if}
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
            {/if}
        </div>
    </div>
    </div>

        <!-- Right side panels -->
        {#if securityOpen && id}
            <div class="w-80 border-l bg-background flex flex-col shrink-0">
                <ConversationSecurityPanel conversationId={id} />
            </div>
        {/if}
        {#if agentInfoOpen && id}
            <div class="w-96 border-l bg-background flex flex-col shrink-0">
                <AgentInfoPanel conversationId={id} />
            </div>
        {/if}
        {#if dagOpen}
            <div class="w-72 border-l bg-background flex flex-col shrink-0">
                <MessageDag
                    nodes={dagNodes}
                    leafId={dagLeafId}
                    onnavigateto={handleDagNavigate}
                    navigating={chat.navigating}
                />
            </div>
        {/if}
    </div><!-- close content-area flex row -->
</div>
