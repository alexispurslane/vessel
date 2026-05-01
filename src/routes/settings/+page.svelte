<script lang="ts">
    import { Tabs, TabsContent, TabsList, TabsTrigger } from "$lib/components/ui/tabs";
    import Cpu from "@lucide/svelte/icons/cpu";
    import Plug from "@lucide/svelte/icons/plug";
    import Shield from "@lucide/svelte/icons/shield";
    import FileText from "@lucide/svelte/icons/file-text";
    import PageLayout from "$lib/components/page-layout/index.svelte";
    import { goto } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { getConversations } from "$lib/stores/conversations.svelte.js";
    import ModelsTab from "./ModelsTab.svelte";
    import SandboxTab from "./SandboxTab.svelte";
    import AgentTab from "./AgentTab.svelte";
    import ToolsTab from "./ToolsTab.svelte";

    let activeTab = $state("models");

    function handleBack() {
        const convs = getConversations();
        const activeId = convs.activeId;
        if (activeId) {
            goto(resolve(`/chat/${activeId}`));
        } else {
            goto(resolve("/"));
        }
    }
</script>

<PageLayout title="Settings" onback={handleBack}>
    <Tabs bind:value={activeTab}>
        <TabsList class="mb-6 w-full justify-start">
            <TabsTrigger value="models"><Cpu class="mr-1.5 h-4 w-4" /> Models</TabsTrigger>
            <TabsTrigger value="tools"><Plug class="mr-1.5 h-4 w-4" /> Tools</TabsTrigger>
            <TabsTrigger value="sandbox"><Shield class="mr-1.5 h-4 w-4" /> Sandbox</TabsTrigger>
            <TabsTrigger value="agent"><FileText class="mr-1.5 h-4 w-4" /> Agent</TabsTrigger>
        </TabsList>

        <!-- Models Tab -->
        <TabsContent value="models">
            <ModelsTab />
        </TabsContent>

        <!-- Sandbox Tab -->
        <TabsContent value="sandbox">
            <SandboxTab />
        </TabsContent>

        <!-- Agent Tab -->
        <TabsContent value="agent">
            <AgentTab />
        </TabsContent>

        <!-- Tools Tab -->
        <TabsContent value="tools">
            <ToolsTab />
        </TabsContent>
    </Tabs>
</PageLayout>
