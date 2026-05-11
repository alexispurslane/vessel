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
        //
        // Disable precompression for standalone builds — the binary serves
        // assets from memory and compresses on-the-fly, so .br/.gz files
        // would just bloat the binary (~4.7MB saved).
        adapter: adapter({
            precompress: process.env.VESSEL_STANDALONE !== "1",
        }),
    },
};

export default config;
