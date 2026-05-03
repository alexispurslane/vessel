1. Always use the pi-coding-agent Pi Agent SDK for management of all:
    - AI sessions
    - AI messages
    - AI models and providers
    - AI tools and tool calling
    - MCP servers
    - Agentic loops
2. Always use the pi-ai library for:
    - Direct, provider-agnostic model requests (for text or structured data)
    - Usually, used for secondary model usage (for e.g. summarizing things, or generating titles and tags, in the UI)
3. Prefer putting model inference calls of all sorts (whether direct or agentic) on the backend, and then sending results and/or SSE events to the front end. This way, we don't lose AI inferencing results if the user reloads the page
4. Always prefer shadcn-provided tooltips over built-in HTML tooltips
5. This is a standard SvelteKit project using file-based routing. You should expect everything to be in the obvious place, pretty much.
6. Always use `npx eslint -no-cache -quiet` after writing something to check for errors and code quality lints, and `svelte-check` to check for bad Svelte code.
