<script lang="ts">
    import { onMount } from "svelte";
    import { PROVIDERS, isOpenAICompatibleProvider, getApiTypes } from "$lib/providers.js";
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
    } from "$lib/api.js";
    import type { ProviderInfo, ModelInfo, CustomModelDef } from "$lib/types.js";
    import Plus from "@lucide/svelte/icons/plus";
    import Trash2 from "@lucide/svelte/icons/trash-2";
    import RefreshCw from "@lucide/svelte/icons/refresh-cw";
    import Check from "@lucide/svelte/icons/check";
    import Pencil from "@lucide/svelte/icons/pencil";
    import {
        Select,
        SelectContent,
        SelectItem,
        SelectTrigger,
        SelectValue,
    } from "$lib/components/ui/select";

    // --- Provider state ---
    let providers = $state<ProviderInfo[]>([]);
    let providerLoading = $state(true);
    let newProviderName = $state("");
    let newProviderKey = $state("");
    let newProviderBaseUrl = $state("");
    let newProviderDisplayName = $state("");
    let newProviderModelsEndpoint = $state("");
    let providerError = $state<string | null>(null);
    let showAddProvider = $state(false);

    // Fetch-models state per provider
    let fetchedModels = $state<Record<string, string[]>>({});
    let fetchingModels = $state<Record<string, boolean>>({});
    let fetchError = $state<Record<string, string>>({});

    /** Whether the current provider selection supports a models endpoint */
    let isOpenAICompatible = $derived(isOpenAICompatibleProvider(newProviderName));

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
            showAddProvider = false;
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
        // Scroll to the form after Svelte renders it
        setTimeout(() => {
            document
                .getElementById("custom-model-form")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 0);
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

    const API_OPTIONS = getApiTypes();

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
        setTimeout(() => {
            document
                .getElementById("custom-model-form")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 0);
    }

    // --- App settings state ---
    let appSettings = $state<Record<string, string>>({});
    let settingsLoading = $state(true);
    let settingsError = $state<string | null>(null);
    let defaultModelId = $state<string>("");
    let secondaryModelId = $state<string>("");

    async function loadAppSettings() {
        settingsLoading = true;
        try {
            appSettings = await getSettings();
            const dm = appSettings["defaultModel"] ?? "";
            const sm = appSettings["secondaryModel"] ?? "";
            if (dm) defaultModelId = dm;
            if (sm) secondaryModelId = sm;
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
            await updateSettings({
                secondaryModel: modelId,
            });
        } catch (e) {
            settingsError = e instanceof Error ? e.message : "Failed to save secondary model";
        }
    }

    onMount(() => {
        loadProviders();
        loadModels();
        loadCustomModels();
        loadAppSettings();
    });
</script>

<Card>
    <CardHeader>
        <CardTitle>Models</CardTitle>
        <CardDescription
            >Configure LLM providers, default models, and custom model definitions.</CardDescription
        >
    </CardHeader>
    <CardContent>
        <div class="space-y-8">
            <!-- Default Models Section -->
            <div>
                <h3 class="text-base font-medium">Default Models</h3>
                <p class="text-sm text-muted-foreground">
                    Choose the default model for new chats and the secondary model used for
                    auto-generating titles and tags.
                </p>
            </div>
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

                    <div class="space-y-2">
                        <Label>Secondary Model (Titles & Tags)</Label>
                        <p class="text-xs text-muted-foreground">
                            Used for auto-generating conversation titles and tags. A fast, cheap
                            model is recommended.
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

            <Separator />

            <!-- API Providers Section -->
            <div>
                <h3 class="text-base font-medium">API Providers</h3>
                <p class="text-sm text-muted-foreground">
                    Configure LLM provider API keys and base URLs. OpenAI-compatible providers can
                    auto-discover models from a <code class="text-xs bg-muted px-1 py-0.5 rounded"
                        >/v1/models</code
                    > endpoint.
                </p>
            </div>
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
                                                onclick={() => handleFetchModels(prov.provider)}
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
                                        <p class="mb-2 text-xs font-medium text-muted-foreground">
                                            Available models ({fetchedModels[prov.provider].length})
                                        </p>
                                        <div class="flex flex-wrap gap-1.5">
                                            {#each fetchedModels[prov.provider] as modelId}
                                                {@const alreadyAdded = isModelAdded(modelId)}
                                                <Badge
                                                    variant={alreadyAdded ? "secondary" : "outline"}
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
                                            Click a model to configure and add it as a custom model
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

                {#if showAddProvider}
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
                                    {#each PROVIDERS as prov}
                                        <option value={prov.id}>{prov.displayName}</option>
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
                                >Display Name <span class="text-muted-foreground">(optional)</span
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
                                    URL to fetch available models. Click "Fetch Models" after adding
                                    to auto-discover.
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
                {:else}
                    <Button variant="outline" onclick={() => (showAddProvider = true)}>
                        <Plus class="mr-1.5 h-4 w-4" /> Add Provider
                    </Button>
                {/if}
            {/if}

            <Separator />

            <!-- Custom Models Section -->
            <div>
                <h3 class="text-base font-medium">Custom Models</h3>
                <p class="text-sm text-muted-foreground">
                    Custom models configured for local providers like Ollama, vLLM, or LM Studio.
                </p>
            </div>
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
                                        <Badge variant="outline" class="text-xs">{cm.api}</Badge>
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
                                    <span>{cm.contextWindow.toLocaleString()} ctx</span>
                                    <span>{cm.maxTokens.toLocaleString()} out</span>
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
                    <div id="custom-model-form" class="space-y-4 rounded-lg border p-4">
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
                            <Button variant="outline" onclick={resetCustomModelForm}>Cancel</Button>
                        </div>
                    </div>
                {:else}
                    <Button variant="outline" onclick={() => (showAddModel = true)}>
                        <Plus class="mr-1.5 h-4 w-4" /> Add Custom Model
                    </Button>
                {/if}
            {/if}
        </div>
    </CardContent>
</Card>
