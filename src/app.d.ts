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
        }
        // interface PageState {}
        // interface Platform {}
    }
}

export { };
