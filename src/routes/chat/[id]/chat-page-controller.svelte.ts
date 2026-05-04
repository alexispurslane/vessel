/**
 * Controller for the chat page — owns page-level state and handlers.
 *
 * This composable encapsulates the "controller" logic that would otherwise
 * bloat +page.svelte. It uses Svelte 5 runes for reactivity.
 *
 * Usage in +page.svelte:
 *   const ctrl = createChatPageController({ page, chat, conversations, ... });
 *   // Then use ctrl.hydrated, ctrl.handleSend(), etc.
 */

import { page } from "$app/state";
import {
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
import type { SearchResultItem } from "$lib/types.js";
import { onMount, untrack } from "svelte";
import {
    draftKey,
    formatTokens,
    getModelDisplayName,
    isIntermediateAssistant,
    loadPanelState,
    savePanelState,
    handleInitialMessage,
} from "./chat-page-utils.js";
import type { PanelState } from "./chat-page-utils.js";
import type { PageData } from "./$types.js";

export interface ChatPageController {
    // --- Reactive state (readable from template) ---
    readonly id: string;
    readonly hydrated: boolean;
    readonly inputText: string;
    readonly inputFullscreen: boolean;
    readonly pendingFiles: { file: File; id: string }[];
    readonly sandboxFiles: string[];
    readonly uploadProgress: {
        currentFile: string;
        fileIndex: number;
        totalFiles: number;
        fraction: number;
    } | null;
    readonly viewportEl: HTMLElement | null;
    readonly availableModels: ModelInfo[];
    readonly selectedModelId: string;
    readonly thinkingOpen: Record<string, boolean>;
    readonly sidePanel: "security" | "history" | "agent" | null;
    readonly searchResultsOpen: boolean;
    readonly searchResultsQuery: string;
    readonly searchResultsData: SearchResultItem[];
    readonly fetchedPageOpen: boolean;
    readonly fetchedPageUrl: string;
    readonly fetchedPageTitle: string;
    readonly fetchedPageContent: string;
    readonly topBarVisible: boolean;
    readonly dagNodes: SessionTreeNodeData[];
    readonly dagLeafId: string | null;
    readonly contextUsageFraction: number;
    readonly conversationTitle: string;
    readonly defaultApplied: boolean;
    readonly waitingForResponse: boolean;
    readonly displayMessages: ChatMessageType[];
    readonly renderItems: RenderItem[];

    // --- Writable state (for template two-way binding) ---
    inputTextWritable: string;
    inputFullscreenWritable: boolean;
    viewportElWritable: HTMLElement | null;
    thinkingOpenWritable: Record<string, boolean>;

    // --- Computed helpers ---
    getModelDisplayName(modelId: string): string;
    formatTokens(n: number): string;

    // --- Handlers ---
    handleSend(): Promise<void>;
    handleAbort(): void;
    handleRemoveSandboxFile(path: string): Promise<void>;
    handleDownloadSandboxFile(path: string): void;
    handleDeleteMessage(messageId: string, role: string): void;
    handleEditMessage(messageId: string, role: string, newText?: string): void;
    handleEditAssistantMessage(messageId: string, newText: string): void;
    handleSearchClick(query: string, results: SearchResultItem[]): void;
    handlePageClick(url: string, title: string, content: string): void;
    toggleDag(): Promise<void>;
    loadDagData(): Promise<void>;
    handleDagNavigate(entryId: string): Promise<void>;
    showTopBar(): void;
    hideTopBar(): void;
    handleGlobalKeydown(e: KeyboardEvent): void;

    // --- Lifecycle ---
    setupEffects(): void;
}

export function createChatPageController(pageData: PageData): ChatPageController {
    const chat = getChat();
    const conversations = getConversations();
    const auth = getAuth();
    const settingsStore = getSettingsStore();

    let id = $derived(page.params.id as string);

    // --- Core state ---
    let hydrated = $state(false);
    let inputText = $state("");
    let inputFullscreen = $state(false);
    let pendingFiles = $state<{ file: File; id: string }[]>([]);
    let sandboxFiles = $state<string[]>([]);
    let wasGenerating = $state(false);
    let pendingStatusUpdates = $state<string[]>([]);
    let uploadProgress = $state<{
        currentFile: string;
        fileIndex: number;
        totalFiles: number;
        fraction: number;
    } | null>(null);
    let viewportEl = $state<HTMLElement | null>(null);
    let availableModels = $state<ModelInfo[]>([]);
    let selectedModelId = $state("");
    let thinkingOpen = $state<Record<string, boolean>>({});
    let defaultApplied = $state(false);
    let conversationTitle = $state("New Chat");
    let draftRestored = $state(false);

    // --- Side panel state ---
    let sidePanel = $state<"security" | "history" | "agent" | null>(null);

    // --- Search results panel ---
    let searchResultsOpen = $state(false);
    let searchResultsQuery = $state("");
    let searchResultsData = $state<SearchResultItem[]>([]);

    // --- Fetched page panel ---
    let fetchedPageOpen = $state(false);
    let fetchedPageUrl = $state("");
    let fetchedPageTitle = $state("");
    let fetchedPageContent = $state("");

    // --- Top bar auto-hide ---
    let topBarVisible = $state(false);
    let topBarTimeout: ReturnType<typeof setTimeout> | null = null;
    const TOP_BAR_HIDE_DELAY = 2000;

    // --- DAG state ---
    let dagNodes = $state<SessionTreeNodeData[]>([]);
    let dagLeafId = $state<string | null>(null);

    // --- Scroll state ---
    let scrollRaf: number | undefined;

    // --- Derived ---
    let displayMessages = $derived.by(() => {
        if (hydrated) {
            const msgs = chat.messages;
            console.log(
                `[chat-lifecycle] displayMessages: hydrated=true, chat.messages.length=${String(msgs.length)}, connected=${String(chat.connected)}, generating=${String(chat.generating)}`
            );
            return msgs;
        }
        const ssrMsgs = pageData.messages;
        console.log(
            `[chat-lifecycle] displayMessages: hydrated=false, SSR messages.length=${String(ssrMsgs.length)}`
        );
        return ssrMsgs;
    });

    let contextUsageFraction = $derived.by(() => {
        const model = availableModels.find((m) => m.id === selectedModelId);
        if (!model || model.contextWindow <= 0) return 0;
        const totalTokens = chat.totalInputTokens + chat.totalOutputTokens;
        return totalTokens / model.contextWindow;
    });

    let waitingForResponse = $derived.by(() => {
        if (chat.navigating) return false;
        if (!chat.generating) return false;
        const streamingMsg = displayMessages.find(
            (m: ChatMessageType) => m.streaming
        );
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

    let renderItems = $derived.by(() => {
        const items: RenderItem[] = [];
        let currentGroup: ThinkingGroupType | null = null;
        const msgCount = displayMessages.length;
        const streamingCount = displayMessages.filter(
            (m: ChatMessageType) => m.streaming
        ).length;
        console.log(
            `[chat-lifecycle] renderItems: displayMessages.length=${String(msgCount)}, streaming=${String(streamingCount)}, generating=${String(chat.generating)}`
        );

        for (const msg of displayMessages) {
            if (isIntermediateAssistant(msg)) {
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
                if (currentGroup) {
                    items.push(currentGroup);
                    currentGroup = null;
                }
                items.push({ type: "message", msg });
            }
        }

        if (currentGroup) {
            items.push(currentGroup);
        }

        return items;
    });

    // --- Top bar helpers ---
    function showTopBar() {
        if (topBarTimeout) {
            clearTimeout(topBarTimeout);
            topBarTimeout = null;
        }
        topBarVisible = true;
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

    // --- Scroll to hash message ---
    function scrollToHashMessage() {
        const hash = window.location.hash;
        if (!hash.startsWith("#msg-")) return;
        requestAnimationFrame(() => {
            const el = document.getElementById(hash.slice(1));
            if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                el.classList.add(
                    "ring-2",
                    "ring-ring",
                    "ring-offset-2",
                    "ring-offset-background"
                );
                setTimeout(() => {
                    el.classList.remove(
                        "ring-2",
                        "ring-ring",
                        "ring-offset-2",
                        "ring-offset-background"
                    );
                }, 2000);
            }
            window.history.replaceState(
                {},
                "",
                window.location.pathname + window.location.search
            );
        });
    }

    // --- ConnectStream post-connection callback ---
    async function onConnectStreamResolved(currentId: string) {
        console.log(
            `[chat-lifecycle] $effect: connectStream resolved, chat.messages.length=${String(chat.messages.length)}, connected=${String(chat.connected)}, generating=${String(chat.generating)}`
        );
        hydrated = true;
        console.log(
            `[chat-lifecycle] $effect: hydrated=true, chat.messages.length=${String(chat.messages.length)}`
        );

        scrollToHashMessage();

        if (chat.lastModel) {
            selectedModelId = chat.lastModel.modelId;
            defaultApplied = true;
        }

        const saved = sessionStorage.getItem(draftKey(currentId));
        if (saved) {
            inputText = saved;
        }
        draftRestored = true;

        // Handle initial message from URL params (e.g., from the home page)
        const modelId = await handleInitialMessage({
            conversationId: currentId,
            searchParams: page.url.searchParams,
            selectedModelId,
            updateConversationSettings,
            send,
            draftKeyFn: draftKey,
        });
        if (modelId) {
            selectedModelId = modelId;
        }
    }

    // --- Handlers ---
    async function handleSend() {
        const text = inputText.trim();
        const filesToSend = [...pendingFiles];
        console.log(
            `[chat-lifecycle] handleSend: text=${String(!!text)}, files=${String(filesToSend.length)}, connected=${String(chat.connected)}, generating=${String(chat.generating)}`
        );
        if (
            (!text &&
                filesToSend.length === 0 &&
                pendingStatusUpdates.length === 0) ||
            !chat.connected ||
            chat.generating
        )
            return;

        const statusUpdates = [...pendingStatusUpdates];
        pendingStatusUpdates = [];

        if (filesToSend.length > 0) {
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

                const fileList = uploadedNames.join(", ");
                statusUpdates.push(
                    `Files with names ${fileList} added to your sandbox`
                );
                sandboxFiles = [...sandboxFiles, ...uploadedNames];

                const statusText = statusUpdates.join("\n\n");
                uploadProgress = null;
                void chat.sendToApi(
                    text,
                    selectedModelId || undefined,
                    statusText || undefined
                );
            } catch (err) {
                console.error("[chat] File upload failed:", err);
                chat.setError(
                    err instanceof Error ? err.message : "File upload failed"
                );
                uploadProgress = null;
            }
        } else {
            if (statusUpdates.length > 0) {
                chat.addLocalUserMessage(text || "📎 Updated sandbox files");
                const statusText = statusUpdates.join("\n\n");
                void chat.sendToApi(
                    text,
                    selectedModelId || undefined,
                    statusText || undefined
                );
            } else {
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
            pendingStatusUpdates = [
                ...pendingStatusUpdates,
                `File with name ${path} deleted from your sandbox`,
            ];
        } catch (err) {
            console.error("[chat] Failed to delete sandbox file:", err);
            chat.setError(
                err instanceof Error ? err.message : "Failed to delete file"
            );
        }
    }

    function handleDownloadSandboxFile(path: string) {
        if (!id) return;
        downloadWorkspaceFile(id, path);
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
            await reloadMessages();
            await loadDagData();
        } catch (e) {
            console.error("Failed to navigate to entry:", e);
        }
    }

    function handleGlobalKeydown(e: KeyboardEvent) {
        if (e.key === "Escape" && chat.generating) {
            e.preventDefault();
            void abort();
        }
    }

    // --- Model display name (delegates to utils) ---
    function _getModelDisplayName(modelId: string): string {
        return getModelDisplayName(modelId, availableModels);
    }

    // --- Effects setup ---
    function setupEffects() {
        // Sandbox files refresh after generation completes
        $effect(() => {
            const isGenerating = chat.generating;
            if (wasGenerating && !isGenerating && id) {
                listWorkspaceFiles(id)
                    .then((result) => {
                        sandboxFiles = result.files;
                    })
                    .catch(() => {
                        // Non-critical
                    });
            }
            wasGenerating = isGenerating;
        });

        // Auto-collapse thinking dropdowns
        $effect(() => {
            for (const item of renderItems) {
                if (item.type === "thinkingGroup") {
                    if (!item.streaming && !(item.id in thinkingOpen)) {
                        thinkingOpen[item.id] = false;
                    }
                } else {
                    const msg = item.msg;
                    if (
                        msg.thinkingStreaming === false &&
                        !(msg.id in thinkingOpen) &&
                        msg.thinking
                    ) {
                        thinkingOpen[msg.id] = false;
                    }
                }
            }
        });

        // Load models on mount
        onMount(async () => {
            try {
                availableModels = await listModels();
            } catch {
                // Models will be empty, user can still chat with default
            }
        });

        // Model selector initialization
        $effect(() => {
            if (availableModels.length > 0 && !selectedModelId && !defaultApplied) {
                selectedModelId = availableModels[0]?.id || "";
            }
            if (!defaultApplied && settingsStore.defaultModel) {
                selectedModelId = settingsStore.defaultModel;
                defaultApplied = true;
            }
            if (!defaultApplied && pageData.lastModel) {
                selectedModelId = pageData.lastModel.modelId;
                defaultApplied = true;
            }
        });

        // Conversation title
        $effect(() => {
            const conversationInfo = conversations.list.find(
                (x) => x.id === chat.conversationId
            );
            if (conversationInfo) {
                conversationTitle = conversationInfo.title;
            }
        });

        // Draft persistence
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

        // SSE connection lifecycle
        $effect(() => {
            const currentId = id;
            console.log(
                `[chat-lifecycle] $effect: running for id=${currentId}, prev hydrated=${String(untrack(() => hydrated))}`
            );
            draftRestored = false;
            hydrated = false;
            if (currentId) {
                untrack(() => {
                    sandboxFiles = pageData.sandboxFiles;
                    void connectStream(currentId, pageData.messageHistory).then(
                        async () => {
                            await onConnectStreamResolved(currentId);
                        }
                    );
                });
            }
            return () => {
                untrack(() => {
                    disconnectStream();
                });
            };
        });

        // Auto-scroll to bottom
        $effect(() => {
            const count = displayMessages.length;
            const lastMsg = displayMessages[count - 1];
            const _content = lastMsg.content;
            const _thinking = lastMsg.thinking;
            const _streaming = lastMsg.streaming;
            const _thinkingStreaming = lastMsg.thinkingStreaming;
            const _upload = uploadProgress;

            if (scrollRaf !== undefined) cancelAnimationFrame(scrollRaf);
            scrollRaf = requestAnimationFrame(() => {
                scrollRaf = undefined;
                if (viewportEl) {
                    viewportEl.scrollTop = viewportEl.scrollHeight;
                }
            });
        });

        // DAG refresh on navigation state change
        $effect(() => {
            if (sidePanel === "history" && !chat.navigating) {
                void loadDagData();
            }
        });

        // Panel state persistence — restore
        $effect(() => {
            const currentId = id;
            if (currentId) {
                const saved = loadPanelState(currentId);
                sidePanel = saved.sidePanel;
                if (saved.sidePanel === "history") {
                    void loadDagData();
                }
            }
        });

        // Panel state persistence — save
        $effect(() => {
            const sp = sidePanel;
            untrack(() => {
                if (id) {
                    savePanelState(id, { sidePanel: sp });
                }
            });
        });
    }

    return {
        // --- Readable state ---
        get id() { return id; },
        get hydrated() { return hydrated; },
        get inputText() { return inputText; },
        get inputFullscreen() { return inputFullscreen; },
        get pendingFiles() { return pendingFiles; },
        get sandboxFiles() { return sandboxFiles; },
        get uploadProgress() { return uploadProgress; },
        get viewportEl() { return viewportEl; },
        get availableModels() { return availableModels; },
        get selectedModelId() { return selectedModelId; },
        get thinkingOpen() { return thinkingOpen; },
        get sidePanel() { return sidePanel; },
        get searchResultsOpen() { return searchResultsOpen; },
        get searchResultsQuery() { return searchResultsQuery; },
        get searchResultsData() { return searchResultsData; },
        get fetchedPageOpen() { return fetchedPageOpen; },
        get fetchedPageUrl() { return fetchedPageUrl; },
        get fetchedPageTitle() { return fetchedPageTitle; },
        get fetchedPageContent() { return fetchedPageContent; },
        get topBarVisible() { return topBarVisible; },
        get dagNodes() { return dagNodes; },
        get dagLeafId() { return dagLeafId; },
        get contextUsageFraction() { return contextUsageFraction; },
        get conversationTitle() { return conversationTitle; },
        get defaultApplied() { return defaultApplied; },
        get waitingForResponse() { return waitingForResponse; },
        get displayMessages() { return displayMessages; },
        get renderItems() { return renderItems; },

        // --- Writable state (for two-way binding) ---
        get inputTextWritable() { return inputText; },
        set inputTextWritable(v: string) { inputText = v; },
        get inputFullscreenWritable() { return inputFullscreen; },
        set inputFullscreenWritable(v: boolean) { inputFullscreen = v; },
        get viewportElWritable() { return viewportEl; },
        set viewportElWritable(v: HTMLElement | null) { viewportEl = v; },
        get thinkingOpenWritable() { return thinkingOpen;
