<script lang="ts">
    import { getAuth, doLogin, clearError } from "$lib/stores/auth.svelte.js";
    import { goto } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { onMount } from "svelte";
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

    const auth = getAuth();

    let username = $state("");
    let password = $state("");
    let submitting = $state(false);

    let canSubmit = $derived(
        username.length > 0 && password.length > 0 && !submitting && !auth.loading
    );

    onMount(() => {
        if (auth.needsSetup) {
            void goto(resolve("/setup"));
        } else if (auth.isAuthenticated) {
            void goto(resolve("/"));
        }
    });

    async function handleSubmit() {
        if (!canSubmit) return;

        clearError();
        submitting = true;
        try {
            await doLogin(username, password);
        } finally {
            submitting = false;
        }
    }
</script>

<div class="flex min-h-svh items-center justify-center p-4">
    <Card class="w-full max-w-sm">
        <CardHeader class="text-center">
            <img src="/vessel.png" alt="Vessel" class="mx-auto size-10 rounded-full" />
            <CardTitle class="text-xl">Vessel</CardTitle>
            <CardDescription>Sign In</CardDescription>
        </CardHeader>
        <CardContent>
            <form
                onsubmit={(e) => {
                    e.preventDefault();
                    void handleSubmit();
                }}
                class="space-y-4"
            >
                <div class="space-y-2">
                    <Label for="username">Username</Label>
                    <Input
                        id="username"
                        type="text"
                        placeholder="Enter your username"
                        bind:value={username}
                        autocomplete="username"
                        required
                    />
                </div>

                <div class="space-y-2">
                    <Label for="password">Password</Label>
                    <Input
                        id="password"
                        type="password"
                        placeholder="Enter your password"
                        bind:value={password}
                        autocomplete="current-password"
                        required
                    />
                </div>

                {#if auth.error}
                    <p class="text-sm text-destructive">{auth.error}</p>
                {/if}

                <Button type="submit" class="w-full" disabled={!canSubmit}>
                    {#if submitting || auth.loading}
                        Signing in...
                    {:else}
                        Sign In
                    {/if}
                </Button>
            </form>
        </CardContent>
    </Card>
</div>
