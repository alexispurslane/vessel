<script lang="ts">
    import { onMount } from "svelte";
    import { Tabs, TabsContent, TabsList, TabsTrigger } from "$lib/components/ui/tabs";
    import {
        Card,
        CardContent,
        CardDescription,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { Button } from "$lib/components/ui/button";
    import { Separator } from "$lib/components/ui/separator";
    import { Badge } from "$lib/components/ui/badge";
    import { Switch } from "$lib/components/ui/switch";
    import { Spinner } from "$lib/components/ui/spinner";
    import {
        listProviders,
        upsertProvider,
        deleteProvider,
        fetchProviderModels,
        listModels,
        listCustomModels,
        upsertCustomModel,
        deleteCustomModel,
        getSettings,
        updateSettings,
        restartAllSessions,
    } from "$lib/api.js";
    import type { ProviderInfo, ModelInfo, CustomModelDef } from "$lib/types.js";
    import Key from "@lucide/svelte/icons/key";
    import Cpu from "@lucide/svelte/icons/cpu";
    import Plus from "@lucide/svelte/icons/plus";
    import Trash2 from "@lucide/svelte/icons/trash-2";
    import RefreshCw from "@lucide/svelte/icons/refresh-cw";
    import Check from "@lucide/svelte/icons/check";
    import Settings2 from "@lucide/svelte/icons/settings-2";
    import Pencil from "@lucide/svelte/icons/pencil";
    import Shield from "@lucide/svelte/icons/shield";
    import FileText from "@lucide/svelte/icons/file-text";
    import X from "@lucide/svelte/icons/x";
    import PageLayout from "$lib/components/page-layout/index.svelte";
    import SystemPromptEditor from "$lib/components/conversation-settings/SystemPromptEditor.svelte";
    import { PillList, PathAutocompletePillList, PillKeyValueList } from "$lib/components/pill-list/index.js";
    import {
        Select,
        SelectContent,
        SelectItem,
        SelectTrigger,
        SelectValue,
    } from "$lib/components/ui/select";
    import { goto } from "$app/navigation";
    import { getConversations } from "$lib/stores/conversations.svelte.js";

    // --- Provider state ---
    let providers = $state<ProviderInfo[]>([]);
    let providerLoading = $state(true);
    let newProviderName = $state("");
    let newProviderKey = $state("");
    let newProviderBaseUrl = $state("");
    let newProviderDisplayName = $state("");
    let newProviderModelsEndpoint = $state("");
    let providerError = $state<string | null>(null);

    // Fetch-models state per provider
    let fetchedModels = $state<Record<string, string[]>>({});
    let fetchingModels = $state<Record<string, boolean>>({});
    let fetchError = $state<Record<string, string>>({});

    /** Whether the current provider selection supports a models endpoint */
    let isOpenAICompatible = $derived(
        newProviderName === "openai-compatible" ||
            newProviderName === "ollama" ||
            newProviderName === "lm-studio" ||
            newProviderName === "vllm" ||
            newProviderName === "openrouter" ||
            newProviderName === "groq" ||
            newProviderName === "cerebras" ||
            newProviderName === "xai"
    );

    const PROVIDER_OPTIONS = [
        "openai",
        "openai-compatible",
        "anthropic",
        "google",
        "mistral",
        "groq",
        "cerebras",
        "xai",
        "openrouter",
        "ollama",
        "lm-studio",
        "vllm",
    ];

    /** Whether a given existing provider supports model fetching */
    function providerSupportsFetch(prov: ProviderInfo): boolean {
        return !!prov.modelsEndpoint;
    }

    async function loadProviders() {
        providerLoading = true;
        try {
            providers = await listProviders();
        } catch (e) {
            providerError = e instanceof Error ? e.message : "Failed to load providers";
        } finally {
            providerLoading = false;
        }
    }

    async function addProvider() {
        providerError = null;
        if (!newProviderName || !newProviderKey) {
            providerError = "Provider name and API key are required";
            return;
        }
        try {
            await upsertProvider(newProviderName, newProviderKey, {
                baseUrl: newProviderBaseUrl || undefined,
                displayName: newProviderDisplayName || undefined,
                modelsEndpoint:
                    isOpenAICompatible && newProviderModelsEndpoint
                        ? newProviderModelsEndpoint
                        : undefined,
            });
            newProviderName = "";
            newProviderKey = "";
            newProviderBaseUrl = "";
            newProviderDisplayName = "";
            newProviderModelsEndpoint = "";
            await loadProviders();
        } catch (e) {
            providerError = e instanceof Error ? e.message : "Failed to add provider";
        }
    }

    async function removeProvider(provider: string) {
        try {
            await deleteProvider(provider);
            // Clean up fetched models state
            delete fetchedModels[provider];
            delete fetchingModels[provider];
            delete fetchError[provider];
            await loadProviders();
        } catch (e) {
            providerError = e instanceof Error ? e.message : "Failed to delete provider";
        }
    }

    async function handleFetchModels(provider: string) {
        fetchingModels[provider] = true;
        fetchError[provider] = "";
        fetchedModels[provider] = [];
        try {
            const result = await fetchProviderModels(provider);
            fetchedModels[provider] = result.models;
        } catch (e) {
            fetchError[provider] = e instanceof Error ? e.message : "Failed to fetch models";
        } finally {
            fetchingModels[provider] = false;
        }
    }

    function addFetchedModelAsCustom(provider: string, modelId: string) {
        // Pre-fill the custom model form with the fetched model info
        const prov = providers.find((p) => p.provider === provider);
        const baseUrl = prov?.baseUrl ?? "";

        cmId = modelId;
        cmProvider = provider;
        cmName = modelId;
        cmApi = "openai-completions";
        cmBaseUrl = baseUrl;
        cmReasoning = false;
        cmInputText = true;
        cmInputImage = false;
        cmContextWindow = 128000;
        cmMaxTokens = 16384;
        cmCostInput = 0;
        cmCostOutput = 0;
        cmCostCacheRead = 0;
        cmCostCacheWrite = 0;
        editingModelId = null;
        showAddModel = true;
        // Switch to the custom models tab so the user sees the form
        activeTab = "custom";
    }

    function isModelAdded(modelId: string): boolean {
        return customModels.some((cm) => cm.id === modelId);
    }

    // --- Models state ---
    let models = $state<ModelInfo[]>([]);
    let modelLoading = $state(true);
    let modelError = $state<string | null>(null);

    async function loadModels() {
        modelLoading = true;
        try {
            models = await listModels();
        } catch (e) {
            modelError = e instanceof Error ? e.message : "Failed to load models";
        } finally {
            modelLoading = false;
        }
    }

    // --- Custom models state ---
    let customModels = $state<CustomModelDef[]>([]);
    let customModelLoading = $state(true);
    let customModelError = $state<string | null>(null);

    // Form state for adding custom model
    let showAddModel = $state(false);
    let editingModelId = $state<string | null>(null); // model ID when editing
    let cmId = $state("");
    let cmProvider = $state("");
    let cmName = $state("");
    let cmApi = $state("openai-completions");
    let cmBaseUrl = $state("");
    let cmReasoning = $state(false);
    let cmInputText = $state(true);
    let cmInputImage = $state(false);
    let cmContextWindow = $state(128000);
    let cmMaxTokens = $state(16384);
    let cmCostInput = $state(0);
    let cmCostOutput = $state(0);
    let cmCostCacheRead = $state(0);
    let cmCostCacheWrite = $state(0);

    const API_OPTIONS = [
        "openai-completions",
        "openai-responses",
        "anthropic-messages",
        "google-generative-ai",
        "mistral-conversations",
    ];

    async function loadCustomModels() {
        customModelLoading = true;
        try {
            customModels = await listCustomModels();
        } catch (e) {
            customModelError = e instanceof Error ? e.message : "Failed to load custom models";
        } finally {
            customModelLoading = false;
        }
    }

    function getInputTypes(): string[] {
        const types: string[] = [];
        if (cmInputText) types.push("text");
        if (cmInputImage) types.push("image");
        return types.length > 0 ? types : ["text"];
    }

    function resetCustomModelForm() {
        cmId = "";
        cmProvider = "";
        cmName = "";
        cmApi = "openai-completions";
        cmBaseUrl = "";
        cmReasoning = false;
        cmInputText = true;
        cmInputImage = false;
        cmContextWindow = 128000;
        cmMaxTokens = 16384;
        cmCostInput = 0;
        cmCostOutput = 0;
        cmCostCacheRead = 0;
        cmCostCacheWrite = 0;
        showAddModel = false;
        editingModelId = null;
    }

    async function addCustomModel() {
        customModelError = null;
        if (!cmId || !cmProvider || !cmName || !cmBaseUrl) {
            customModelError = "ID, provider, name, and base URL are required";
            return;
        }
        try {
            await upsertCustomModel({
                id: cmId,
                provider: cmProvider,
                name: cmName,
                api: cmApi,
                baseUrl: cmBaseUrl,
                reasoning: cmReasoning,
                inputTypes: getInputTypes(),
                contextWindow: cmContextWindow,
                maxTokens: cmMaxTokens,
                cost: {
                    input: cmCostInput,
                    output: cmCostOutput,
                    cacheRead: cmCostCacheRead,
                    cacheWrite: cmCostCacheWrite,
                },
            });
            resetCustomModelForm();
            await loadCustomModels();
        } catch (e) {
            customModelError = e instanceof Error ? e.message : "Failed to add custom model";
        }
    }

    async function removeCustomModel(id: string) {
        try {
            await deleteCustomModel(id);
            await loadCustomModels();
        } catch (e) {
            customModelError = e instanceof Error ? e.message : "Failed to delete custom model";
        }
    }

    function editCustomModel(cm: CustomModelDef) {
        cmId = cm.id;
        cmProvider = cm.provider;
        cmName = cm.name;
        cmApi = cm.api;
        cmBaseUrl = cm.baseUrl;
        cmReasoning = cm.reasoning;
        cmInputText = cm.inputTypes.includes("text");
        cmInputImage = cm.inputTypes.includes("image");
        cmContextWindow = cm.contextWindow;
        cmMaxTokens = cm.maxTokens;
        cmCostInput = cm.cost.input;
        cmCostOutput = cm.cost.output;
        cmCostCacheRead = cm.cost.cacheRead;
        cmCostCacheWrite = cm.cost.cacheWrite;
        editingModelId = cm.id;
        showAddModel = true;
    }

    onMount(() => {
        loadProviders();
        loadModels();
        loadCustomModels();
        loadAppSettings();
    });

    // --- App settings state ---
    let appSettings = $state<Record<string, string>>({});
    let settingsLoading = $state(true);
    let settingsError = $state<string | null>(null);
    let defaultModelId = $state<string>(""); // Just the model ID
    let secondaryModelId = $state<string>(""); // Just the model ID
    let activeTab = $state("providers");

    async function loadAppSettings() {
        settingsLoading = true;
        try {
            appSettings = await getSettings();
            const dm = appSettings["defaultModel"] ?? "";
            const sm = appSettings["secondaryModel"] ?? "";
            if (dm) defaultModelId = dm;
            if (sm) secondaryModelId = sm;
            loadSandboxSettings();
            loadAgentSettings();
        } catch (e) {
            settingsError = e instanceof Error ? e.message : "Failed to load settings";
        } finally {
            settingsLoading = false;
        }
    }

    async function saveDefaultModel(modelId: string) {
        settingsError = null;
        defaultModelId = modelId;
        if (!modelId) {
            await updateSettings({ defaultProvider: "", defaultModel: "" });
            return;
        }
        try {
            // Provider is resolved automatically from model ID on the backend
            await updateSettings({
                defaultModel: modelId,
            });
        } catch (e) {
            settingsError = e instanceof Error ? e.message : "Failed to save default model";
        }
    }

    async function saveSecondaryModel(modelId: string) {
        settingsError = null;
        secondaryModelId = modelId;
        if (!modelId) {
            await updateSettings({ secondaryProvider: "", secondaryModel: "" });
            return;
        }
        try {
            // Provider is resolved automatically from model ID on the backend
            await updateSettings({
                secondaryModel: modelId,
            });
        } catch (e) {
            settingsError = e instanceof Error ? e.message : "Failed to save secondary model";
        }
    }

    function handleBack() {
        const convs = getConversations();
        const activeId = convs.activeId;
        if (activeId) {
            goto(`/chat/${activeId}`);
        } else {
            goto("/");
        }
    }

    // --- Sandbox settings state ---
    let sandboxEnabled = $state(true);
    let sandboxSnapshotEnabled = $state(true);
    let sandboxAllowNet = $state(false);
    let sandboxSettingsLoading = $state(false);
    let sandboxSettingsSaved = $state(false);
    let sandboxSettingsError = $state<string | null>(null);

    // Pill-based list states
    let readPaths = $state<Array<{ path: string; editing?: boolean }>>([]);
    let writePaths = $state<Array<{ path: string; editing?: boolean }>>([]);
    let allowedDomains = $state<Array<{ domain: string; editing?: boolean }>>([]);
    let allowedEnvVars = $state<Array<{ name: string; editing?: boolean }>>([]);

    // Secrets state for custom pill UI
    let secrets = $state<Array<{ key: string; value: string; hosts: string; editing?: boolean }>>([]);

    function loadPillListsFromSettings() {
        readPaths = (JSON.parse(appSettings["sandbox.extraReadPaths"] || "[]") as string[])
            .map((p: string) => ({ path: p, editing: false }));
        writePaths = (JSON.parse(appSettings["sandbox.extraWritePaths"] || "[]") as string[])
            .map((p: string) => ({ path: p, editing: false }));
        allowedDomains = (JSON.parse(appSettings["sandbox.allowedNetDomains"] || "[]") as string[])
            .map((d: string) => ({ domain: d, editing: false }));
        allowedEnvVars = (JSON.parse(appSettings["sandbox.allowEnv"] || "[]") as string[])
            .map((e: string) => ({ name: e, editing: false }));
    }

    function savePillListsToSettings(): Record<string, string> {
        return {
            "sandbox.extraReadPaths": JSON.stringify(readPaths.map((p) => p.path).filter(Boolean)),
            "sandbox.extraWritePaths": JSON.stringify(writePaths.map((p) => p.path).filter(Boolean)),
            "sandbox.allowedNetDomains": JSON.stringify(allowedDomains.map((d) => d.domain).filter(Boolean)),
            "sandbox.allowEnv": JSON.stringify(allowedEnvVars.map((e) => e.name).filter(Boolean)),
        };
    }

    function loadSecretsFromSettings() {
        const secretsObj = JSON.parse(appSettings["sandbox.secrets"] || "{}") as Record<string, { value: string; hosts: string[] }>;
        secrets = Object.entries(secretsObj).map(([key, config]) => ({
            key,
            value: config.value,
            hosts: config.hosts.join(","),
            editing: false,
        }));
    }

    function loadSandboxSettings() {
        sandboxSettingsLoading = true;
        try {
            sandboxEnabled = appSettings["sandbox.enabled"] !== "false";
            sandboxAllowNet = appSettings["sandbox.allowNet"] === "true";
            loadPillListsFromSettings();
            loadSecretsFromSettings();
            sandboxSnapshotEnabled = appSettings["sandbox.snapshotEnabled"] !== "false";
        } catch {
            // Use defaults on parse error
        } finally {
            sandboxSettingsLoading = false;
        }
    }

    async function saveSandboxSettings() {
        sandboxSettingsError = null;
        sandboxSettingsSaved = false;
        try {
            const pillLists = savePillListsToSettings();

            const secretsObj: Record<string, { value: string; hosts: string[] }> = {};
            for (const s of secrets) {
                if (s.key.trim()) {
                    secretsObj[s.key.trim()] = {
                        value: s.value,
                        hosts: s.hosts.split(",").map((h: string) => h.trim()).filter(Boolean),
                    };
                }
            }

            await updateSettings({
                "sandbox.enabled": sandboxEnabled ? "true" : "false",
                "sandbox.allowNet": sandboxAllowNet ? "true" : "false",
                "sandbox.secrets": JSON.stringify(secretsObj),
                "sandbox.snapshotEnabled": sandboxSnapshotEnabled ? "true" : "false",
                ...pillLists,
            });

            // Restart all active sessions so they pick up the new sandbox policy
            await restartAllSessions();

            sandboxSettingsSaved = true;
            setTimeout(() => { sandboxSettingsSaved = false; }, 2000);
        } catch (e) {
            sandboxSettingsError = e instanceof Error ? e.message : "Failed to save sandbox settings";
        }
    }

    // --- Agent settings state ---
    let agentInstructions = $state<string[]>([]);
    let agentSettingsLoading = $state(false);
    let agentSettingsSaved = $state(false);
    let agentSettingsError = $state<string | null>(null);
    let agentCustomSystemPrompt = $state("");
    let agentNeedsSave = $state(false);

    function loadAgentSettings() {
        agentSettingsLoading = true;
        try {
            // Load global appendSystemPrompt
            const raw = appSettings["agent.appendSystemPrompt"];
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    agentInstructions = Array.isArray(parsed) ? parsed : [parsed];
                } catch {
                    agentInstructions = [];
                }
            } else {
                agentInstructions = [];
            }

            // Load global customSystemPrompt
            agentCustomSystemPrompt = appSettings["agent.customSystemPrompt"] ?? "";
            agentNeedsSave = false;
        } catch {
            agentInstructions = [];
            agentCustomSystemPrompt = "";
        } finally {
            agentSettingsLoading = false;
        }
    }

    async function saveAgentSettings() {
        agentSettingsError = null;
        agentSettingsSaved = false;
        try {
            const updates: Record<string, string> = {
                "agent.appendSystemPrompt": JSON.stringify(agentInstructions.length > 0 ? agentInstructions : []),
            };

            if (agentCustomSystemPrompt) {
                updates["agent.customSystemPrompt"] = agentCustomSystemPrompt;
            } else {
                updates["agent.customSystemPrompt"] = "";
            }

            await updateSettings(updates);

            // Restart all active sessions so they pick up the new settings
            await restartAllSessions();

            agentSettingsSaved = true;
            agentNeedsSave = false;
            setTimeout(() => { agentSettingsSaved = false; }, 2000);
        } catch (e) {
            agentSettingsError = e instanceof Error ? e.message : "Failed to save agent settings";
        }
    }

    // --- SystemPromptEditor callbacks (deferred mode: accumulate, save on button) ---

    function handleAgentAdd(text: string) {
        agentInstructions = [...agentInstructions, text];
        agentNeedsSave = true;
    }

    function handleAgentRemove(index: number) {
        agentInstructions = agentInstructions.filter((_, i) => i !== index);
        agentNeedsSave = true;
    }

    function handleAgentEdit(index: number, newText: string) {
        const updated = [...agentInstructions];
        updated[index] = newText;
        agentInstructions = updated;
        agentNeedsSave = true;
    }

    function handleAgentReplaceChange(value: string) {
        agentCustomSystemPrompt = value;
        agentNeedsSave = true;
    }

    function handleAgentReplaceClear() {
        agentCustomSystemPrompt = "";
        agentNeedsSave = true;
    }
