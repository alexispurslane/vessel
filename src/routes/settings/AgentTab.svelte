<script lang="ts">
    import { onMount } from "svelte";
    import {
        Card,
        CardContent,
        CardDescription,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { Button } from "$lib/components/ui/button";
    import { Spinner } from "$lib/components/ui/spinner";
    import { getSettings, updateSettings, restartAllSessions } from "$lib/api.js";
    import Check from "@lucide/svelte/icons/check";
    import SystemPromptEditor from "$lib/components/conversation-settings/SystemPromptEditor.svelte";

    // --- Agent settings state ---
    let agentInstructions = $state<string[]>([]);
    let agentSettingsLoading = $state(true);
    let agentSettingsSaved = $state(false);
    let agentSettingsError = $state<string | null>(null);
    let agentCustomSystemPrompt = $state("");
    let agentNeedsSave = $state(false);

    // Internal appSettings for loading initial values
    let appSettings = $state<Record<string, string>>({});

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
                "agent.appendSystemPrompt": JSON.stringify(
                    agentInstructions.length > 0 ? agentInstructions : []
                ),
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
            setTimeout(() => {
                agentSettingsSaved = false;
            }, 2000);
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

    onMount(async () => {
        try {
            appSettings = await getSettings();
        } catch {
            // Use defaults
        }
        loadAgentSettings();
    });
</script>

<Card>
    <CardHeader>
        <CardTitle>Agent</CardTitle>
        <CardDescription
            >Configure the AI agent's behavior for all conversations. Custom instructions are
            appended to the system prompt on every turn. Per-conversation settings override these
            globals when set.</CardDescription
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
                    Instructions appended to the system prompt for every conversation. These
                    supplement the default prompt — they don't replace it. Per-conversation settings
                    override these globals when set.
                </p>

                <SystemPromptEditor
                    instructions={agentInstructions}
                    customSystemPrompt={agentCustomSystemPrompt}
                    effectiveSystemPrompt="(will be applied on next session start)"
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
