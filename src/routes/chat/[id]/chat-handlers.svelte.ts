/**
 * @file Extracted page-level handlers for the chat/[id] route.
 */

import {
    getChat,
    send,
} from "$lib/stores/chat.svelte.js";
import {
    uploadFile,
    updateConversationSettings,
    listWorkspaceFiles,
    listCanvasFiles,
} from "$lib/api.js";
import type { ConversationSettings } from "$lib/types.js";
import type { PageData } from "./$types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A pending file queued by the user before sending. */
export interface PendingFile {
    file: File;
    id: string;
}

/** Upload progress state — null when idle. */
export type UploadProgress = {
    currentFile: string;
    fileIndex: number;
    totalFiles: number;
    /** 0-1 fraction of the current file uploaded */
    fraction: number;
} | null;

/** Arguments passed from the page component into the handler factory. */
export interface ChatHandlerContext {
    /** Reactive getter for the current conversation id */
    getId: () => string;
    /** Reactive getter for SSR page data */
    getPageData: () => PageData;
    /** Reactive getter for the current URL search params */
    getUrl: () => URL;
    /** Setter to clear the input text */
    setInputText: (v: string) => void;
    /** Getter for the current input text */
    getInputText: () => string;
    /** Setter for pending files */
    setPendingFiles: (v: PendingFile[]) => void;
    /** Getter for pending files */
    getPendingFiles: () => PendingFile[];
    /** Setter for upload progress */
    setUploadProgress: (v: UploadProgress) => void;
    /** Getter for upload progress */
    getUploadProgress: () => UploadProgress;
    /** Setter for sandbox files */
    setSandboxFiles: (v: string[]) => void;
    /** Getter for sandbox files */
    getSandboxFiles: () => string[];
    /** Setter for pending status updates */
    setPendingStatusUpdates: (v: string[]) => void;
    /** Getter for pending status updates */
    getPendingStatusUpdates: () => string[];
    /** Setter for selectedModelId */
    setSelectedModelId: (v: string) => void;
    /** Getter for selectedModelId */
    getSelectedModelId: () => string;
    /** Setter for hydrated flag */
    setHydrated: (v: boolean) => void;
    /** Getter for hydrated flag */
    getHydrated: () => boolean;
    /** Setter for conversation's default model ID */
    setConversationDefaultModelId: (v: string) => void;
    /** Getter for conversation's default model ID */
    getConversationDefaultModelId: () => string;
    /** Setter for model initialized flag */
    setModelInitialized: (v: boolean) => void;
    /** Getter for model initialized flag */
    getModelInitialized: () => boolean;
    /** Setter for draftRestored flag */
    setDraftRestored: (v: boolean) => void;
    /** Setter for the conversation ID the draft was restored for */
    setDraftRestoredForId: (v: string | null) => void;
    /** Setter for canvas-ized file paths */
    setCanvasFiles: (v: Set<string>) => void;
    /** Getter for canvas-ized file paths */
    getCanvasFiles: () => Set<string>;
    /** Callback to scroll to a hash-anchored message */
    scrollToHashMessage: () => void;
    /** Callback to hide the top bar */
    hideTopBar: () => void;
    /** Draft key helper */
    draftKey: (conversationId: string) => string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the chat page handlers.
 *
 * Returns `handleSend` and `onConnectStream` (the callback invoked after
 * `connectStream` resolves). Both are extracted here to keep the page
 * component focused on rendering.
 */
/**
 * Get the shared chat store instance.
 * Both handler factories need this — extracted to avoid duplication.
 * @returns The chat store API object
 */
function getSharedChat() {
    return getChat();
}

// ---------------------------------------------------------------------------
// Sandbox settings parser (shared between pre-connect and sendInitialMessage)
// ---------------------------------------------------------------------------

/**
 * Parse sandbox quick-toggle settings from URL search params.
 * @param url - The URL containing search params
 * @returns The parsed conversation settings
 */
export function parseSandboxSettings(url: URL): ConversationSettings {
    const settings: ConversationSettings = {};
    const sandboxOnParam = url.searchParams.get("sandboxOn");
    const netAllDomainsOnParam = url.searchParams.get("netAllDomainsOn");
    const mcpServersOnParam = url.searchParams.get("mcpServersOn");
    const agentModeParam = url.searchParams.get("agentMode");

    if (sandboxOnParam !== null)
        settings.sandboxEnabled = sandboxOnParam === "true";
    if (netAllDomainsOnParam === "true") {
        settings.allowNet = true;
        settings.allowAllDomains = true;
    } else if (netAllDomainsOnParam === "false") {
        settings.allowNet = false;
        settings.allowAllDomains = false;
    }
    if (mcpServersOnParam === "true") settings.enabledMcpServers = null;
    else if (mcpServersOnParam === "false") settings.enabledMcpServers = [];
    if (agentModeParam === "agent") settings.agentMode = "agent";
    else if (agentModeParam === "chat") settings.agentMode = "chat";

    return settings;
}

/**
 * Apply sandbox settings from URL params *before* connecting the SSE stream.
 *
 * This must happen before connectStream because updateConversationSettings
 * can restart the server-side agent session (when sandbox-affecting settings
 * change). If the restart happens after the SSE subscription is established,
 * the subscriber is detached from the new session and all subsequent SSE
 * events are silently lost — the user sees no messages until they reload.
 *
 * By applying settings first, the session is in its final state before the
 * SSE stream subscribes, so no restart is needed.
 * @param conversationId - The conversation ID
 * @param url - The URL containing sandbox settings params
 * @returns {Promise<void>}
 */
export async function applyInitialSettings(
    conversationId: string,
    url: URL,
): Promise<void> {
    const settings = parseSandboxSettings(url);
    if (Object.keys(settings).length > 0) {
        try {
            await updateConversationSettings(conversationId, settings);
        } catch {
            // Best-effort — the conversation will use defaults
        }
    }
}

// ---------------------------------------------------------------------------
// Send handlers
// ---------------------------------------------------------------------------

/**
 * Upload pending files, track progress, and return the uploaded file names.
 * Throws on upload failure — caller handles cleanup.
 * @param currentId - The current conversation ID
 * @param filesToSend - The pending files to upload
 * @param ctx - The chat handler context
 * @returns The uploaded file names
 */
async function uploadFiles(
    currentId: string,
    filesToSend: PendingFile[],
    ctx: ChatHandlerContext,
): Promise<string[]> {
    const uploadedNames: string[] = [];
    for (let i = 0; i < filesToSend.length; i++) {
        const pf = filesToSend[i];
        ctx.setUploadProgress({
            currentFile: pf.file.name,
            fileIndex: i,
            totalFiles: filesToSend.length,
            fraction: 0,
        });
        await uploadFile(currentId, pf.file, (loaded, total) => {
            ctx.setUploadProgress({
                currentFile: pf.file.name,
                fileIndex: i,
                totalFiles: filesToSend.length,
                fraction: loaded / total,
            });
        });
        uploadedNames.push(pf.file.name);
    }
    return uploadedNames;
}

/**
 * Create the send-related handlers: `handleSend` (with file upload support)
 * and its sub-functions. Extracted from +page.svelte to keep the page focused on rendering.
 * @param ctx - The chat handler context
 * @returns Object with handleSend and chat store
 */
export function createSendHandlers(ctx: ChatHandlerContext) {
    const chat = getSharedChat();

    /**
     * Send with files: upload first, then send to API with status content.
     * @param text - The message text
     * @param filesToSend - The files to upload
     * @param statusUpdates - Status messages to include
     */
    async function handleSendWithFiles(
        text: string,
        filesToSend: PendingFile[],
        statusUpdates: string[],
    ) {
        const currentId = ctx.getId();
        chat.addLocalUserMessage(text || "📎 Uploading files...");
        ctx.setInputText("");
        ctx.setPendingFiles([]);
        sessionStorage.removeItem(ctx.draftKey(currentId));
        ctx.hideTopBar();

        try {
            const uploadedNames = await uploadFiles(currentId, filesToSend, ctx);
            statusUpdates.push(`Files with names ${uploadedNames.join(", ")} added to your sandbox`);
            ctx.setSandboxFiles([...ctx.getSandboxFiles(), ...uploadedNames]);
            ctx.setUploadProgress(null);
            void chat.sendToApi(text, ctx.getSelectedModelId() || undefined, statusUpdates.join("\n\n") || undefined);
        } catch (err) {
            console.error("[chat] File upload failed:", err);
            chat.setError(err instanceof Error ? err.message : "File upload failed");
            ctx.setUploadProgress(null);
        }
    }

    /**
     * Send without files: may include invisible status updates.
     * @param text - The message text
     * @param statusUpdates - Status messages to include
     */
    function handleSendWithoutFiles(text: string, statusUpdates: string[]) {
        const currentId = ctx.getId();
        if (statusUpdates.length > 0) {
            chat.addLocalUserMessage(text || "📎 Updated sandbox files");
            const statusText = statusUpdates.join("\n\n");
            void chat.sendToApi(text, ctx.getSelectedModelId() || undefined, statusText || undefined);
        } else {
            void send(text, ctx.getSelectedModelId() || undefined);
        }
        ctx.setInputText("");
        sessionStorage.removeItem(ctx.draftKey(currentId));
        ctx.hideTopBar();
    }

    async function handleSend() {
        const text = ctx.getInputText().trim();
        const filesToSend = [...ctx.getPendingFiles()];
        const hasStatus = ctx.getPendingStatusUpdates().length > 0;
        console.log(
            `[chat-lifecycle] handleSend: text=${String(!!text)}, files=${String(filesToSend.length)}, ` +
            `connected=${String(chat.connected)}, generating=${String(chat.generating)}`
        );
        if ((!text && filesToSend.length === 0 && !hasStatus) || !chat.connected || chat.generating)
            return;

        const statusUpdates = [...ctx.getPendingStatusUpdates()];
        ctx.setPendingStatusUpdates([]);

        if (filesToSend.length > 0) {
            await handleSendWithFiles(text, filesToSend, statusUpdates);
        } else {
            handleSendWithoutFiles(text, statusUpdates);
        }
    }

    return {
        handleSend,
        chat,
    };
}

// ---------------------------------------------------------------------------
// ConnectStream handler
// ---------------------------------------------------------------------------

/**
 * Create the `onConnectStream` callback invoked after `connectStream` resolves.
 * Handles hydration, model restoration, draft restoration, and initial messages.
 * @param ctx - The chat handler context
 * @returns Object with onConnectStream and chat store
 */
export function createConnectStreamHandler(ctx: ChatHandlerContext) {
    const chat = getSharedChat();

    /**
     * Send the initial message passed via URL params.
     * Waits for the SSE stream to be connected first — the server can't deliver
     * events until the subscriber is registered.
     * @param currentId - The current conversation ID
     * @param initialMessage - The initial message text
     * @param initialModel - Optional model ID override
     */
    async function sendInitialMessage(currentId: string, initialMessage: string, initialModel: string | null) {
        const modelId = initialModel || ctx.getSelectedModelId();
        if (modelId) ctx.setSelectedModelId(modelId);

        await chat.waitForConnected();
        void send(initialMessage, modelId);
        sessionStorage.removeItem(ctx.draftKey(currentId));
    }

    /**
     * Called after `connectStream` resolves. Handles hydration, model restoration,
     * draft restoration, and initial messages.
     * @param currentId - The current conversation ID
     */
    function onConnectStream(currentId: string) {
        console.log(
            `[chat-lifecycle] connectStream resolved, msgs=${String(chat.messages.length)}, ` +
            `connected=${String(chat.connected)}, generating=${String(chat.generating)}`
        );
        ctx.setHydrated(true);

        ctx.scrollToHashMessage();
        // Sync model selector from the conversation's default on (re)connect.
        if (chat.conversationDefaultModel && !ctx.getModelInitialized()) {
            const defaultModelId = ctx.getConversationDefaultModelId();
            if (defaultModelId) {
                ctx.setSelectedModelId(defaultModelId);
            } else {
                ctx.setSelectedModelId(chat.conversationDefaultModel.modelId);
                ctx.setConversationDefaultModelId(chat.conversationDefaultModel.modelId);
            }
            ctx.setModelInitialized(true);
        }

        // Refresh sandbox files now that the session is hydrated.
        listWorkspaceFiles(currentId)
            .then((result) => {
                console.log(`[chat-lifecycle] sandboxFiles from API: length=${String(result.files.length)}, files=${JSON.stringify(result.files)}`);
                ctx.setSandboxFiles(result.files);
            })
            .catch(() => { /* non-critical */ });

        // Refresh canvas files list so the file pills show the correct icons.
        listCanvasFiles(currentId)
            .then((result) => {
                ctx.setCanvasFiles(new Set(result.canvases.map((c) => c.filePath)));
            })
            .catch(() => { /* non-critical */ });

        const saved = sessionStorage.getItem(ctx.draftKey(currentId));
        if (saved) ctx.setInputText(saved);
        ctx.setDraftRestored(true);
        ctx.setDraftRestoredForId(currentId);

        const url = ctx.getUrl();
        const initialMessage = url.searchParams.get("initialMessage");
        const initialModel = url.searchParams.get("initialModel");
        if (initialMessage) {
            // Strip params before async send; HMR re-runs $effect.
            window.history.replaceState({}, "", `/chat/${currentId}`);
            void sendInitialMessage(currentId, initialMessage, initialModel);
        }
    }

    return {
        onConnectStream,
        chat,
    };
}
