<script lang="ts">
    import { getAuth, setup, clearError } from "$lib/stores/auth.svelte.js";
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
    let confirmPassword = $state("");
    let submitting = $state(false);

    let passwordMismatch = $derived(confirmPassword.length > 0 && password !== confirmPassword);
    let passwordTooShort = $derived(password.length > 0 && password.length < 8);
    let canSubmit = $derived(
        username.length > 0 &&
            password.length >= 8 &&
            confirmPassword.length > 0 &&
            !passwordMismatch &&
            !submitting &&
            !auth.loading
    );

    onMount(() => {
        if (!auth.needsSetup) {
            void goto(resolve("/login"));
        }
    });

    async function handleSubmit() {
        if (!canSubmit) return;

        clearError();
        submitting = true;
        try {
            const success = await setup(username, password);
            if (success) {
                void goto(resolve("/"));
            }
        } finally {
            submitting = false;
        }
    }
</script>

<div class="flex min-h-svh items-center justify-center p-4">
    <Card class="w-full max-w-sm">
        <CardHeader class="text-center">
            <img src="/vessel.webp" alt="Vessel" class="mx-auto size-10 rounded-full" />
            <CardTitle class="text-xl">Vessel</CardTitle>
            <CardDescription>Create Account</CardDescription>
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
                        placeholder="Choose a username"
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
                        placeholder="At least 8 characters"
                        bind:value={password}
                        autocomplete="new-password"
                        required
                    />
                    {#if passwordTooShort}
                        <p class="text-sm text-destructive">
                            Password must be at least 8 characters
                        </p>
                    {/if}
                </div>

                <div class="space-y-2">
                    <Label for="confirm-password">Confirm Password</Label>
                    <Input
                        id="confirm-password"
                        type="password"
                        placeholder="Re-enter your password"
                        bind:value={confirmPassword}
                        autocomplete="new-password"
                        required
                    />
                    {#if passwordMismatch}
                        <p class="text-sm text-destructive">Passwords do not match</p>
                    {/if}
                </div>

                {#if auth.error}
                    <p class="text-sm text-destructive">{auth.error}</p>
                {/if}

                <Button type="submit" class="w-full" disabled={!canSubmit}>
                    {#if submitting || auth.loading}
                        Creating account...
                    {:else}
                        Create Account
                    {/if}
                </Button>
            </form>
        </CardContent>
    </Card>
</div>
