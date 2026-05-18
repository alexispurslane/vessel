/**
 * @file SvelteKit app type augmentations for Vessel.
 */
// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
    namespace App {
        // interface Error {}
        interface Locals {
            authenticated: boolean;
            username?: string;
        }
        interface PageData {
            auth?: {
                setup: boolean;
                authenticated: boolean;
                username?: string;
            };
            /** Whether the server is running on Linux. */
            isLinux?: boolean;
        }
        // interface PageState {}
        // interface Platform {}
    }
}

export { };
