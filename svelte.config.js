import adapter from "svelte-adapter-bun";

/** @type {import('@sveltejs/kit').Config} */
const config = {
    compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) =>
            filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
    },
    kit: {
        // Community-maintained adapter optimized for Bun's native HTTP server.
        // See https://github.com/nicobailon/svelte-adapter-bun for configuration options.
        adapter: adapter(),
    },
};

export default config;
