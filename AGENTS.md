# Architectural Guidance

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
5. Adhere to Svelte 5 + shadcn-svelte best-practices, for a pristine codebase.
6. Make sure all types that represent the domain model, or a contract between the client and server, are placed in `src/lib/types` for import from both sides

# Code Quality

1. After completing a feature have a subagent run:
    1. `bun run lint --quiet` to check for type safety errors and code quality lints
    2. `similarity-ts` to check for code duplication that you may have introduced
    3. `bun run check` to check for bad Svelte code
   Scope all of these to only the files you've modified. Then have the subagent report back to you with a triage table of issues for you to work on.
2. Comments should only be used for two purposes:
    a) **JSDoc on functions** — to explain what a function does, what arguments it needs, and how it uses them. All functions spanning more than 4 lines must have a JSDoc comment with a description, `@param` for each parameter, and `@returns` for the return value.
    b) **Inline comments within function bodies** — to explain the "why" behind a particularly unintuitive piece of code. Keep these short: no more than 2 consecutive comment lines, and no more than 72 characters of content per line. Do not use comments to narrate what the code is doing — the code itself should be self-documenting. If you feel the need to write a long comment, consider refactoring the code instead.

    In short: **JSDoc explains the contract; inline comments explain the reasoning.**
3. When using oxlint-disable and variations thereof, **always put explanations on a single line comment prior to the disable comment**, not as part of the disable comment *or after it*. Correct format:
   ```js
   // <brief reason>
   // oxlint-disable-next-line secure-coding/<rule-name>
   <flagged code>
   ```

# Warnings

YOU ARE ABSOLUTELY BANNED FROM EVER TOUCHING GIT, ESPECIALLY GIT CHECKOUT OR RESET, WITHOUT EXPRESS PERMISSION
