<script lang="ts">
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
    import { Separator } from "$lib/components/ui/separator";
    import { Spinner } from "$lib/components/ui/spinner";
    import { getUserInfo, updateUserInfo, restartAllSessions } from "$lib/api.js";
    import Check from "@lucide/svelte/icons/check";

    // --- Profile settings state ---
    let originalUsername = $state("");
    let originalPronouns = $state("");
    let username = $state("");
    let pronouns = $state("");
    let loading = $state(true);
    let saved = $state(false);
    let error = $state<string | null>(null);
    let needsSave = $derived(username !== originalUsername || pronouns !== originalPronouns);
    // --- Password change state ---
    let currentPassword = $state("");
    let newPassword = $state("");
    let confirmPassword = $state("");
    let passwordSaved = $state(false);
    let passwordError = $state<string | null>(null);

    let passwordMismatch = $derived(confirmPassword.length > 0 && newPassword !== confirmPassword);
    let passwordTooShort = $derived(newPassword.length > 0 && newPassword.length < 8);
    let canChangePassword = $derived(
        currentPassword.length > 0 &&
            newPassword.length >= 8 &&
            confirmPassword.length > 0 &&
            !passwordMismatch &&
            !passwordTooShort
    );

    onMount(async () => {
        try {
            const info = await getUserInfo();
            username = info.username;
            originalUsername = info.username;
            pronouns = info.pronouns ?? "";
            originalPronouns = info.pronouns ?? "";
        } catch {
            error = "Failed to load user info";
        } finally {
            loading = false;
        }
    });

    async function saveProfile() {
        error = null;
        saved = false;
        try {
            const result = await updateUserInfo({
                username: username !== originalUsername ? username : undefined,
                pronouns: pronouns !== originalPronouns ? pronouns || null : undefined,
            });
            originalUsername = result.username;
            originalPronouns = result.pronouns ?? "";
            username = result.username;
            pronouns = result.pronouns ?? "";

            // Restart sessions so they pick up new name/pronouns in system prompt
            await restartAllSessions();

            saved = true;
            setTimeout(() => {
                saved = false;
            }, 2000);
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to save profile";
        }
    }

    async function changePassword() {
        passwordError = null;
        passwordSaved = false;
        try {
            await updateUserInfo({
                currentPassword,
                newPassword,
            });
            currentPassword = "";
            newPassword = "";
            confirmPassword = "";
            passwordSaved = true;
            setTimeout(() => {
                passwordSaved = false;
            }, 2000);
        } catch (e) {
            passwordError = e instanceof Error ? e.message : "Failed to change password";
        }
    }
</script>

<div class="space-y-6">
    {#if loading}
        <div class="flex items-center justify-center py-8">
            <Spinner class="h-6 w-6" />
        </div>
    {:else}
        <!-- Profile Card -->
        <Card>
            <CardHeader>
                <CardTitle>Profile</CardTitle>
                <CardDescription
                    >Your name and pronouns are included in the AI's system prompt so it can address
                    you properly.</CardDescription
                >
            </CardHeader>
            <CardContent>
                <div class="space-y-4">
                    {#if error}
                        <p class="text-sm text-destructive">{error}</p>
                    {/if}
                    {#if saved}
                        <p class="text-sm text-green-600">Profile saved.</p>
                    {/if}

                    <div class="space-y-2">
                        <Label for="username">Username</Label>
                        <Input
                            id="username"
                            type="text"
                            placeholder="Your username"
                            bind:value={username}
                            autocomplete="username"
                        />
                        <p class="text-xs text-muted-foreground">
                            This is your display name and login identity.
                        </p>
                    </div>

                    <div class="space-y-2">
                        <Label for="pronouns">Pronouns</Label>
                        <Input
                            id="pronouns"
                            type="text"
                            placeholder="e.g. they/them, she/her, he/him"
                            bind:value={pronouns}
                        />
                        <p class="text-xs text-muted-foreground">
                            Your pronouns will be appended to the system prompt so the AI uses them
                            when addressing you.
                        </p>
                    </div>

                    <div class="flex justify-end pt-2">
                        <Button onclick={saveProfile} disabled={!needsSave}>
                            {#if saved}
                                <Check class="mr-1.5 h-4 w-4" /> Saved
                            {:else}
                                Save Profile
                            {/if}
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>

        <Separator />

        <!-- Password Card -->
        <Card>
            <CardHeader>
                <CardTitle>Change Password</CardTitle>
                <CardDescription
                    >Update your login password. You must enter your current password to make
                    changes.</CardDescription
                >
            </CardHeader>
            <CardContent>
                <div class="space-y-4">
                    {#if passwordError}
                        <p class="text-sm text-destructive">{passwordError}</p>
                    {/if}
                    {#if passwordSaved}
                        <p class="text-sm text-green-600">Password changed successfully.</p>
                    {/if}

                    <div class="space-y-2">
                        <Label for="current-password">Current Password</Label>
                        <Input
                            id="current-password"
                            type="password"
                            placeholder="Enter your current password"
                            bind:value={currentPassword}
                            autocomplete="current-password"
                        />
                    </div>

                    <div class="space-y-2">
                        <Label for="new-password">New Password</Label>
                        <Input
                            id="new-password"
                            type="password"
                            placeholder="At least 8 characters"
                            bind:value={newPassword}
                            autocomplete="new-password"
                        />
                        {#if passwordTooShort}
                            <p class="text-sm text-destructive">
                                Password must be at least 8 characters
                            </p>
                        {/if}
                    </div>

                    <div class="space-y-2">
                        <Label for="confirm-new-password">Confirm New Password</Label>
                        <Input
                            id="confirm-new-password"
                            type="password"
                            placeholder="Re-enter your new password"
                            bind:value={confirmPassword}
                            autocomplete="new-password"
                        />
                        {#if passwordMismatch}
                            <p class="text-sm text-destructive">Passwords do not match</p>
                        {/if}
                    </div>

                    <div class="flex justify-end pt-2">
                        <Button onclick={changePassword} disabled={!canChangePassword}>
                            {#if passwordSaved}
                                <Check class="mr-1.5 h-4 w-4" /> Changed
                            {:else}
                                Change Password
                            {/if}
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    {/if}
</div>
