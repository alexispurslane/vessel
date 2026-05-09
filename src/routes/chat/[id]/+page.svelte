<script lang="ts">
    import { page } from "$app/state";
    import {
        getChat,
        abort,
        connectStream,
        disconnectStream,
        deleteMessage,
        editMessage,
        editAssistantMessage,
        regenWithFeedback,
        reloadMessages,
    } from "$lib/stores/chat.svelte.js";
    import { getConversations, loadConversations } from "$lib/stores/conversations.svelte.js";
    import { getAuth } from "$lib/stores/auth.svelte.js";
    import { getSettingsStore } from "$lib/stores/settings.svelte.js";
    import {
        ChatAvatar,
        ChatMessage,
        ChatInput,
        ThinkingGroup,
        ForkHere,
        FileDropZone,
    } from "$lib/components/chat/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area";
    import Bot from "@lucide/svelte/icons/bot";
    import {
        listModels,
        getSessionTree,
        setSessionLeaf,
        deleteWorkspaceFile,
        downloadWorkspaceFile,
        listWorkspaceFiles,
        exportConversation,
        forkConversation as apiForkConversation,
        updateConversation,
    } from "$lib/api.js";
    import type { ExportFormat, ExportOptions } from "$lib/api.js";
    import type {
        ChatMessage as ChatMessageType,
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
    import Download from "@lucide/svelte/icons/download";
    import FileJson from "@lucide/svelte/icons/file-json";
    import FileType from "@lucide/svelte/icons/file-type";
    import { onMount, untrack } from "svelte";
    import { fade } from "svelte/transition";
    import { goto } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { ContextUsageRing } from "$lib/components/ui/context-usage-ring";
    import ArrowUp from "@lucide/svelte/icons/arrow-up";
    import ArrowDown from "@lucide/svelte/icons/arrow-down";
    import Timer from "@lucide/svelte/icons/timer";
    import Gauge from "@lucide/svelte/icons/gauge";
    import Undo2 from "@lucide/svelte/icons/undo-2";
    import X from "@lucide/svelte/icons/x";
    import {
        Tooltip,
        TooltipContent,
        TooltipProvider,
        TooltipTrigger,
    } from "$lib/components/ui/tooltip";
    import {
        DropdownMenu,
        DropdownMenuCheckboxItem,
        DropdownMenuContent,
        DropdownMenuItem,
        DropdownMenuSeparator,
        DropdownMenuTrigger,
    } from "$lib/components/ui/dropdown-menu/index.js";
    import { Skeleton } from "$lib/components/ui/skeleton";
    import ConversationSecurityPanel from "$lib/components/conversation-settings/ConversationSecurityPanel.svelte";
    import AgentInfoPanel from "$lib/components/conversation-settings/AgentInfoPanel.svelte";
    import SearchResultsPanel from "$lib/components/chat/search-results-panel.svelte";
    import FetchedPagePanel from "$lib/components/chat/fetched-page-panel.svelte";
    import type { SearchResultItem } from "$lib/types.js";
    import type { PageData } from "./$types.js";
    import {
        createSendHandlers,
        createConnectStreamHandler,
        applyInitialSettings,
    } from "./chat-handlers.svelte.ts";
    import type { PendingFile, UploadProgress } from "./chat-handlers.svelte.ts";
    import {
        notifyCompletion,
        clearTabTitleNotification,
    } from "$lib/stores/notifications.svelte.js";
    import { IsMobile } from "$lib/hooks/is-mobile.svelte.js";
    import AriaLiveRegion from "$lib/components/chat/a11y/aria-live-region.svelte";

    const isMobile = new IsMobile();

    const pageData = $derived(page.data as PageData);

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

    let id = $derived(page.params.id as string);
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
    let pendingFiles = $state<PendingFile[]>([]);
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

            // Send completion notifications (browser, sound, tab title)
            notifyCompletion(conversationTitle);
        }
        // Clear the tab title notification when generation starts again
        if (!wasGenerating && isGenerating) {
            clearTabTitleNotification();
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
    let uploadProgress = $state<UploadProgress>(null);
    let viewportEl = $state<HTMLElement | null>(null);
    let availableModels = $state<ModelInfo[]>([]);
    let selectedModelId = $state(""); // Just the model ID — provider is resolved automatically
    let thinkingOpen = $state<Record<string, boolean>>({}); // item id -> whether thinking is expanded

    /** The entry ID of the message being forked, or null */
    let forkingEntryId = $state<string | null>(null);

    // Shared side panel state: only one panel can be open at a time
    // Initialized from localStorage per conversation (see effect below)
    let sidePanel = $state<"security" | "history" | "agent" | null>(null);
    // Search results panel state
    let searchResultsOpen = $state(false);
    let searchResultsQuery = $state("");
    let searchResultsData = $state<SearchResultItem[]>([]);
    // Fetched page panel state
    let fetchedPageOpen = $state(false);

    // --- Accessibility: screen reader announcements ---
    let a11yAnnouncement = $state("");

    // --- Accessibility: focus management ---
    let lastFocusedMsgId: string | null = null;
    let fetchedPageUrl = $state("");
    let fetchedPageTitle = $state("");
    let fetchedPageContent = $state("");
    // Top bar auto-hide state
    let topBarVisible = $state(false);
    let topBarTimeout: ReturnType<typeof setTimeout> | null = null;
    const TOP_BAR_HIDE_DELAY = 2000; // ms before auto-hiding

    function showTopBar() {
        // No-op on mobile — bar is always visible
        if (isMobile.current) return;
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

    /** Scroll to a message anchor in the URL hash (e.g. #msg-abc123) and clear the hash.
     *  Called after messages are hydrated so the DOM elements exist. */
    function scrollToHashMessage() {
        const hash = window.location.hash;
        if (!hash.startsWith("#msg-")) return;
        requestAnimationFrame(() => {
            const el = document.getElementById(hash.slice(1));
            if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                el.classList.add("ring-2", "ring-ring", "ring-offset-2", "ring-offset-background");
                setTimeout(() => {
                    el.classList.remove(
                        "ring-2",
                        "ring-ring",
                        "ring-offset-2",
                        "ring-offset-background"
                    );
                }, 2000);
            }
            window.history.replaceState({}, "", window.location.pathname + window.location.search);
        });
    }

    // Whether we're waiting for the model to start responding
    // (generating is true but no assistant message has visible content yet,
    //  or we just sent/regenerated but the SSE stream hasn't started yet)
    let waitingForResponse = $derived.by(() => {
        // If we're actively navigating (delete/edit in flight),
        // don't show skeleton
        if (chat.navigating) return false;
        if (!chat.generating) return false;
        // During generation: show skeleton if no streaming message
        // or the streaming message has no visible content
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

    /**
     * Whether an assistant message is "intermediate" — thinking/tool calls only, no visible text for the user.
     *  These get grouped into ThinkingGroups in the render layer.
     *
     *  Important: a message that is still streaming might start with thinking/tool calls
     *  and later receive text content, so we only group non-streaming messages that
     *  definitively have no content. Streaming messages with thinking but no content yet
     *  are still grouped (they'll stay in the group since tool calls always precede final text
     *  in the agent loop — the text comes in a NEW message/turn).
     *
     * @param msg - The chat message to check
     * @returns Whether the message is an intermediate assistant message
     */
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

    /**
     * Push the current group into the items list (if one exists) and clear it.
     *
     * @param items - The render items being built
     * @param group - The current thinking group, or null
     * @returns null (the group has been finalized)
     */
    function finalizeGroup(
        items: RenderItem[],
        group: ThinkingGroupType | null
    ): ThinkingGroupType | null {
        if (group) items.push(group);
        return null;
    }

    /**
     * Add an intermediate assistant message's steps to the current group, or create a new group.
     *
     * @param group - The current thinking group, or null if none started yet
     * @param msg - The intermediate assistant message to add
     * @returns The (possibly new) current group
     */
    function addToOrCreateGroup(
        group: ThinkingGroupType | null,
        msg: ChatMessageType
    ): ThinkingGroupType {
        const g = group ?? {
            type: "thinkingGroup",
            id: `group-${msg.id}`,
            steps: [],
            streaming: false,
            model: msg.model,
            modelProvider: msg.modelProvider,
            messageIds: [],
        };

        addThinkingStep(g, msg);
        addToolCallSteps(g, msg);

        g.messageIds.push(msg.id);
        if (msg.model) g.model = msg.model;
        if (msg.modelProvider) g.modelProvider = msg.modelProvider;
        return g;
    }

    /**
     * Add a thinking step to the group if the message has thinking content.
     *
     * @param group - The thinking group to add to
     * @param msg - The message with potential thinking content
     */
    function addThinkingStep(group: ThinkingGroupType, msg: ChatMessageType): void {
        if (!msg.thinking && !msg.thinkingStreaming) return;
        group.steps.push({
            id: `${msg.id}-thinking`,
            messageId: msg.id,
            type: "thinking",
            thinking: msg.thinking,
            streaming: msg.thinkingStreaming,
        });
        if (msg.thinkingStreaming) group.streaming = true;
    }

    /**
     * Add tool call steps to the group if the message has tool calls.
     *
     * @param group - The thinking group to add to
     * @param msg - The message with potential tool calls
     */
    function addToolCallSteps(group: ThinkingGroupType, msg: ChatMessageType): void {
        if (!msg.toolCalls) return;
        for (let i = 0; i < msg.toolCalls.length; i++) {
            const tc = msg.toolCalls[i];
            group.steps.push({
                id: `${msg.id}-tool-${String(i)}`,
                messageId: msg.id,
                type: "toolCall",
                toolCall: tc,
                streaming: tc.status === "running",
            });
            if (tc.status === "running") group.streaming = true;
        }
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
                currentGroup = addToOrCreateGroup(currentGroup, msg);
            } else {
                currentGroup = finalizeGroup(items, currentGroup);
                items.push({ type: "message", msg });
            }
        }

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

    // Initialize model selector from the conversation's default model.
    // Every conversation has an explicit default (set at creation time from the global default).
    // The selector reflects this default; the user can override per-message without changing it.
    let conversationDefaultModelId = $state("");
    let modelInitialized = $state(false);
    let conversationTitle = $state("New Chat");

    $effect(() => {
        const conversationInfo = conversations.list.find((x) => x.id === chat.conversationId);
        if (conversationInfo) {
            conversationTitle = conversationInfo.title;
        }
    });

    $effect(() => {
        // When SSR provides the conversation's default model, use it for the selector
        if (!modelInitialized && pageData.conversationDefaultModel?.modelId) {
            selectedModelId = pageData.conversationDefaultModel.modelId;
            conversationDefaultModelId = pageData.conversationDefaultModel.modelId;
            modelInitialized = true;
        }
        // Fallback: use first available model if nothing is selected
        if (!modelInitialized && availableModels.length > 0 && !selectedModelId) {
            selectedModelId = availableModels[0]?.id || "";
        }
    });

    // Persist in-progress message to sessionStorage so it survives page reloads.
    // We skip clearing sessionStorage until after the draft has been restored
    // (or we've confirmed no draft exists) — otherwise the $effect fires on page
    // load with inputText="" and deletes the saved draft before connectStream
    // can restore it.
    let draftRestored = $state(false);
    // Track which conversation ID the draft was restored for, to avoid
    // persisting stale text under a new conversation's key during navigation.
    let draftRestoredForId = $state<string | null>(null);
    let showDraftBanner = $state(false);
    let draftBannerTimer: ReturnType<typeof setTimeout> | undefined;

    $effect(() => {
        // Only persist when the draft has been restored for THIS conversation.
        // Without the draftRestoredForId check, switching conversations

        // would momentarily persist old text under the new ID before reset.
        if (id && draftRestored && draftRestoredForId === id) {
            const key = draftKey(id);
            if (inputText.trim()) {
                sessionStorage.setItem(key, inputText);
            } else {
                sessionStorage.removeItem(key);
            }
        }
    });

    function dismissDraftBanner() {
        showDraftBanner = false;
        if (draftBannerTimer !== undefined) {
            clearTimeout(draftBannerTimer);
            draftBannerTimer = undefined;
        }
    }

    function clearDraft() {
        inputText = "";
        if (id) {
            sessionStorage.removeItem(draftKey(id));
        }
        dismissDraftBanner();
    }

    // Show the draft-restored banner when a draft with content is loaded.
    // This fires once after connectStream restores the draft (draftRestored=true + inputText non-empty).
    $effect(() => {
        if (draftRestored && draftRestoredForId === id && inputText.trim()) {
            showDraftBanner = true;
            dismissDraftBanner(); // clear any previous timer
            draftBannerTimer = setTimeout(() => {
                showDraftBanner = false;
                draftBannerTimer = undefined;
            }, 5000);
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
        // Reset the draft-restored flag and banner — the new
        // conversation's draft hasn't been restored yet
        draftRestored = false;
        draftRestoredForId = null;
        dismissDraftBanner();
        // Clear the input so the old conversation's draft text doesn't leak.
        // The correct draft will be restored by onConnectStream after connectStream.
        inputText = "";
        // Reset hydrated — render from SSR data for the new conversation
        // first, then transition to the live store once connectStream completes.
        hydrated = false;
        if (currentId) {
            untrack(() => {
                // Initialize sandbox files from SSR data.
                // Must be inside untrack() — otherwise $page.data becomes

                // a dependency of this $effect, causing re-runs
                // (disconnecting/reconnecting SSE) on $page.data changes.
                sandboxFiles = pageData.sandboxFiles;
                console.log(
                    `[chat-lifecycle] sandboxFiles from pageData: length=${String(sandboxFiles.length)}, files=${JSON.stringify(sandboxFiles)}`
                );
                // Apply initial settings (sandbox toggles from URL params)
                // BEFORE connecting the SSE stream. If we wait until after

                // the stream is connected, the settings update can restart
                // the server-side session, detaching the SSE subscriber.
                void applyInitialSettings(currentId, page.url).then(() =>
                    connectStream(currentId, pageData.messageHistory).then(() =>
                        onConnectStream(currentId)
                    )
                );
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
        if (count === 0) return;
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

    // --- Accessibility: screen reader announcements ---
    // Announce when a new assistant message finishes streaming
    $effect(() => {
        const count = displayMessages.length;
        if (count === 0) return;
        const lastMsg = displayMessages[count - 1];
        const content = lastMsg.content;
        const streaming = lastMsg.streaming;
        const role = lastMsg.role;

        // Announce completed assistant messages
        if (role === "assistant" && !streaming && content) {
            const preview = content.length > 100 ? content.slice(0, 100) + "..." : content;
            a11yAnnouncement = `Assistant responded: ${preview}`;
        }
    });

    // Announce tool call status changes
    function announceToolCall(tc: { toolName: string; status: string }) {
        if (tc.status === "completed") {
            a11yAnnouncement = `Tool ${tc.toolName} completed`;
        } else if (tc.status === "error") {
            a11yAnnouncement = `Tool ${tc.toolName} encountered an error`;
        }
    }

    $effect(() => {
        for (const item of renderItems) {
            if (item.type === "thinkingGroup") {
                for (const step of item.steps) {
                    if (step.type === "toolCall" && step.toolCall) {
                        announceToolCall(step.toolCall);
                    }
                }
            } else if (item.msg.toolCalls) {
                for (const tc of item.msg.toolCalls) {
                    announceToolCall(tc);
                }
            }
        }
    });

    // --- Accessibility: focus management ---
    // Focus the latest message when a new assistant message finishes streaming
    $effect(() => {
        const count = displayMessages.length;
        if (count === 0) return;
        const lastMsg = displayMessages[count - 1];
        // Focus when streaming ends on assistant msg we haven't focused
        if (
            lastMsg.role === "assistant" &&
            !lastMsg.streaming &&
            lastMsg.content &&
            lastMsg.id !== lastFocusedMsgId
        ) {
            lastFocusedMsgId = lastMsg.id;
            requestAnimationFrame(() => {
                const el = document.getElementById(`msg-${lastMsg.id}`);
                if (el) {
                    el.focus({ preventScroll: true });
                }
            });
        }
    });

    // --- Extracted handlers (handleSend, onConnectStream) ---
    // The heavy lifting lives in ./chat-handlers.svelte.ts — this keeps the
    // page component focused on rendering. We wire page state via getters/setters
    // so the handlers can read and write reactive state without owning it.
    const handlerCtx = {
        getId: () => id,
        getPageData: () => pageData,
        getUrl: () => page.url,
        setInputText: (v: string) => (inputText = v),
        getInputText: () => inputText,
        setPendingFiles: (v: PendingFile[]) => (pendingFiles = v),
        getPendingFiles: () => pendingFiles,
        setUploadProgress: (v: UploadProgress) => (uploadProgress = v),
        getUploadProgress: () => uploadProgress,
        setSandboxFiles: (v: string[]) => (sandboxFiles = v),
        getSandboxFiles: () => sandboxFiles,
        setPendingStatusUpdates: (v: string[]) => (pendingStatusUpdates = v),
        getPendingStatusUpdates: () => pendingStatusUpdates,
        setSelectedModelId: (v: string) => (selectedModelId = v),
        getSelectedModelId: () => selectedModelId,
        setHydrated: (v: boolean) => (hydrated = v),
        getHydrated: () => hydrated,
        setConversationDefaultModelId: (v: string) => (conversationDefaultModelId = v),
        getConversationDefaultModelId: () => conversationDefaultModelId,
        setModelInitialized: (v: boolean) => (modelInitialized = v),
        getModelInitialized: () => modelInitialized,
        setDraftRestored: (v: boolean) => (draftRestored = v),
        setDraftRestoredForId: (v: string | null) => (draftRestoredForId = v),
        scrollToHashMessage,
        hideTopBar,
        draftKey,
    };
    const { handleSend } = createSendHandlers(handlerCtx);
    const { onConnectStream } = createConnectStreamHandler(handlerCtx);

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

    /**
     * Set the currently selected model as the conversation's default model.
     * Persists to DB so it survives page reloads.
     */
    function handleSetConversationDefault() {
        if (!id || !selectedModelId) return;
        conversationDefaultModelId = selectedModelId;
        void updateConversation(id, { model_id: selectedModelId });
    }

    /**
     * Switch the selector to the global default model.
     * Does NOT change the conversation's stored default —
     * the user is just choosing to use the global default for this session.
     */
    function handleSwitchToGlobalDefault() {
        if (!settingsStore.defaultModel) return;
        selectedModelId = settingsStore.defaultModel;
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

    function handleRegenWithFeedback(messageId: string, feedback: string, modelId?: string) {
        void regenWithFeedback(messageId, feedback, modelId);
    }

    /**
     * Fork the conversation before the message with the given entry ID.
     *
     * Creates a new conversation containing history from root up to and
     * including the parent of the specified entry (so custom messages
     * like fetched sources between the previous and next message are
     * preserved). Then navigates to the new conversation.
     *
     * @param beforeEntryId - The entry ID to fork before
     * @returns {void}
     */
    async function handleFork(beforeEntryId: string) {
        if (!id || forkingEntryId) return;
        forkingEntryId = beforeEntryId;
        try {
            const result = await apiForkConversation(id, beforeEntryId);
            // Refresh sidebar to include the new conversation
            await loadConversations();
            // Disconnect from current conversation before navigating
            disconnectStream();
            // Navigate to the new forked conversation
            void goto(resolve(`/chat/${result.id}`));
        } catch (e) {
            console.error("Failed to fork conversation:", e);
            chat.setError(e instanceof Error ? e.message : "Failed to fork conversation");
        } finally {
            forkingEntryId = null;
        }
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

    /** Export option toggles — persisted across dropdown opens. */
    let exportIncludeThinking = $state(false);
    let exportIncludeToolCalls = $state(false);

    /**
     * Handle exporting the conversation in the given format.
     *
     * @param format - The export format: "pdf", "markdown", or "json"
     */
    function handleExport(format: ExportFormat) {
        if (!id) return;
        const options: ExportOptions = {
            includeThinking: exportIncludeThinking,
            includeToolCalls: exportIncludeToolCalls,
        };
        exportConversation(id, format, options);
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

    /**
     * ESC pressed anywhere on the page cancels in-progress AI inference.
     *
     * @param e - The keyboard event
     * @returns {void}
     */
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

<AriaLiveRegion announcement={a11yAnnouncement} />

<div
    class="h-full w-full flex flex-col overflow-hidden relative"
    role="region"
    aria-label="Chat"
    onmousemove={showTopBar}
>
    <!-- Main content -->
    <!-- Action bar: on desktop, absolutely positioned at top with auto-hide on mouse movement.
         On mobile, pinned to bottom and always visible with icon-only buttons. -->
    {#if topBarVisible || isMobile.current}
        <div
            class="absolute {isMobile.current
                ? 'bottom-0 border-t'
                : 'top-0 border-b'} left-0 right-0 z-10 flex items-center justify-between px-4 {isMobile.current
                ? 'py-1 h-12'
                : 'py-1.5 h-9'} {isMobile.current
                ? 'bg-background'
                : 'bg-background/80 backdrop-blur-sm'}"
            transition:fade={{ duration: isMobile.current ? 0 : 150 }}
        >
            <!-- Left: Context usage + token counts -->
            <div class="flex items-center {isMobile.current ? 'gap-2' : 'gap-3'}">
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger>
                            {#snippet child({ props })}
                                <div {...props} class="flex items-center gap-1.5">
                                    <ContextUsageRing
                                        fraction={contextUsageFraction}
                                        size={isMobile.current ? 28 : 22}
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
                {#if !isMobile.current}
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
                {/if}
                {#if chat.timing}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                {#snippet child({ props })}
                                    <div
                                        {...props}
                                        class="flex items-center gap-1 text-[11px] text-muted-foreground"
                                    >
                                        <Timer class="size-3" />
                                        <span
                                            >{chat.timing?.avgTtftMs != null
                                                ? `${((chat.timing?.avgTtftMs ?? 0) / 1000).toFixed(1)}s`
                                                : "—"}</span
                                        >
                                    </div>
                                {/snippet}
                            </TooltipTrigger>
                            <TooltipContent
                                >Avg TTFT: {chat.timing?.avgTtftMs != null
                                    ? `${(chat.timing?.avgTtftMs ?? 0).toFixed(0)}ms`
                                    : "n/a"} ({chat.timing?.ttftCount ?? 0} turns)</TooltipContent
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
                                        <Gauge class="size-3" />
                                        <span
                                            >{chat.timing?.avgTps != null
                                                ? `${(chat.timing?.avgTps ?? 0).toFixed(0)}`
                                                : "—"}</span
                                        >
                                    </div>
                                {/snippet}
                            </TooltipTrigger>
                            <TooltipContent
                                >Avg TPS: {chat.timing?.avgTps != null
                                    ? `${(chat.timing?.avgTps ?? 0).toFixed(1)}`
                                    : "n/a"} ({chat.timing?.tpsCount ?? 0} turns)</TooltipContent
                            >
                        </Tooltip>
                    </TooltipProvider>
                {/if}
            </div>
            <!-- Right: Action buttons -->
            <div class="flex items-center {isMobile.current ? 'gap-0' : 'gap-1'}">
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger>
                            {#snippet child({ props })}
                                <button
                                    {...props}
                                    onclick={() =>
                                        (sidePanel = sidePanel === "security" ? null : "security")}
                                    class="inline-flex items-center {isMobile.current
                                        ? 'justify-center min-w-11 min-h-11'
                                        : 'gap-1 px-2 py-1'} text-[11px] {sidePanel === 'security'
                                        ? 'text-foreground bg-muted'
                                        : 'text-muted-foreground hover:text-foreground'} transition-colors cursor-pointer rounded hover:bg-muted"
                                    aria-label="Toggle security panel"
                                >
                                    <Shield class={isMobile.current ? "size-4" : "size-3"} />
                                    {#if !isMobile.current}<span>Security</span>{/if}
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
                                    class="inline-flex items-center {isMobile.current
                                        ? 'justify-center min-w-11 min-h-11'
                                        : 'gap-1 px-2 py-1'} text-[11px] {sidePanel === 'history'
                                        ? 'text-foreground bg-muted'
                                        : 'text-muted-foreground hover:text-foreground'} transition-colors cursor-pointer rounded hover:bg-muted"
                                    aria-label={sidePanel === "history"
                                        ? "Close history view"
                                        : "Open history view"}
                                >
                                    <GitBranch class={isMobile.current ? "size-4" : "size-3"} />
                                    {#if !isMobile.current}<span>History</span>{/if}
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
                                    class="inline-flex items-center {isMobile.current
                                        ? 'justify-center min-w-11 min-h-11'
                                        : 'gap-1 px-2 py-1'} text-[11px] {sidePanel === 'agent'
                                        ? 'text-foreground bg-muted'
                                        : 'text-muted-foreground hover:text-foreground'} transition-colors cursor-pointer rounded hover:bg-muted"
                                    aria-label="Toggle agent info panel"
                                >
                                    <FileText class={isMobile.current ? "size-4" : "size-3"} />
                                    {#if !isMobile.current}<span>Agent</span>{/if}
                                </button>
                            {/snippet}
                        </TooltipTrigger>
                        <TooltipContent>Agent configuration</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <DropdownMenu>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                {#snippet child({ props })}
                                    <DropdownMenuTrigger
                                        {...props}
                                        class="inline-flex items-center {isMobile.current
                                            ? 'justify-center min-w-11 min-h-11'
                                            : 'gap-1 px-2 py-1'} text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded hover:bg-muted"
                                        aria-label="Export conversation"
                                    >
                                        <Download class={isMobile.current ? "size-4" : "size-3"} />
                                        {#if !isMobile.current}<span>Export</span>{/if}
                                    </DropdownMenuTrigger>
                                {/snippet}
                            </TooltipTrigger>
                            <TooltipContent>Export conversation</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            onclick={() => handleExport("pdf")}
                            class="flex items-center gap-2"
                        >
                            <FileType class="size-4" />
                            <span>PDF</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onclick={() => handleExport("markdown")}
                            class="flex items-center gap-2"
                        >
                            <FileText class="size-4" />
                            <span>Markdown</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onclick={() => handleExport("json")}
                            class="flex items-center gap-2"
                        >
                            <FileJson class="size-4" />
                            <span>JSON</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuCheckboxItem bind:checked={exportIncludeThinking}>
                            Include thinking
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem bind:checked={exportIncludeToolCalls}>
                            Include tool calls
                        </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    {/if}

    <!-- Content area below the top bar -->
    <FileDropZone bind:pendingFiles>
        <div class="flex-1 min-w-0 overflow-hidden">
            <ResizablePaneGroup
                direction="horizontal"
                class="h-full"
                autoSaveId={id ? `chat-panes-${id}` : undefined}
            >
                <!-- Main chat area -->
                <ResizablePane defaultSize={sidePanel ? 75 : 100} minSize={50}>
                    <div
                        class="h-full flex flex-col overflow-hidden max-w-[100ch] mx-auto {isMobile.current
                            ? 'pb-12'
                            : ''}"
                    >
                        <!-- Message area (hidden when input is fullscreen) -->
                        {#if !inputFullscreen}
                            <ScrollArea
                                class="flex-1 min-h-0 overflow-hidden"
                                bind:viewportRef={viewportEl}
                                role="log"
                                aria-label="Chat messages"
                                aria-live="polite"
                            >
                                <div class="flex flex-col gap-6 p-6">
                                    {#if displayMessages.length === 0}
                                        <div class="flex items-center justify-center py-24">
                                            <div
                                                class="flex flex-col items-center gap-4 text-muted-foreground"
                                            >
                                                <div class="rounded-full bg-muted p-4">
                                                    <Bot
                                                        class="size-8 opacity-60"
                                                        aria-hidden="true"
                                                    />
                                                </div>
                                                <div class="text-center">
                                                    <h2 class="text-sm font-medium">
                                                        Start a conversation
                                                    </h2>
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
                                                <div
                                                    class="flex w-full justify-start"
                                                    id="msg-{item.id}"
                                                    tabindex="-1"
                                                >
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
                                                                thinkingIsOpen={thinkingOpen[
                                                                    item.id
                                                                ]}
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
                                                    id="msg-{msg.id}"
                                                    tabindex="-1"
                                                    role="article"
                                                    aria-label="{msg.role === 'user'
                                                        ? 'You'
                                                        : 'Assistant'} message"
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
                                                            hasContent={!!(
                                                                msg.content || msg.thinking
                                                            )}
                                                        />

                                                        <!-- Message bubble and tool calls -->
                                                        <div class="min-w-0 flex-1">
                                                            <ChatMessage
                                                                {msg}
                                                                thinkingIsOpen={thinkingOpen[
                                                                    msg.id
                                                                ]}
                                                                onthinkingtoggle={(open: boolean) =>
                                                                    (thinkingOpen[msg.id] = open)}
                                                                scrollContainer={viewportEl}
                                                                ondelete={handleDeleteMessage}
                                                                onedit={handleEditMessage}
                                                                oneditassistant={handleEditAssistantMessage}
                                                                onregenfeedback={handleRegenWithFeedback}
                                                                navigating={chat.navigating}
                                                                onsearchclick={handleSearchClick}
                                                                onpageclick={handlePageClick}
                                                                conversationId={id}
                                                                models={availableModels}
                                                                {selectedModelId}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            {/if}

                                            <!-- Fork-here indicator between messages -->
                                            {#if i < renderItems.length - 1 && !chat.generating && !chat.navigating}
                                                {@const nextItem = renderItems[i + 1]}
                                                {@const beforeEntryId =
                                                    nextItem.type === "thinkingGroup"
                                                        ? nextItem.messageIds[0]
                                                        : nextItem.msg.id}
                                                <ForkHere
                                                    entryId={beforeEntryId}
                                                    onfork={handleFork}
                                                    forking={forkingEntryId === beforeEntryId}
                                                />
                                            {/if}
                                        {/each}

                                        <!-- Skeleton placeholder while waiting for model to start responding -->
                                        {#if waitingForResponse}
                                            <div class="flex w-full justify-start">
                                                <div
                                                    class="flex gap-3 w-[min(75%,65ch)] font-serif"
                                                >
                                                    <ChatAvatar
                                                        role="assistant"
                                                        isConsecutive={false}
                                                        model={selectedModelId || undefined}
                                                        modelProvider={undefined}
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
                                                <div
                                                    class="w-[min(75%,65ch)] flex flex-col gap-1.5"
                                                >
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
                            {#if showDraftBanner}
                                <div
                                    class="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-md bg-muted/50 text-xs text-muted-foreground border border-muted/50"
                                    transition:fade={{ duration: 150 }}
                                >
                                    <Undo2 class="size-3 shrink-0" />
                                    <span class="flex-1">Restored unsent message</span>
                                    <button
                                        class="hover:text-foreground transition-colors cursor-pointer"
                                        onclick={clearDraft}
                                        aria-label="Clear draft"
                                    >
                                        Clear
                                    </button>
                                    <button
                                        class="hover:text-foreground transition-colors cursor-pointer"
                                        onclick={dismissDraftBanner}
                                        aria-label="Dismiss"
                                    >
                                        <X class="size-3" />
                                    </button>
                                </div>
                            {/if}
                            <ChatInput
                                bind:value={inputText}
                                bind:pendingFiles
                                bind:fullscreen={inputFullscreen}
                                {sandboxFiles}
                                placeholder={chat.connected ? "Type a message..." : "Connecting..."}
                                disabled={!chat.connected || uploadProgress !== null}
                                generating={chat.generating}
                                connected={chat.connected}
                                models={availableModels}
                                bind:selectedModelId
                                {conversationDefaultModelId}
                                globalDefaultModelId={settingsStore.defaultModel}
                                onsend={handleSend}
                                onabort={handleAbort}
                                onremovesandboxfile={handleRemoveSandboxFile}
                                ondownloadsandboxfile={handleDownloadSandboxFile}
                                hasPendingStatus={pendingStatusUpdates.length > 0}
                                onsetconversationdefault={handleSetConversationDefault}
                                onswitchtoglobaldefault={handleSwitchToGlobalDefault}
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

                <!-- Resizable side panel (desktop only) -->
                {#if sidePanel && id && !isMobile.current}
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

            <!-- Mobile full-screen overlay for side panels -->
            {#if isMobile.current && sidePanel && id}
                <div
                    class="absolute inset-0 z-20 bg-background flex flex-col animate-in slide-in-from-right duration-200"
                >
                    <div class="flex items-center justify-between px-4 py-2 border-b">
                        <span class="text-sm font-medium">
                            {sidePanel === "security"
                                ? "Security"
                                : sidePanel === "history"
                                  ? "History"
                                  : "Agent"}
                        </span>
                        <button
                            onclick={() => (sidePanel = null)}
                            class="p-2 hover:bg-muted rounded-md"
                            aria-label="Close panel"
                        >
                            <X class="size-4" />
                        </button>
                    </div>
                    <div class="flex-1 overflow-auto">
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
                </div>
            {/if}
        </div>
    </FileDropZone>
</div>
