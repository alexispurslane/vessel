<script lang="ts">
    import { onMount } from "svelte";
    import {
        Card,
        CardContent,
        CardDescription,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { Switch } from "$lib/components/ui/switch";
    import { Button } from "$lib/components/ui/button";
    import {
        getNotificationsStore,
        setNotificationSetting,
        requestBrowserPermission,
        syncNotificationSettings,
    } from "$lib/stores/notifications.svelte.js";

    const notifications = getNotificationsStore();

    onMount(() => {
        syncNotificationSettings();
    });

    async function toggleBrowserNotifications(enabled: boolean) {
        if (enabled) {
            const granted = await requestBrowserPermission();
            if (!granted) {
                // Don't enable the switch if permission was denied
                return;
            }
        }
        await setNotificationSetting("notificationBrowser", enabled);
    }

    async function toggleSound(enabled: boolean) {
        await setNotificationSetting("notificationSound", enabled);
    }

    async function toggleTabTitle(enabled: boolean) {
        await setNotificationSetting("notificationTabTitle", enabled);
    }

    function playTestSound() {
        try {
            const audio = new Audio("/sounds/notification.mp3");
            audio.volume = 0.5;
            audio.play().catch(() => {
                // Ignore autoplay restrictions
            });
        } catch {
            // Ignore autoplay restrictions
        }
    }
</script>

<div class="space-y-6">
    <Card>
        <CardHeader>
            <CardTitle>Completion Notifications</CardTitle>
            <CardDescription>
                Get notified when a long-running AI generation finishes. Useful when you switch tabs
                while waiting for a response.
            </CardDescription>
        </CardHeader>
        <CardContent>
            <div class="space-y-3">
                <!-- Browser notification toggle -->
                <div class="rounded-lg border p-3">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-sm font-medium">Browser Notification</p>
                            <p class="text-xs text-muted-foreground mt-0.5">
                                Show a system notification when generation completes
                            </p>
                        </div>
                        <Switch
                            checked={notifications.browserEnabled}
                            onCheckedChange={(v) => void toggleBrowserNotifications(Boolean(v))}
                        />
                    </div>
                    {#if notifications.browserEnabled && !notifications.permissionGranted}
                        <div class="mt-2 flex items-center gap-2">
                            <p class="text-xs text-destructive">
                                Permission denied. You need to allow notifications in your browser
                                settings.
                            </p>
                        </div>
                    {:else if !notifications.browserEnabled && typeof Notification !== "undefined" && Notification.permission === "default"}
                        <div class="mt-2">
                            <p class="text-xs text-muted-foreground">
                                You'll be asked for permission when you enable this.
                            </p>
                        </div>
                    {/if}
                </div>

                <!-- Notification sound toggle -->
                <div class="rounded-lg border p-3">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-sm font-medium">Notification Sound</p>
                            <p class="text-xs text-muted-foreground mt-0.5">
                                Play a short sound when generation completes
                            </p>
                        </div>
                        <Switch
                            checked={notifications.soundEnabled}
                            onCheckedChange={(v) => void toggleSound(Boolean(v))}
                        />
                    </div>
                    {#if notifications.soundEnabled}
                        <div class="mt-2">
                            <Button variant="outline" size="sm" onclick={playTestSound}>
                                Preview Sound
                            </Button>
                        </div>
                    {/if}
                </div>

                <!-- Tab title update toggle -->
                <div class="rounded-lg border p-3">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-sm font-medium">Tab Title Update</p>
                            <p class="text-xs text-muted-foreground mt-0.5">
                                Prepend "(Done)" to the tab title when generation completes
                            </p>
                        </div>
                        <Switch
                            checked={notifications.tabTitleEnabled}
                            onCheckedChange={(v) => void toggleTabTitle(Boolean(v))}
                        />
                    </div>
                </div>
            </div>
        </CardContent>
    </Card>

    {#if typeof Notification !== "undefined" && Notification.permission === "denied"}
        <Card>
            <CardHeader>
                <CardTitle class="text-destructive">Browser Notifications Blocked</CardTitle>
                <CardDescription>
                    Browser notifications are blocked for this site. To re-enable them, open your
                    browser's site settings (usually via the lock icon in the address bar) and allow
                    notifications.
                </CardDescription>
            </CardHeader>
        </Card>
    {/if}
</div>
