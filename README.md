# Vessel

A powerful and private AI chat application with a built-in coding agent, real-time streaming, and sandbox-isolated tool execution. Built with SvelteKit, Bun, and [pi](https://github.com/mariozechner/pi).

![Vessel](vessel.png)

## Features

- **Multi-provider LLM support**: OpenAI, Anthropic, Google, Mistral, Groq, xAI, OpenRouter, Ollama, LM Studio, vLLM, and any OpenAI-compatible endpoint
- **Coding agent**: powered by [pi-coding-agent](https://github.com/mariozechner/pi): bash execution, file read/write/edit, web fetch, and web search, all inside a [zerobox](https://github.com/nicobailon/zerobox) sandbox
- **Per-conversation sandboxing**: configurable filesystem isolation, network allowlists, secrets management, and per-conversation overrides
- **Streaming responses**: real-time SSE streaming with thinking/reasoning display, tool execution progress, and fetched-source panels
- **Conversation management**: tags, pinning, archiving, forking, message editing, and branch navigation (message DAG)
- **MCP server support**: configure Model Context Protocol servers per-conversation for extended tooling
- **Authentication**: single-user setup with bcrypt password hashing and JWT sessions
- **Export**: conversations can be exported as Markdown or PDF
- **Dark mode**: full dark/light theme support via [mode-watcher](https://mode-watcher.pages.dev/)
- **Keyboard-first**: comprehensive keyboard shortcuts for power users

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [SvelteKit](https://svelte.dev/docs/kit) (Svelte 5, runes mode) |
| Runtime | [Bun](https://bun.sh/) (including `bun:sqlite` for the database) |
| UI Components | [shadcn-svelte](https://next.shadcn-svelte.com/) (Vega style), [bits-ui](https://bits-ui.com/), [paneforge](https://paneforge.com/) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/), [tw-animate-css](https://github.com/brennerexe/tw-animate-css) |
| Markdown Rendering | [svelte-streamdown](https://github.com/nicobailon/svelte-streamdown) (with math, Mermaid, and code highlighting) |
| AI Engine | [pi-coding-agent](https://github.com/mariozechner/pi), [pi-ai](https://github.com/mariozechner/pi), [pi-agent-core](https://github.com/mariozechner/pi) |
| MCP | [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) |
| Sandbox | [zerobox](https://github.com/nicobailon/zerobox) |
| Icons | [Lucide](https://lucide.dev/) |
| Linting | [OxLint](https://oxc.rs/docs/guide/usage/linter.html) with security, JSDoc, and SonarJS plugins |
| Fonts | Inter Variable, Merriweather Variable |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) ≥ 1.2

### Installation

```sh
git clone https://github.com/alexispurslane/vessel.git
cd vessel
bun install
```

### Development

```sh
bun run dev
```

The `dev` script uses `bun --bun vite dev` to run Vite with Bun's runtime instead of Node.js. This is required because Vessel uses `bun:sqlite` for its database.

### Production Build

```sh
bun run build
bun run preview
```

### Other Commands

| Command | Description |
|---|---|
| `bun run check` | Run `svelte-check` for type and Svelte correctness |
| `bun run lint` | Run OxLint (includes security, JSDoc, SonarJS rules) |
| `bun run lint:fix` | Auto-fix lint issues |
| `bun run format` | Format with Prettier |

## Project Structure

```
src/
├── lib/
│   ├── server/
│   │   ├── agent/        # Session lifecycle, tools, sandbox, MCP, model registry
│   │   ├── auth/         # bcrypt + JWT authentication
│   │   ├── db/           # SQLite schema and migrations
│   │   ├── export/       # Markdown and PDF exporters
│   │   ├── inference/    # LLM provider API helpers
│   │   └── fs-security.ts # Path sanitization / traversal prevention
│   ├── components/
│   │   ├── chat/         # Message rendering, input, tool calls, code blocks
│   │   ├── sidebar/      # Conversation list
│   │   ├── conversation-settings/ # Per-conversation config panels
│   │   ├── page-layout/  # App shell / layout
│   │   ├── shortcuts-help/
│   │   └── ui/           # shadcn-svelte primitives (40+ components)
│   ├── stores/           # Svelte 5 reactive stores (auth, chat, conversations, settings, notifications)
│   ├── hooks/            # is-mobile detector
│   ├── utils/            # Code block rendering, keyboard shortcuts, math preprocessing
│   ├── api.ts            # Client-side API functions for all backend endpoints
│   ├── providers.ts      # Provider config registry (13 built-in providers)
│   ├── types.ts          # Shared domain types
│   └── utils.ts          # General utility functions
├── routes/
│   ├── api/              # REST API endpoints (auth, sessions, models, providers, MCP, tags, settings, fs-complete)
│   ├── chat/[id]/        # Chat view per conversation
│   ├── login/            # Login page
│   ├── setup/            # First-run setup (create user)
│   ├── settings/         # Settings tabs (Agent, Models, Notifications, Sandbox, Tools, User)
│   └── tags/             # Tag management page
├── hooks.server.ts       # Auth middleware, rate limiting, route protection
└── app.css               # Tailwind + theme tokens (light/dark)
```

## Architecture

Vessel is a **monolithic SvelteKit app** where the server handles all AI inference and tool execution. Model API calls happen in the main process (not inside the sandbox), while agent tool execution (bash, read, write, etc.) runs inside a zerobox sandbox with configurable filesystem and network restrictions.

Conversations are persisted as pi `.jsonl` session files under `data/sessions/`, with metadata and settings stored in a SQLite database (`data/vessel.db`). Active sessions are kept in memory with SSE subscriptions for real-time streaming to clients.

## License

This project is licensed under the [0BSD](LICENSE).
