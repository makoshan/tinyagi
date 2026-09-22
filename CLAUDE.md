# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install              # Install all workspace dependencies
npm run build            # TypeScript build (tsc --build, all packages in dependency order)
npm run dev              # Watch mode: concurrent rebuilds for core, teams, server, main
npm start                # Run the main queue processor (starts API server on port 3777)
```

### Individual package builds
```bash
npm run build:core       # Build @tinyagi/core only
npm run build:teams      # Build @tinyagi/teams only
npm run build:server     # Build @tinyagi/server only
npm run build:channels   # Build @tinyagi/channels only
npm run build:visualizer # Build @tinyagi/visualizer only
```

### TinyOffice (web portal)
```bash
cd tinyoffice
npm run dev              # Next.js dev server (--webpack flag)
npm run build            # Next.js production build
npm run lint             # ESLint
```

### No test suite
There is no automated test suite. Test manually via CLI commands or the web portal.

## Architecture

**TinyAGI** is a multi-agent orchestration platform. It's an npm workspaces monorepo with a separate Next.js app for the web UI.

### Monorepo packages (`packages/`)

- **core** — Shared foundation: types, config parsing, SQLite queue, agent invocation, plugin hooks, memory, scheduling. No side effects; caller owns initialization order.
- **main** — Entry point. Runs the message processing event loop, starts the API server, manages channel lifecycles, handles heartbeat scheduling.
- **server** — Hono REST API + SSE server (port 3777). 14 route modules under `src/routes/`. Provides real-time event broadcasting to web portal and channel clients.
- **teams** — Multi-agent collaboration: bracket-tag parsing (`[@agent: msg]`, `[#team: msg]`), response aggregation, chatroom routing.
- **channels** — Chat platform integrations: Discord (discord.js), Telegram (grammy), WhatsApp (whatsapp-web.js). Each runs as a subprocess.
- **cli** — Command-line interface using @clack/prompts. Daemon management, agent/team CRUD, messaging, provider config.
- **visualizer** — Ink-based TUI for team execution flow and chatroom viewing.

### Web portal (`tinyoffice/`)

Standalone Next.js 16 + React 19 + Tailwind v4 app. Communicates with the API server at `localhost:3777`. Uses Radix UI, dnd-kit (Kanban), @xyflow/react (flow diagrams), shiki (syntax highlighting).

### Package dependency order

```
core (no tinyagi deps)
  ↑
teams (depends on core)
  ↑
server (depends on core, teams)
  ↑
main (depends on core, server, teams)

channels (depends on core, runs as subprocesses)
cli (depends on core)
visualizer (depends on core types)
tinyoffice (independent, talks to server via HTTP)
```

### Data flow

1. Messages arrive from channels, CLI, API, or heartbeat → `enqueueMessage()` → SQLite `messages` table (status=pending)
2. Main loop claims pending messages per agent → runs incoming plugin hooks → spawns AI provider CLI as child process → captures response → runs outgoing hooks
3. Team responses scanned for `[@agent: msg]` tags → new messages enqueued for mentioned agents → responses aggregated when all branches complete
4. Responses inserted into `responses` table → broadcast via SSE → channel clients deliver to users

### AI provider adapters (`core/src/adapters/`)

Adapter pattern: Claude, Codex, OpenCode each implement the same interface. Custom providers supported via OpenAI/Anthropic-compatible endpoints with `base_url`.

### SQLite queue (`~/.tinyagi/tinyagi.db`)

WAL mode for concurrent access. Tables: `messages` (incoming queue), `responses` (outgoing queue), `chat_messages` (team chats), `agent_messages` (conversation history). Status transitions: pending → processing → completed/dead. Dead-letter after 5 retries.

### Bracket tag routing (`teams/src/routing.ts`)

Balanced bracket-depth matching handles nested brackets in code. `[@agent: message]` for agent DMs, `[#team: message]` for chatroom broadcasts, comma-separated `[@a,b,c: msg]` for parallel fan-out.

### Config & persistence (`~/.tinyagi/`)

- `settings.json` — All config (agents, teams, channels, providers). Auto-repaired via jsonrepair on corrupt JSON.
- `tinyagi.db` — SQLite queue database
- `pairing.json` — Sender allowlist
- `logs/` — Per-component log files
- Per-agent workspaces at `~/tinyagi-workspace/{agent_id}/` with isolated `.claude/` dirs
