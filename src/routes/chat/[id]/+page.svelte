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
    import {
        listModels,
        getSessionTree,
        setSessionLeaf,
        updateConversationSettings,
        uploadFile,
        deleteWorkspaceFile,
        downloadWorkspaceFile,
        listWorkspaceFiles,
    } from "$lib/api.js";
    import type {
        ChatMessage as ChatMessageType,
        ConversationSettings,
        ModelInfo,
        RenderItem,
        ThinkingGroup as ThinkingGroupType,
    } from "$lib/types.js";
    import type { SessionTreeNodeData } from "$lib/api.js";
    import { MessageDag } from "$lib/components/chat/index.js";
    import {
        ResizablePaneGroup,
        ResizablePane,
        ResizableHandle,
    } from "$lib/components/ui/resizable";
    import GitBranch from "@lucide/svelte/icons/git-branch";
    import Shield from "@lucide/svelte/icons/shield";
    import FileText from "@lucide/svelte/icons/file-text";
    import { onMount, untrack } from "svelte";
    import { fade } from "svelte/transition";
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
    import SearchResultsPanel from "$lib/components/chat/search-results-panel.svelte";
    import FetchedPagePanel from "$lib/components/chat/fetched-page-panel.svelte";
    import type { SearchResultItem } from "$lib/types.js";
    import type { PageData } from "./$types.js";

    const pageData = $derived($page.data as PageData);

    // --- Per-conversation persistence helpers ---
    const PANEL_STATE_PREFIX = "chat-panel-state:";

    type PanelState = {
        sidePanel: "security" | "history" | "agent" | null;
    };

    function panelStateKey(conversationId: string) {
        return `${PANEL_STATE_PREFIX}${conversationId}`;
    }

    function loadPanelState(conversationId: string): PanelState {
        try {
            const raw = localStorage.getItem(panelStateKey(conversationId));
            if (raw) {
                const parsed = JSON.parse(raw) as PanelState;
                return {
                    sidePanel: parsed.sidePanel ?? null,
                };
            }
        } catch {
            // localStorage may be unavailable
        }
        return { sidePanel: null };
    }

    function savePanelState(conversationId: string, state: PanelState) {
        try {
            localStorage.setItem(panelStateKey(conversationId), JSON.stringify(state));
        } catch {
            // localStorage may be unavailable
        }
    }

    let id = $derived($page.params.id as string);
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
        if (hydrated) {
            const msgs = chat.messages;
            console.log(
                `[chat-lifecycle] displayMessages: hydrated=true, chat.messages.length=${String(msgs.length)}, connected=${String(chat.connected)}, generating=${String(chat.generating)}`
            );
            return msgs;
        }
        // SSR path: use pre-converted ChatMessage[] from the server load.
        // Fall back to empty array if no SSR data (shouldn't normally happen).
        const ssrMsgs = pageData.messages;
        console.log(
            `[chat-lifecycle] displayMessages: hydrated=false, SSR messages.length=${String(ssrMsgs.length)}`
        );
        return ssrMsgs;
    });

    // Session storage key for in-progress message draft, scoped per conversation
    function draftKey(conversationId: string) {
        return `chat-draft:${conversationId}`;
    }

    let inputText = $state("");
    let inputFullscreen = $state(false);
    let pendingFiles = $state<{ file: File; id: string }[]>([]);
    /** Names of files already uploaded to the sandbox (persists across messages) */
    let sandboxFiles = $state<string[]>([]);

    /** Re-fetch sandbox files after every agent turn completes. */
    let wasGenerating = $state(false);
    $effect(() => {
        const isGenerating = chat.generating;
        // Only fetch when transitioning from generating → not generating
        if (wasGenerating && !isGenerating && id) {
            listWorkspaceFiles(id)
                .then((result) => {
                    sandboxFiles = result.files;
                })
                .catch(() => {
                    // Non-critical — the file list just won't update
                });
        }
        wasGenerating = isGenerating;
    });
    /**
     * Status updates to be invisibly appended to the user's next message.
     * These are sent to the AI but never shown in the UI bubble.
     * Flushed and cleared each time a message is sent.
     */
    let pendingStatusUpdates = $state<string[]>([]);
    /** Upload progress state: null when idle, object when uploading */
    let uploadProgress = $state<{
        currentFile: string;
        fileIndex: number;
        totalFiles: number;
        /** 0-1 fraction of the current file uploaded */
        fraction: number;
    } | null>(null);
    let viewportEl = $state<HTMLElement | null>(null);
    let availableModels = $state<ModelInfo[]>([]);
    let selectedModelId = $state(""); // Just the model ID — provider is resolved automatically
    let thinkingOpen = $state<Record<string, boolean>>({}); // item id -> whether thinking is expanded

    // Shared side panel state: only one panel can be open at a time
    // Initialized from localStorage per conversation (see effect below)
    let sidePanel = $state<"security" | "history" | "agent" | null>(null);
    // Search results panel state
    let searchResultsOpen = $state(false);
    let searchResultsQuery = $state("");
    let searchResultsData = $state<SearchResultItem[]>([]);
    // Fetched page panel state
    let fetchedPageOpen = $state(false);
    let fetchedPageUrl = $state("");
    let fetchedPageTitle = $state("");
    let fetchedPageContent = $state("");
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
    // (generating is true but no assistant message has visible content yet,
    //  or we just sent/regenerated but the SSE stream hasn't started yet)
    let waitingForResponse = $derived.by(() => {
        // If we're actively navigating (delete/edit in flight), don't show skeleton
        if (chat.navigating) return false;
        if (!chat.generating) return false;
        // During generation: show skeleton if no streaming message or streaming message has no visible content
        const streamingMsg = displayMessages.find((m: ChatMessageType) => m.streaming);
        const result =
            !streamingMsg ||
            (!streamingMsg.content.trim() &&
                !streamingMsg.thinking &&
                !streamingMsg.thinkingStreaming &&
                !(streamingMsg.toolCalls && streamingMsg.toolCalls.length > 0));
        console.log(
            `[chat-lifecycle] waitingForResponse: generating=${String(chat.generating)}, foundStreamingMsg=${String(!!streamingMsg)}, result=${String(result)}, displayMessages.length=${String(displayMessages.length)}`
        );
        return result;
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
        if (msg.thinking || msg.thinkingStreaming || (msg.toolCalls && msg.toolCalls.length > 0))
            return true;
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
        const msgCount = displayMessages.length;
        const streamingCount = displayMessages.filter((m: ChatMessageType) => m.streaming).length;
        console.log(
            `[chat-lifecycle] renderItems: displayMessages.length=${String(msgCount)}, streaming=${String(streamingCount)}, generating=${String(chat.generating)}`
        );

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
                            id: `${msg.id}-tool-${String(i)}`,
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
                if (!item.streaming && !(item.id in thinkingOpen)) {
                    thinkingOpen[item.id] = false;
                }
            } else {
                const msg = item.msg;
                if (msg.thinkingStreaming === false && !(msg.id in thinkingOpen) && msg.thinking) {
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
        if (conversationInfo) {
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
        if (!defaultApplied && pageData.lastModel) {
            selectedModelId = pageData.lastModel.modelId;
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
        console.log(
            `[chat-lifecycle] $effect: running for id=${currentId}, prev hydrated=${String(untrack(() => hydrated))}`
        );
        // Reset the draft-restored flag — the new conversation's draft hasn't been restored yet
        draftRestored = false;
        // Reset hydrated — we want to render from SSR data for the new conversation first,
        // then transition to the live store once connectStream completes.
        hydrated = false;
        if (currentId) {
            untrack(() => {
                // Initialize sandbox files from SSR data.
                // Must be inside untrack() — otherwise $page.data becomes a dependency
                // of this $effect, causing it to re-run (disconnecting/reconnecting the
                // SSE stream and clearing messages) whenever $page.data changes.
                sandboxFiles = pageData.sandboxFiles;
                // Use SSR-provided history if available — avoids a client-side fetch
                // and renders messages immediately (before SSE connects).
                void connectStream(currentId, pageData.messageHistory).then(async () => {
                    console.log(
                        `[chat-lifecycle] $effect: connectStream resolved, chat.messages.length=${String(chat.messages.length)}, connected=${String(chat.connected)}, generating=${String(chat.generating)}`
                    );
                    // The chat store now has messages from the server — switch rendering
                    // from SSR data ($page.data.messages) to the live store (chat.messages).
                    hydrated = true;
                    console.log(
                        `[chat-lifecycle] $effect: hydrated=true, chat.messages.length=${String(chat.messages.length)}`
                    );

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

                        if (sandboxOnParam !== null)
                            sandboxSettings.sandboxEnabled = sandboxOnParam === "true";
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
                        else if (mcpServersOnParam === "false")
                            sandboxSettings.enabledMcpServers = [];
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

                        void send(initialMessage, modelId);
                        // Clear the draft and the URL params to avoid re-sending on refresh/reconnect
                        sessionStorage.removeItem(draftKey(currentId));
                        // Use replaceState instead of goto to avoid triggering a SvelteKit
                        // navigation that would re-run the $effect, clear messages, and
                        // cause the just-pushed user message to disappear until reloadMessages()
                        // runs at agent_end.
                        window.history.replaceState({}, "", `/chat/${currentId}`);
                    }
                });
            });
        }
        return () => {
            untrack(() => {
                disconnectStream();
            });
        };
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
        const _content = lastMsg.content;
        const _thinking = lastMsg.thinking;
        const _streaming = lastMsg.streaming;
        const _thinkingStreaming = lastMsg.thinkingStreaming;
        // Also scroll when upload progress appears/updates
        const _upload = uploadProgress;

        // Cancel any pending scroll — only the latest one matters
        if (scrollRaf !== undefined) cancelAnimationFrame(scrollRaf);
        scrollRaf = requestAnimationFrame(() => {
            scrollRaf = undefined;
            if (viewportEl) {
                viewportEl.scrollTop = viewportEl.scrollHeight;
            }
        });
    });

    async function handleSend() {
        const text = inputText.trim();
        const filesToSend = [...pendingFiles];
        console.log(
            `[chat-lifecycle] handleSend: text=${String(!!text)}, files=${String(filesToSend.length)}, connected=${String(chat.connected)}, generating=${String(chat.generating)}`
        );
        if (
            (!text && filesToSend.length === 0 && pendingStatusUpdates.length === 0) ||
            !chat.connected ||
            chat.generating
        )
            return;

        // Snapshot and clear any queued status updates.
        // New updates (e.g. upload notices) will be appended to this list
        // so all invisible status text flows through one place.
        const statusUpdates = [...pendingStatusUpdates];
        pendingStatusUpdates = [];

        // When files are queued, show the message bubble immediately,
        // upload files with a progress bar, then send to the AI.
        if (filesToSend.length > 0) {
            // Move text into a message bubble right away (just the user's text, not status updates)
            chat.addLocalUserMessage(text || "📎 Uploading files...");
            inputText = "";
            pendingFiles = [];
            sessionStorage.removeItem(draftKey(id));
            hideTopBar();

            try {
                const uploadedNames: string[] = [];
                for (let i = 0; i < filesToSend.length; i++) {
                    const pf = filesToSend[i];
                    uploadProgress = {
                        currentFile: pf.file.name,
                        fileIndex: i,
                        totalFiles: filesToSend.length,
                        fraction: 0,
                    };
                    await uploadFile(id, pf.file, (loaded, total) => {
                        uploadProgress = {
                            currentFile: pf.file.name,
                            fileIndex: i,
                            totalFiles: filesToSend.length,
                            fraction: loaded / total,
                        };
                    });
                    uploadedNames.push(pf.file.name);
                }

                // Add upload notice to the status list
                const fileList = uploadedNames.join(", ");
                statusUpdates.push(`Files with names ${fileList} added to your sandbox`);

                // Add uploaded files to the sandbox files list
                sandboxFiles = [...sandboxFiles, ...uploadedNames];

                // Build the status content (invisible to the user, sent to the AI as context)
                // and the user's visible text content separately
                const statusText = statusUpdates.join("\n\n");

                // Clear progress and send to the AI
                // The user sees just their text; the AI gets status as invisible context
                uploadProgress = null;
                void chat.sendToApi(text, selectedModelId || undefined, statusText || undefined);
            } catch (err) {
                console.error("[chat] File upload failed:", err);
                chat.setError(err instanceof Error ? err.message : "File upload failed");
                uploadProgress = null;
            }
        } else {
            // No files to upload
            if (statusUpdates.length > 0) {
                // There are invisible status updates — push a local message with just
                // the user's text, then send with status content separately to the API
                chat.addLocalUserMessage(text || "📎 Updated sandbox files");
                const statusText = statusUpdates.join("\n\n");
                void chat.sendToApi(text, selectedModelId || undefined, statusText || undefined);
            } else {
                // Normal send — no invisible status
                void send(text, selectedModelId || undefined);
            }
            inputText = "";
            sessionStorage.removeItem(draftKey(id));
            hideTopBar();
        }
    }

    function handleAbort() {
        void abort();
    }

    async function handleRemoveSandboxFile(path: string) {
        if (!id) return;
        try {
            await deleteWorkspaceFile(id, path);
            sandboxFiles = sandboxFiles.filter((f) => f !== path);
            // Queue an invisible status update so the AI knows the file was removed
            pendingStatusUpdates = [
                ...pendingStatusUpdates,
                `File with name ${path} deleted from your sandbox`,
            ];
        } catch (err) {
            console.error("[chat] Failed to delete sandbox file:", err);
            chat.setError(err instanceof Error ? err.message : "Failed to delete file");
        }
    }

    function handleDownloadSandboxFile(path: string) {
        if (!id) return;
        downloadWorkspaceFile(id, path);
    }

    // Look up a model's display name from the available models list.
    // Model IDs are unique, so we only need the modelId to find it.
    // Falls back to the modelId if not found.
    function getModelDisplayName(modelId: string): string {
        if (!modelId) return "AI";
        const found = availableModels.find((m) => m.id === modelId);
        return found?.name || modelId;
    }

    function handleDeleteMessage(messageId: string, role: string) {
        void deleteMessage(messageId, role);
    }

    function handleEditMessage(messageId: string, role: string, newText?: string) {
        void editMessage(messageId, role, newText);
    }

    function handleEditAssistantMessage(messageId: string, newText: string) {
        void editAssistantMessage(messageId, newText);
    }

    function handleSearchClick(query: string, results: SearchResultItem[]) {
        searchResultsQuery = query;
        searchResultsData = results;
        searchResultsOpen = true;
    }

    function handlePageClick(url: string, title: string, content: string) {
        fetchedPageUrl = url;
        fetchedPageTitle = title;
        fetchedPageContent = content;
        fetchedPageOpen = true;
    }

    async function toggleDag() {
        if (sidePanel === "history") {
            sidePanel = null;
        } else {
            sidePanel = "history";
            await loadDagData();
        }
    }

    async function loadDagData() {
        if (!id) return;
        try {
            const tree = await getSessionTree(id);
            dagNodes = tree.nodes;
            dagLeafId = tree.leafId;
        } catch (e) {
            console.error("Failed to load session tree:", e);
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
        if (sidePanel === "history" && !chat.navigating) {
            void loadDagData();
        }
    });

    // --- Per-conversation panel state persistence ---
    // Restore panel state when navigating to a conversation
    $effect(() => {
        const currentId = id;
        if (currentId) {
            const saved = loadPanelState(currentId);
            sidePanel = saved.sidePanel;
            // If restoring the history panel, load DAG data
            if (saved.sidePanel === "history") {
                void loadDagData();
            }
        }
    });

    // Save panel state whenever sidePanel changes.
    // Uses untrack(id) so this only fires on panel changes, not on navigation.
    $effect(() => {
        const sp = sidePanel;
        untrack(() => {
            if (id) {
                savePanelState(id, { sidePanel: sp });
            }
        });
    });

    /** ESC pressed anywhere on the page cancels in-progress AI inference */
    function handleGlobalKeydown(e: KeyboardEvent) {
        if (e.key === "Escape" && chat.generating) {
            e.preventDefault();
            void abort();
        }
    }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<svelte:head>
    <title>Vessel - {conversationTitle}</title>
</svelte:head>

<div
    class="h-full w-full flex flex-col overflow-hidden relative"
    role="region"
    aria-label="Chat"
    onmousemove={showTopBar}
>
    <!-- Main content -->
    <!-- Top bar: hidden by default, shows on mouse movement, auto-hides after timeout or on send -->
    {#if topBarVisible}
        <div
            class="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-1.5 border-b h-9 bg-background/80 backdrop-blur-sm"
            transition:fade={{ duration: 150 }}
        >
            <!-- Left: Context usage + token counts -->
            <div class="flex items-center gap-3">
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger>
                            {#snippet child({ props })}
                                <div {...props} class="flex items-center gap-1.5">
                                    <ContextUsageRing
                                        fraction={contextUsageFraction}
                                        size={22}
                                        strokeWidth={2.5}
                                    />
                                </div>
                            {/snippet}
                        </TooltipTrigger>
                        <TooltipContent
                            >Context window: {Math.round(contextUsageFraction * 100)}% used</TooltipContent
                        >
                    </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger>
                            {#snippet child({ props })}
                                <div
                                    {...props}
                                    class="flex items-center gap-1 text-[11px] text-muted-foreground"
                                >
                                    <ArrowUp class="size-3" />
                                    <span>{formatTokens(chat.totalInputTokens)}</span>
                                </div>
                            {/snippet}
                        </TooltipTrigger>
                        <TooltipContent
                            >Input tokens: {chat.totalInputTokens.toLocaleString()}</TooltipContent
                        >
                    </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger>
                            {#snippet child({ props })}
                                <div
                                    {...props}
                                    class="flex items-center gap-1 text-[11px] text-muted-foreground"
                                >
                                    <ArrowDown class="size-3" />
                                    <span>{formatTokens(chat.totalOutputTokens)}</span>
                                </div>
                            {/snippet}
                        </TooltipTrigger>
                        <TooltipContent
                            >Output tokens: {chat.totalOutputTokens.toLocaleString()}</TooltipContent
                        >
                    </Tooltip>
                </TooltipProvider>
            </div>
            <!-- Right: Action buttons -->
            <div class="flex items-center gap-1">
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger>
                            {#snippet child({ props })}
                                <button
                                    {...props}
                                    onclick={() =>
                                        (sidePanel = sidePanel === "security" ? null : "security")}
                                    class="inline-flex items-center gap-1 text-[11px] {sidePanel ===
                                    'security'
                                        ? 'text-foreground bg-muted'
                                        : 'text-muted-foreground hover:text-foreground'} transition-colors cursor-pointer px-2 py-1 rounded hover:bg-muted"
                                    aria-label="Toggle security panel"
                                >
                                    <Shield class="size-3" />
                                    <span>Security</span>
                                </button>
                            {/snippet}
                        </TooltipTrigger>
                        <TooltipContent>Security settings</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger>
                            {#snippet child({ props })}
                                <button
                                    {...props}
                                    onclick={toggleDag}
                                    class="inline-flex items-center gap-1 text-[11px] {sidePanel ===
                                    'history'
                                        ? 'text-foreground bg-muted'
                                        : 'text-muted-foreground hover:text-foreground'} transition-colors cursor-pointer px-2 py-1 rounded hover:bg-muted"
                                    aria-label={sidePanel === "history"
                                        ? "Close history view"
                                        : "Open history view"}
                                >
                                    <GitBranch class="size-3" />
                                    <span>History</span>
                                </button>
                            {/snippet}
                        </TooltipTrigger>
                        <TooltipContent>Message history</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger>
                            {#snippet child({ props })}
                                <button
                                    {...props}
                                    onclick={() =>
                                        (sidePanel = sidePanel === "agent" ? null : "agent")}
                                    class="inline-flex items-center gap-1 text-[11px] {sidePanel ===
                                    'agent'
                                        ? 'text-foreground bg-muted'
                                        : 'text-muted-foreground hover:text-foreground'} transition-colors cursor-pointer px-2 py-1 rounded hover:bg-muted"
                                    aria-label="Toggle agent info panel"
                                >
                                    <FileText class="size-3" />
                                    <span>Agent</span>
                                </button>
                            {/snippet}
                        </TooltipTrigger>
                        <TooltipContent>Agent configuration</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
        </div>
    {/if}

    <!-- Content area below the top bar -->
    <div class="flex-1 min-w-0 overflow-hidden">
        <ResizablePaneGroup
            direction="horizontal"
            class="h-full"
            autoSaveId={id ? `chat-panes-${id}` : undefined}
        >
            <!-- Main chat area -->
            <ResizablePane defaultSize={sidePanel ? 75 : 100} minSize={50}>
                <div class="h-full flex flex-col overflow-hidden max-w-[100ch] mx-auto">
                    <!-- Message area (hidden when input is fullscreen) -->
                    {#if !inputFullscreen}
                        <ScrollArea
                            class="flex-1 min-h-0 overflow-hidden"
                            bind:viewportRef={viewportEl}
                        >
                            <div class="flex flex-col gap-6 p-6">
                                {#if displayMessages.length === 0}
                                    <div class="flex items-center justify-center py-24">
                                        <div
                                            class="flex flex-col items-center gap-4 text-muted-foreground"
                                        >
                                            <div class="rounded-full bg-muted p-4">
                                                <Bot class="size-8 opacity-60" />
                                            </div>
                                            <div class="text-center">
                                                <p class="text-sm font-medium">
                                                    Start a conversation
                                                </p>
                                                <p class="text-xs mt-1 opacity-70">
                                                    Send a message to begin chatting with the AI
                                                    assistant.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                {:else}
                                    {#each renderItems as item, i (item.type === "thinkingGroup" ? item.id : item.msg.id)}
                                        {#if item.type === "thinkingGroup"}
                                            <!-- Grouped thinking + tool calls -->
                                            <div class="flex w-full justify-start">
                                                <div
                                                    class="flex gap-3 w-[min(75%,65ch)] font-serif"
                                                >
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
                                                            onthinkingtoggle={(open: boolean) =>
                                                                (thinkingOpen[item.id] = open)}
                                                            ondelete={handleDeleteMessage}
                                                            onregenerate={handleEditMessage}
                                                            navigating={chat.navigating}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        {:else}
                                            {@const msg = item.msg as ChatMessageType}
                                            {@const nextItem = renderItems[i + 1]}
                                            {@const isLastConsecutive =
                                                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime: `renderItems[i+1]` can be undefined for the last item
                                                !nextItem ||
                                                nextItem.type !== "message" ||
                                                nextItem.msg.role !== msg.role}
                                            <div
                                                class="flex w-full {msg.role === 'user'
                                                    ? 'justify-end'
                                                    : 'justify-start'} {!isLastConsecutive
                                                    ? '-mt-4'
                                                    : ''}"
                                            >
                                                <div
                                                    class="flex gap-3 w-max-[65ch] font-serif {msg.role ===
                                                    'user'
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
                                                            onthinkingtoggle={(open: boolean) =>
                                                                (thinkingOpen[msg.id] = open)}
                                                            scrollContainer={viewportEl}
                                                            ondelete={handleDeleteMessage}
                                                            onedit={handleEditMessage}
                                                            oneditassistant={handleEditAssistantMessage}
                                                            navigating={chat.navigating}
                                                            onsearchclick={handleSearchClick}
                                                            onpageclick={handlePageClick}
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
                                                <div
                                                    class="min-w-0 flex-1 flex flex-col gap-2 py-1"
                                                >
                                                    <Skeleton class="h-4 w-3/4" />
                                                    <Skeleton class="h-4 w-1/2" />
                                                </div>
                                            </div>
                                        </div>
                                    {/if}

                                    <!-- File upload progress -->
                                    {#if uploadProgress}
                                        <div class="flex w-full justify-end">
                                            <div class="w-[min(75%,65ch)] flex flex-col gap-1.5">
                                                <div
                                                    class="flex items-center gap-2 text-xs text-muted-foreground"
                                                >
                                                    <span
                                                        >Uploading {uploadProgress.currentFile}</span
                                                    >
                                                    <span class="text-muted-foreground/60"
                                                        >({uploadProgress.fileIndex +
                                                            1}/{uploadProgress.totalFiles})</span
                                                    >
                                                </div>
                                                <div
                                                    class="h-1.5 rounded-full bg-muted overflow-hidden"
                                                >
                                                    <div
                                                        class="h-full rounded-full bg-primary transition-[width] duration-200"
                                                        style="width: {uploadProgress.fraction *
                                                            100}%"
                                                    ></div>
                                                </div>
                                            </div>
                                        </div>
                                    {/if}
                                {/if}
                            </div>
                        </ScrollArea>
                    {/if}

                    <!-- Input area -->
                    <div
                        class="px-4 py-3 bg-background {inputFullscreen
                            ? 'flex-1 min-h-0 pt-12 flex flex-col'
                            : 'shrink-0'}"
                    >
                        <ChatInput
                            bind:value={inputText}
                            bind:pendingFiles
                            {sandboxFiles}
                            placeholder={chat.connected ? "Type a message..." : "Connecting..."}
                            disabled={!chat.connected || uploadProgress !== null}
                            generating={chat.generating}
                            connected={chat.connected}
                            models={availableModels}
                            bind:selectedModelId
                            defaultModelId={settingsStore.defaultModel}
                            onsend={handleSend}
                            onabort={handleAbort}
                            onremovesandboxfile={handleRemoveSandboxFile}
                            ondownloadsandboxfile={handleDownloadSandboxFile}
                            hasPendingStatus={pendingStatusUpdates.length > 0}
                        />
                        <!-- Connection status / error -->
                        <div class="flex items-center gap-1.5 mt-1.5 min-h-4">
                            {#if chat.error}
                                <p class="text-xs text-destructive">{chat.error}</p>
                            {:else if !chat.connected}
                                <span
                                    class="flex items-center gap-1.5 text-xs text-muted-foreground"
                                >
                                    <span
                                        class="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse"
                                    ></span>
                                    Connecting...
                                </span>
                            {/if}
                        </div>
                    </div>
                </div></ResizablePane
            >

            <!-- Resizable side panel -->
            {#if sidePanel && id}
                <ResizableHandle withHandle />
                <ResizablePane defaultSize={25} minSize={15} maxSize={50}>
                    <div class="h-full bg-background flex flex-col">
                        {#if sidePanel === "security"}
                            <ConversationSecurityPanel conversationId={id} />
                        {:else if sidePanel === "history"}
                            <MessageDag
                                nodes={dagNodes}
                                leafId={dagLeafId}
                                onnavigateto={handleDagNavigate}
                                navigating={chat.navigating}
                            />
                        {:else if sidePanel === "agent"}
                            <AgentInfoPanel conversationId={id} />
                        {/if}
                    </div>
                </ResizablePane>
            {/if}
        </ResizablePaneGroup>

        <!-- Non-resizable overlay panels (search results, fetched pages) -->
        {#if searchResultsOpen}
            <div
                class="absolute right-0 top-0 bottom-0 w-96 border-l bg-background flex flex-col shrink-0 z-10"
            >
                <SearchResultsPanel
                    query={searchResultsQuery}
                    results={searchResultsData}
                    onclose={() => {
                        searchResultsOpen = false;
                    }}
                    onresultclick={(url: string, title: string, content: string) => {
                        handlePageClick(url, title, content);
                    }}
                />
            </div>
        {/if}
        {#if fetchedPageOpen}
            <div
                class="absolute right-0 top-0 bottom-0 w-2xl border-l bg-background flex flex-col shrink-0 z-10"
            >
                <FetchedPagePanel
                    url={fetchedPageUrl}
                    title={fetchedPageTitle}
                    content={fetchedPageContent}
                    onclose={() => {
                        fetchedPageOpen = false;
                    }}
                />
            </div>
        {/if}
    </div>
</div>
