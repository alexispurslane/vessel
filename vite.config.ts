import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { fileURLToPath } from "url";

export default defineConfig({
    plugins: [tailwindcss(), sveltekit()],
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
        },
    },
});
