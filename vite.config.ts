import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { fileURLToPath } from "url";

export default defineConfig({
    plugins: [tailwindcss(), sveltekit()],
    optimizeDeps: {
        // Prevent Vite's dep optimizer from pre-bundling svelte-streamdown's
        // sub-path exports (math, mermaid, code). These are .svelte components
        // that the optimizer can't handle — it strips them into broken JS chunks.
        // Letting SvelteKit's own transform pipeline handle them works correctly.
        exclude: ["svelte-streamdown/math", "svelte-streamdown/mermaid", "svelte-streamdown/code"],
        // Ensure mermaid and katex are pre-bundled. They're peer deps of
        // svelte-streamdown whose dynamic imports need to be resolved by Vite.
        // Without this, `import('mermaid')` / `import('katex')` inside the
        // Streamdown components fail at runtime.
        include: ["mermaid", "katex"],
    },
    ssr: {
        // Process pi-mcp-adapter through Vite's transform pipeline so its
        // TypeScript gets compiled properly (avoids the "stripping types unsupported
        // for node_modules" Rolldown error).
        noExternal: ["pi-mcp-adapter"],
    },
    resolve: {
        alias: {
            // Stub out glimpseui (optional peer dep of pi-mcp-adapter) so Rolldown
            // doesn't fail trying to resolve it during the build.
            glimpseui: fileURLToPath(new URL("./src/lib/server/stubs/glimpseui.ts", import.meta.url)),
            // Stub out pi-tui (CLI terminal UI) — the web app never uses it.
            // Replaces ~2.4MB of terminal rendering code + the koffi FFI addon.
            // Both the old (@mariozechner) and new (@earendil-works) npm scopes
            // are aliased since pi-mcp-adapter migrated to the new scope.
            "@mariozechner/pi-tui": fileURLToPath(new URL("./src/lib/server/stubs/pi-tui.ts", import.meta.url)),
            "@earendil-works/pi-tui": fileURLToPath(new URL("./src/lib/server/stubs/pi-tui.ts", import.meta.url)),
        },
    },
});