</script>

<PageLayout title="Settings" onback={handleBack}>
    <Tabs bind:value={activeTab}>
        <TabsList class="mb-6 w-full justify-start">
            <TabsTrigger value="defaults"><Settings2 class="mr-1.5 h-4 w-4" /> Defaults</TabsTrigger
            >
            <TabsTrigger value="providers"><Key class="mr-1.5 h-4 w-4" /> Providers</TabsTrigger>
            <TabsTrigger value="models"><Cpu class="mr-1.5 h-4 w-4" /> Models</TabsTrigger>
            <TabsTrigger value="sandbox"><Shield class="mr-1.5 h-4 w-4" /> Sandbox</TabsTrigger>
            <TabsTrigger value="agent"><FileText class="mr-1.5 h-4 w-4" /> Agent</TabsTrigger>
        </TabsList>

        <!-- Defaults Tab -->
        <TabsContent value="defaults">
            <Card>
                <CardHeader>
                    <CardTitle>Default Models</CardTitle>
                    <CardDescription
                        >Choose the default model for new chats and the secondary model used for
                        auto-generating titles and tags.</CardDescription
                    >
                </CardHeader>
                <CardContent>
                    {#if settingsLoading}
                        <div class="flex items-center justify-center py-8">
                            <Spinner class="h-6 w-6" />
                        </div>
                    {:else}
                        <div class="space-y-6">
                            {#if settingsError}
                                <p class="text-sm text-destructive">
                                    {settingsError}
                                </p>
                            {/if}

                            <!-- Default Chat Model -->
                            <div class="space-y-2">
                                <Label>Default Chat Model</Label>
                                <p class="text-xs text-muted-foreground">
                                    The model used by default when starting new conversations.
                                </p>
                                <Select
                                    type="single"
                                    value={defaultModelId}
                                    onValueChange={(v: string) => saveDefaultModel(v)}
                                >
                                    <SelectTrigger class="w-full">
                                        <SelectValue placeholder="Auto (first available)" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="">Auto (first available)</SelectItem>
                                        {#each models as model (model.id)}
                                            <SelectItem value={model.id}>
                                                {model.name}
                                                <span class="text-muted-foreground ml-1"
                                                    >({model.provider})</span
                                                >
                                            </SelectItem>
                                        {/each}
                                    </SelectContent>
                                </Select>
                            </div>

                            <Separator />

                            <!-- Secondary Model -->
                            <div class="space-y-2">
                                <Label>Secondary Model (Titles & Tags)</Label>
                                <p class="text-xs text-muted-foreground">
                                    Used for auto-generating conversation titles and tags. A fast,
                                    cheap model is recommended.
                                </p>
                                <Select
                                    type="single"
                                    value={secondaryModelId}
                                    onValueChange={(v: string) => saveSecondaryModel(v)}
                                >
                                    <SelectTrigger class="w-full">
                                        <SelectValue placeholder="Same as default" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="">Same as default</SelectItem>
                                        {#each models as model (model.id)}
                                            <SelectItem value={model.id}>
                                                {model.name}
                                                <span class="text-muted-foreground ml-1"
                                                    >({model.provider})</span
                                                >
                                            </SelectItem>
                                        {/each}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    {/if}
                </CardContent>
            </Card>
        </TabsContent>

        <!-- Providers Tab -->
        <TabsContent value="providers">
            <Card>
                <CardHeader>
                    <CardTitle>API Providers</CardTitle>
                    <CardDescription
                        >Configure LLM provider API keys and base URLs. OpenAI-compatible providers
                        can auto-discover models from a <code
                            class="text-xs bg-muted px-1 py-0.5 rounded">/v1/models</code
                        > endpoint.</CardDescription
                    >
                </CardHeader>
                <CardContent>
                    {#if providerLoading}
                        <div class="flex items-center justify-center py-8">
                            <Spinner class="h-6 w-6" />
                        </div>
                    {:else}
                        {#if providers.length > 0}
                            <div class="mb-6 space-y-3">
                                {#each providers as prov (prov.provider)}
                                    <div class="rounded-lg border p-3">
                                        <div class="flex items-center justify-between">
                                            <div class="flex items-center gap-3">
                                                <span class="font-medium">
                                                    {prov.displayName ?? prov.provider}
                                                </span>
                                                {#if prov.displayName && prov.displayName !== prov.provider}
                                                    <Badge variant="outline" class="text-xs"
                                                        >{prov.provider}</Badge
                                                    >
                                                {/if}
                                                {#if prov.hasKey}
                                                    <Badge variant="secondary" class="text-xs"
                                                        >Key set</Badge
                                                    >
                                                {:else}
                                                    <Badge variant="destructive" class="text-xs"
                                                        >No key</Badge
                                                    >
                                                {/if}
                                            </div>
                                            <div class="flex items-center gap-1">
                                                {#if providerSupportsFetch(prov)}
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onclick={() =>
                                                            handleFetchModels(prov.provider)}
                                                        disabled={fetchingModels[prov.provider]}
                                                    >
                                                        {#if fetchingModels[prov.provider]}
                                                            <Spinner class="mr-1 h-3 w-3" />
                                                        {:else}
                                                            <RefreshCw class="mr-1 h-3 w-3" />
                                                        {/if}
                                                        Fetch Models
                                                    </Button>
                                                {/if}
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onclick={() => removeProvider(prov.provider)}
                                                >
                                                    <Trash2 class="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                        {#if prov.baseUrl}
                                            <p class="mt-1 text-sm text-muted-foreground">
                                                Base: {prov.baseUrl}
                                            </p>
                                        {/if}
                                        {#if prov.modelsEndpoint}
                                            <p class="text-sm text-muted-foreground">
                                                Models: {prov.modelsEndpoint}
                                            </p>
                                        {/if}

                                        <!-- Fetched models list -->
                                        {#if fetchError[prov.provider]}
                                            <p class="mt-2 text-sm text-destructive">
                                                {fetchError[prov.provider]}
                                            </p>
                                        {/if}
                                        {#if fetchedModels[prov.provider]?.length > 0}
                                            <div class="mt-3 border-t pt-3">
                                                <p
                                                    class="mb-2 text-xs font-medium text-muted-foreground"
                                                >
                                                    Available models ({fetchedModels[prov.provider]
                                                        .length})
                                                </p>
                                                <div class="flex flex-wrap gap-1.5">
                                                    {#each fetchedModels[prov.provider] as modelId}
                                                        {@const alreadyAdded =
                                                            isModelAdded(modelId)}
                                                        <Badge
                                                            variant={alreadyAdded
                                                                ? "secondary"
                                                                : "outline"}
                                                            class="cursor-pointer select-none text-xs {alreadyAdded
                                                                ? 'opacity-60'
                                                                : 'hover:bg-accent'}"
                                                            onclick={() => {
                                                                addFetchedModelAsCustom(
                                                                    prov.provider,
                                                                    modelId
                                                                );
                                                            }}
                                                        >
                                                            {modelId}
                                                            {#if alreadyAdded}
                                                                <Check class="ml-1 h-2.5 w-2.5" />
                                                            {:else}
                                                                <Pencil class="ml-1 h-2.5 w-2.5" />
                                                            {/if}
                                                        </Badge>
                                                    {/each}
                                                </div>
                                                <p class="mt-1.5 text-xs text-muted-foreground">
                                                    Click a model to configure and add it as a
                                                    custom model
                                                </p>
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                            <Separator class="my-4" />
                        {/if}

                        {#if providerError}
                            <p class="mb-4 text-sm text-destructive">
                                {providerError}
                            </p>
                        {/if}

                        <div class="space-y-3">
                            <p class="text-sm font-medium">Add Provider</p>
                            <div class="grid grid-cols-2 gap-3">
                                <div>
                                    <Label for="prov-name">Provider</Label>
                                    <select
                                        id="prov-name"
                                        bind:value={newProviderName}
                                        class="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    >
                                        <option value="" disabled>Select provider</option>
                                        {#each PROVIDER_OPTIONS as opt}
                                            <option value={opt}>{opt}</option>
                                        {/each}
                                    </select>
                                </div>
                                <div>
                                    <Label for="prov-key">API Key</Label>
                                    <Input
                                        id="prov-key"
                                        type="password"
                                        bind:value={newProviderKey}
                                        placeholder="sk-..."
                                        class="mt-1"
                                    />
                                </div>
                            </div>
                            <div>
                                <Label for="prov-display-name"
                                    >Display Name <span class="text-muted-foreground"
                                        >(optional)</span
                                    ></Label
                                >
                                <Input
                                    id="prov-display-name"
                                    bind:value={newProviderDisplayName}
                                    placeholder="My Local Server"
                                    class="mt-1"
                                />
                            </div>
                            <div>
                                <Label for="prov-url"
                                    >Base URL <span class="text-muted-foreground">(optional)</span
                                    ></Label
                                >
                                <Input
                                    id="prov-url"
                                    bind:value={newProviderBaseUrl}
                                    placeholder="https://api.openai.com/v1"
                                    class="mt-1"
                                />
                            </div>
                            {#if isOpenAICompatible}
                                <div>
                                    <Label for="prov-models-endpoint"
                                        >Models Endpoint <span class="text-muted-foreground"
                                            >(optional)</span
                                        ></Label
                                    >
                                    <Input
                                        id="prov-models-endpoint"
                                        bind:value={newProviderModelsEndpoint}
                                        placeholder="https://my-server.com/v1/models"
                                        class="mt-1"
                                    />
                                    <p class="mt-1 text-xs text-muted-foreground">
                                        URL to fetch available models. Click "Fetch Models" after
                                        adding to auto-discover.
                                    </p>
                                </div>
                            {/if}
                            <Button
                                onclick={addProvider}
                                disabled={!newProviderName || !newProviderKey}
                            >
                                <Plus class="mr-1.5 h-4 w-4" /> Add Provider
                            </Button>
                        </div>
                    {/if}
                </CardContent>
            </Card>
        </TabsContent>

        <!-- Models Tab -->
        <TabsContent value="models">
            <Card>
                <CardHeader>
                    <CardTitle>Models</CardTitle>
                    <CardDescription
                        >Custom models configured for local providers like Ollama, vLLM, or LM Studio.</CardDescription
                    >
                </CardHeader>
                <CardContent>
                    {#if customModelLoading}
                        <div class="flex items-center justify-center py-8">
                            <Spinner class="h-6 w-6" />
                        </div>
                    {:else}
                        {#if customModels.length > 0}
                            <div class="mb-6 space-y-3">
                                {#each customModels as cm (cm.id + cm.provider)}
                                    <div class="rounded-lg border p-3">
                                        <div class="flex items-center justify-between">
                                            <div class="flex items-center gap-3">
                                                <span class="font-medium">{cm.name}</span>
                                                <Badge variant="outline" class="text-xs"
                                                    >{cm.provider}</Badge
                                                >
                                                <Badge variant="outline" class="text-xs"
                                                    >{cm.api}</Badge
                                                >
                                                {#if cm.reasoning}
                                                    <Badge variant="secondary" class="text-xs"
                                                        >reasoning</Badge
                                                    >
                                                {/if}
                                            </div>
                                            <div class="flex items-center gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onclick={() => editCustomModel(cm)}
                                                >
                                                    <Pencil class="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onclick={() => removeCustomModel(cm.id)}
                                                >
                                                    <Trash2 class="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                        <div
                                            class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"
                                        >
                                            <span>ID: {cm.id}</span>
                                            <span>Base: {cm.baseUrl}</span>
                                            <span>Inputs: {cm.inputTypes.join(", ")}</span>
                                            <span
                                                >{cm.contextWindow.toLocaleString()}
                                                ctx</span
                                            >
                                            <span
                                                >{cm.maxTokens.toLocaleString()}
                                                out</span
                                            >
                                        </div>
                                    </div>
                                {/each}
                            </div>
                            <Separator class="my-4" />
                        {:else}
                            <p class="mb-4 text-center text-muted-foreground">
                                No custom models yet. Add one below.
                            </p>
                        {/if}

                        {#if customModelError}
                            <p class="mb-4 text-sm text-destructive">
                                {customModelError}
                            </p>
                        {/if}

                        <Separator class="my-4" />

                        {#if showAddModel}
                            <div class="space-y-4 rounded-lg border p-4">
                                <p class="font-medium">
                                    {editingModelId ? "Edit Model" : "Add Custom Model"}
                                </p>
                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <Label for="cm-id">Model ID</Label>
                                        <Input
                                            id="cm-id"
                                            bind:value={cmId}
                                            placeholder="llama3.2"
                                            class="mt-1"
                                            disabled={!!editingModelId}
                                        />
                                    </div>
                                    <div>
                                        <Label for="cm-provider">Provider</Label>
                                        <Input
                                            id="cm-provider"
                                            bind:value={cmProvider}
                                            placeholder="ollama"
                                            class="mt-1"
                                            disabled={!!editingModelId}
                                        />
                                    </div>
                                    <div>
                                        <Label for="cm-name">Display Name</Label>
                                        <Input
                                            id="cm-name"
                                            bind:value={cmName}
                                            placeholder="Llama 3.2"
                                            class="mt-1"
                                        />
                                    </div>
                                    <div>
                                        <Label for="cm-api">API Type</Label>
                                        <select
                                            id="cm-api"
                                            bind:value={cmApi}
                                            class="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        >
                                            {#each API_OPTIONS as opt}
                                                <option value={opt}>{opt}</option>
                                            {/each}
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <Label for="cm-base-url">Base URL</Label>
                                    <Input
                                        id="cm-base-url"
                                        bind:value={cmBaseUrl}
                                        placeholder="http://localhost:11434"
                                        class="mt-1"
                                    />
                                </div>
                                <div class="flex items-center gap-6">
                                    <div class="flex items-center gap-3">
                                        <Switch bind:checked={cmReasoning} />
                                        <Label>Reasoning</Label>
                                    </div>
                                    <Separator orientation="vertical" class="h-4" />
                                    <div class="flex items-center gap-2 text-sm">
                                        <Label class="text-xs">Inputs:</Label>
                                        <label class="flex items-center gap-1.5 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                bind:checked={cmInputText}
                                                class="rounded border-input"
                                            />
                                            <span class="text-xs">Text</span>
                                        </label>
                                        <label class="flex items-center gap-1.5 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                bind:checked={cmInputImage}
                                                class="rounded border-input"
                                            />
                                            <span class="text-xs">Image</span>
                                        </label>
                                    </div>
                                </div>
                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <Label for="cm-ctx">Context Window (tokens)</Label>
                                        <Input
                                            id="cm-ctx"
                                            type="number"
                                            bind:value={cmContextWindow}
                                            class="mt-1"
                                        />
                                    </div>
                                    <div>
                                        <Label for="cm-max">Max Output Tokens</Label>
                                        <Input
                                            id="cm-max"
                                            type="number"
                                            bind:value={cmMaxTokens}
                                            class="mt-1"
                                        />
                                    </div>
                                </div>
                                <details class="group">
                                    <summary
                                        class="cursor-pointer text-sm text-muted-foreground hover:text-foreground"
                                    >
                                        Cost settings (optional)
                                    </summary>
                                    <div class="mt-3 grid grid-cols-2 gap-3">
                                        <div>
                                            <Label for="cm-ci">Cost Input (per 1M tokens)</Label>
                                            <Input
                                                id="cm-ci"
                                                type="number"
                                                step="0.01"
                                                bind:value={cmCostInput}
                                                class="mt-1"
                                            />
                                        </div>
                                        <div>
                                            <Label for="cm-co">Cost Output (per 1M tokens)</Label>
                                            <Input
                                                id="cm-co"
                                                type="number"
                                                step="0.01"
                                                bind:value={cmCostOutput}
                                                class="mt-1"
                                            />
                                        </div>
                                        <div>
                                            <Label for="cm-cr">Cost Cache Read</Label>
                                            <Input
                                                id="cm-cr"
                                                type="number"
                                                step="0.01"
                                                bind:value={cmCostCacheRead}
                                                class="mt-1"
                                            />
                                        </div>
                                        <div>
                                            <Label for="cm-cw">Cost Cache Write</Label>
                                            <Input
                                                id="cm-cw"
                                                type="number"
                                                step="0.01"
                                                bind:value={cmCostCacheWrite}
                                                class="mt-1"
                                            />
                                        </div>
                                    </div>
                                </details>
                                <div class="flex gap-2">
                                    <Button
                                        onclick={addCustomModel}
                                        disabled={!cmId || !cmProvider || !cmName || !cmBaseUrl}
                                    >
                                        {#if editingModelId}
                                            <Check class="mr-1.5 h-4 w-4" /> Save Changes
                                        {:else}
                                            <Plus class="mr-1.5 h-4 w-4" /> Add Model
                                        {/if}
                                    </Button>
                                    <Button variant="outline" onclick={resetCustomModelForm}
                                        >Cancel</Button
                                    >
                                </div>
                            </div>
                        {:else}
                            <Button variant="outline" onclick={() => (showAddModel = true)}>
                                <Plus class="mr-1.5 h-4 w-4" /> Add Custom Model
                            </Button>
                        {/if}
                    {/if}
                </CardContent>
            </Card>
        </TabsContent>

        <!-- Sandbox Tab -->
        <TabsContent value="sandbox">
            <Card>
                <CardHeader>
                    <CardTitle>Sandbox</CardTitle>
                    <CardDescription
                        >Configure zerobox sandboxing for agent tool execution. Each conversation
                        gets an isolated sandbox that restricts filesystem access, network, and
                        environment variables. Settings apply immediately to all conversations —
                        saving will restart any active sessions to pick up the new configuration.</CardDescription
                    >
                </CardHeader>
                <CardContent>
                    {#if sandboxSettingsLoading}
                        <div class="flex items-center justify-center py-8">
                            <Spinner class="h-6 w-6" />
                        </div>
                    {:else}
                        <div class="space-y-6">
                            {#if sandboxSettingsError}
                                <p class="text-sm text-destructive">{sandboxSettingsError}</p>
                            {/if}
                            {#if sandboxSettingsSaved}
                                <p class="text-sm text-green-600">Settings saved.</p>
                            {/if}

                            <!-- Enable/Disable -->
                            <div class="flex items-center justify-between rounded-lg border p-4">
                                <div class="space-y-0.5">
                                    <Label class="text-base font-medium">Enable Sandboxing</Label>
                                    <p class="text-sm text-muted-foreground"
                                        >When disabled, agent tools run without any isolation. Enable for
                                        safer execution of AI-generated commands and file
                                        operations.</p
                                    >
                                </div>
                                <Switch bind:checked={sandboxEnabled} />
                            </div>

                            {#if sandboxEnabled}
                                <!-- Extra Read Paths -->
                                <div class="rounded-lg border p-4 space-y-3">
                                    <div>
                                        <Label class="text-base font-medium">Extra Readable Paths</Label>
                                        <p class="text-sm text-muted-foreground mt-1"
                                            >Additional paths the agent can read from. The project directory
                                            and session workspace are always readable.</p
                                        >
                                    </div>

                                    <PathAutocompletePillList
                                        items={readPaths}
                                        onChange={(items) => (readPaths = items)}
                                        addPlaceholder="/path/to/directory"
                                        addButtonLabel="Add Path"
                                    />
                                </div>

                                <!-- Extra Write Paths -->
                                <div class="rounded-lg border p-4 space-y-3">
                                    <div>
                                        <Label class="text-base font-medium">Extra Writable Paths</Label>
                                        <p class="text-sm text-muted-foreground mt-1"
                                            >Additional paths the agent can write to. The session workspace
                                            is always writable.</p
                                        >
                                    </div>

                                    <PathAutocompletePillList
                                        items={writePaths}
                                        onChange={(items) => (writePaths = items)}
                                        addPlaceholder="/path/to/directory"
                                        addButtonLabel="Add Path"
                                    />
                                </div>

                                <Separator />

                                <!-- Network Access -->
                                <div class="rounded-lg border p-4 space-y-3">
                                    <div class="flex items-center justify-between">
                                        <div class="space-y-0.5">
                                            <Label class="text-base font-medium">Network Access</Label>
                                            <p class="text-sm text-muted-foreground"
                                                >When enabled, tools can make outbound network requests.</p
                                            >
                                        </div>
                                        <Switch bind:checked={sandboxAllowNet} />
                                    </div>

                                    {#if sandboxAllowNet}
                                        <Separator />

                                        <div class="space-y-3">
                                            <div>
                                                <Label class="text-sm font-medium">Allowed Domains</Label>
                                                <p class="text-xs text-muted-foreground mt-0.5"
                                                    >Leave empty to allow all domains. Otherwise, only these
                                                    domains will be accessible.</p
                                                >
                                            </div>

                                            <PillList
                                                items={allowedDomains}
                                                labelKey="domain"
                                                onChange={(items) => (allowedDomains = items)}
                                                addPlaceholder="example.com"
                                                addButtonLabel="Add Domain"
                                                inputWidth="w-36"
                                            />
                                        </div>

                                        <Separator />

                                        <div class="space-y-3">
                                            <div>
                                                <Label class="text-sm font-medium">Secrets</Label>
                                                <p class="text-xs text-muted-foreground mt-0.5"
                                                    >Credentials injected by the sandbox. The agent sees placeholders —
                                                    the real value is only substituted for requests to the specified
                                                    hosts.</p
                                                >
                                            </div>

                                            <PillKeyValueList
                                                items={secrets}
                                                fields={[
                                                    { key: "key", placeholder: "KEY", width: "w-24", mono: true },
                                                    { key: "value", placeholder: "value", width: "w-28", type: "password", viewDisplay: "mask" },
                                                    { key: "hosts", placeholder: "hosts", width: "w-20", showInView: false },
                                                ]}
                                                onChange={(items) => (secrets = items)}
                                                addButtonLabel="Add Secret"
                                            />
                                        </div>
                                    {/if}
                                </div>

                                <Separator />

                                <!-- Snapshot & Restore -->
                                <div
                                    class="flex items-center justify-between rounded-lg border p-4"
                                >
                                    <div class="space-y-0.5">
                                        <Label class="text-base font-medium">Snapshot Filesystem Changes</Label>
                                        <p class="text-sm text-muted-foreground"
                                            >Record all filesystem changes made by the agent for audit and
                                            potential undo.</p
                                        >
                                    </div>
                                    <Switch bind:checked={sandboxSnapshotEnabled} />
                                </div>

                                <Separator />

                                <!-- Environment Variables -->
                                <div class="rounded-lg border p-4 space-y-3">
                                    <div>
                                        <Label class="text-base font-medium">Allowed Environment Variables</Label>
                                        <p class="text-sm text-muted-foreground mt-1"
                                            >Only these environment variables will be visible inside the
                                            sandbox. PATH, HOME, USER, SHELL, TERM, LANG, and NODE_ENV are
                                            always included. All others are stripped unless added here.</p
                                        >
                                    </div>

                                    <PillList
                                        items={allowedEnvVars}
                                        labelKey="name"
                                        onChange={(items) => (allowedEnvVars = items)}
                                        addPlaceholder="VAR_NAME"
                                        addButtonLabel="Add Variable"
                                        inputWidth="w-28"
                                    />
                                </div>
                            {/if}

                            <!-- Save Button -->
                            <div class="flex justify-end pt-2">
                                <Button onclick={saveSandboxSettings}>
                                    {#if sandboxSettingsSaved}
                                        <Check class="mr-1.5 h-4 w-4" /> Saved
                                    {:else}
                                        Save Sandbox Settings
                                    {/if}
                                </Button>
                            </div>
                        </div>
                    {/if}
                </CardContent>
            </Card>
        </TabsContent>

        <!-- Agent Tab -->
        <TabsContent value="agent">
            <Card>
                <CardHeader>
                    <CardTitle>Agent</CardTitle>
                    <CardDescription
                        >Configure the AI agent's behavior for all conversations. Custom instructions are appended to the system prompt on every turn. Per-conversation settings override these globals when set.</CardDescription
                    >
                </CardHeader>
                <CardContent>
                    {#if agentSettingsLoading}
                        <div class="flex items-center justify-center py-8">
                            <Spinner class="h-6 w-6" />
                        </div>
                    {:else}
                        <div class="space-y-6">
                            {#if agentSettingsError}
                                <p class="text-sm text-destructive">{agentSettingsError}</p>
                            {/if}
                            {#if agentSettingsSaved}
                                <p class="text-sm text-green-600">Settings saved.</p>
                            {/if}

                            <p class="text-sm text-muted-foreground">
                                Instructions appended to the system prompt for every conversation. These supplement the default prompt — they don't replace it.
                                Per-conversation settings override these globals when set.
                            </p>

                            <SystemPromptEditor
                                instructions={agentInstructions}
                                customSystemPrompt={agentCustomSystemPrompt}
                                effectiveSystemPrompt="(will be applied on next session start)"
                                mode="deferred"
                                onadd={handleAgentAdd}
                                onremove={handleAgentRemove}
                                onedit={handleAgentEdit}
                                onreplacechange={handleAgentReplaceChange}
                                onreplaceclear={handleAgentReplaceClear}
                            />

                            <!-- Save Button -->
                            <div class="flex justify-end pt-2">
                                <Button onclick={saveAgentSettings} disabled={!agentNeedsSave}>
                                    {#if agentSettingsSaved}
                                        <Check class="mr-1.5 h-4 w-4" /> Saved
                                    {:else}
                                        Save Agent Settings
                                    {/if}
                                </Button>
                            </div>
                        </div>
                    {/if}
                </CardContent>
            </Card>
        </TabsContent>

    </Tabs>
</PageLayout>
