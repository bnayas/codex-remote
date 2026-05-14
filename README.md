# Codex Remote

A durable, mobile-friendly, Tailscale-accessible remote control surface for **Codex CLI** running locally on your laptop.

The scheduling test was tested successfully.

```
Phone PWA  →  Tailscale  →  Local backend  →  node-pty  →  Codex CLI  →  Local repo
```

## Features

- **Persistent PTY sessions** — Codex keeps running when your phone disconnects
- **Live terminal streaming** — WebSocket output with automatic reconnect
- **Send input** — type and send instructions from the phone
- **Interrupt / Stop / Kill tree** — three distinct controls, all with confirmation
- **Git changed files** — live polling, per-file diff on tap, large diffs hidden by default
- **Plan editor** — save, edit, and send revised plans back to Codex
- **Quick actions** — Approve, Step 1 only, Stop & Summarize
- **Auth token** — Bearer token required on all endpoints
- **Mobile PWA** — installable, offline-capable shell, iOS/Android home screen

## Backlog

- Preserve full conversation response history in the app. Older user responses should stay visible and searchable when resuming a Codex conversation instead of being lost inside raw response history.

## Architecture

```
codex-remote/
├── backend/           # Node.js + Fastify + node-pty
│   └── src/
│       ├── index.ts           # Entry point
│       ├── config.ts          # YAML config loader
│       ├── db.ts              # SQLite + model helpers
│       ├── ptyManager.ts      # Persistent PTY session registry
│       ├── git.ts             # Git status / diff
│       ├── auth.ts            # Bearer token middleware
│       ├── routes/api.ts      # REST routes
│       └── ws/stream.ts       # WebSocket streaming
└── frontend/          # React + Vite PWA
    └── src/
        ├── App.tsx            # All screens and components
        ├── api.ts             # API client
        ├── useSessionStream.ts # WebSocket hook
        ├── types.ts           # Shared TypeScript types
        └── app.css            # Mobile-first styles
```

## Quick Start

### 1. Configure projects

```bash
# First run creates a default config:
cd backend && npm install && npm run dev
# Edit ~/.codex-remote/config.yaml
```

```yaml
authToken: your-generated-token
port: 3742
host: 100.117.114.128

notion:
  projectsDataSourceId: 3398b3ab-e085-80a7-8f33-000b6c65f8a3
  updatesDataSourceId: 33a8b3ab-e085-80e0-bfe2-000b5eb6145f
  tokenEnv: NOTION_TOKEN
  syncOnStart: true

projects:
  - id: responsa-server
    name: ResponsaServer
    repoPath: "C:\\Users\\ASUS\\source\\repos\\ResponsaServer"
    defaultCodexCommand: codex
    largeFileThresholdKb: 256

  - id: agent-dashboard
    name: Agent Dashboard
    repoPath: "/Users/bnaya/source/repos/agent-dashboard"
    defaultCodexCommand: codex
    largeFileThresholdKb: 256
```

For Notion-backed project sync, create `backend/.env` from `backend/.env.example` and set:

```bash
NOTION_TOKEN=secret_...
```

### 2. Start the backend

```bash
cd backend
npm install
npm run build
npm start
# or for dev: npm run dev
```

Output:
```
╔══════════════════════════════════════════════╗
║         Codex Remote — Backend Ready         ║
╠══════════════════════════════════════════════╣
║  HTTP/WS  : http://100.117.114.128:3742
║  Auth     : Bearer a3f9c1d2...
║  Projects : 2 configured
╚══════════════════════════════════════════════╝
```

### 3. Build and serve the frontend

```bash
cd frontend
npm install
npm run build
# Serve dist/ via any static server, e.g.:
npx serve dist -p 5173
```

Or run dev server (with proxy to backend):
```bash
npm run dev
# Available on your laptop at the printed Vite URL
```

### 4. Access from phone

1. Make sure your laptop and phone are on the same **Tailscale** network
2. Open `http://<tailscale-ip>:5173` on your phone
3. Use `http://<tailscale-ip>:3742` as the backend URL in the PWA or Android app
4. Enter your auth token
5. Add to home screen for PWA install

## Smoke Tests

Run the terminal smoke test from the backend package:

```bash
cd backend
npm run smoke:terminal
```

The test starts an isolated backend on a random local port, creates a temporary
project, opens WebSocket streams for the agent PTY and shell terminal, sends
markers through both channels, and verifies the streamed output.

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/projects` | List all projects |
| GET | `/projects/:id` | Project + sessions |
| GET | `/projects/:id/context` | Selected repo context, git status, and recent commits |
| GET | `/projects/:id/codex-conversations` | Resumable Codex conversations for this repo |
| POST | `/projects/:id/codex-conversations/:conversationId/resume` | Start a remote session with `codex resume <conversationId>` |
| POST | `/projects/sync-notion` | Sync projects from Notion |
| GET | `/sessions` | All sessions |
| GET | `/sessions/:id` | Session detail |
| POST | `/sessions` | Start new Codex session |
| POST | `/sessions/:id/input` | Send text to PTY |
| POST | `/sessions/:id/interrupt` | Send Ctrl+C |
| POST | `/sessions/:id/terminate` | Graceful stop |
| POST | `/sessions/:id/kill-tree` | Kill process tree |
| GET | `/sessions/:id/terminal?lines=N` | Scrollback |
| WS | `/sessions/:id/stream` | Live output stream |
| GET | `/sessions/:id/files` | Git changed files |
| GET | `/sessions/:id/diff` | Full repo diff |
| GET | `/sessions/:id/files/:path/diff` | Per-file diff |
| GET | `/sessions/:id/plans` | Saved plans |
| POST | `/sessions/:id/plans` | Create plan |
| PUT | `/plans/:id` | Update plan |
| POST | `/sessions/:id/send-plan` | Send plan to Codex |
| GET | `/sessions/:id/scheduled` | Pending scheduled messages |
| POST | `/sessions/:id/scheduled` | Schedule delayed input |
| DELETE | `/sessions/:id/scheduled/:messageId` | Cancel scheduled input |

### Authentication

All endpoints require:
```
Authorization: Bearer <your-token>
```

Or as query param: `?token=<your-token>` (used by WebSocket).

## WebSocket Protocol

Connect: `ws://<host>:3742/sessions/:id/stream?token=<token>`

**Server → Client:**
```json
{ "type": "connected", "sessionId": "...", "status": "running", "alive": true }
{ "type": "scrollback", "lines": ["line1", "line2"] }
{ "type": "output", "data": "terminal chunk" }
{ "type": "exit", "exitCode": 0, "status": "exited" }
{ "type": "git_status", "changedFiles": [...], "branch": "main" }
{ "type": "pong", "timestamp": "..." }
```

**Client → Server:**
```json
{ "type": "input", "text": "your command" }
{ "type": "resize", "cols": 120, "rows": 40 }
{ "type": "ping" }
```

## Session Lifecycle

1. `POST /sessions` → PTY spawned, session persisted in SQLite, terminal log at `~/.codex-remote/sessions/<id>/terminal.log`
2. Phone disconnects → PTY continues, log grows
3. Phone reconnects → WebSocket sends last 300 lines of scrollback, then resumes live
4. Process exits → status updated to `exited`/`killed`, session remains queryable
5. Backend restart → running sessions marked `unknown`, logs still readable

## Data Storage

```
~/.codex-remote/
├── config.yaml          # Projects + auth token
├── codex-remote.db      # SQLite: projects, sessions, plans, snapshots
└── sessions/
    └── <session-id>/
        ├── terminal.log   # Raw PTY output (append-only)
        └── events.jsonl   # Structured event log
```

## Process Control

Three distinct controls are intentionally separate:

| Action | Effect |
|--------|--------|
| **Interrupt** (`Ctrl+C`) | Interrupt current shell command, keep Codex alive |
| **Stop Codex** | `ptyProcess.kill()` — graceful SIGTERM |
| **Kill Tree** | `tree-kill` with SIGKILL — kills Codex + all child processes |

All three require tap-to-confirm in the UI.

## Security Notes

- Prefer binding to your Tailscale IP, for example `host: 100.117.114.128`, so the backend is exposed only on the tailnet interface
- Token is stored in `~/.codex-remote/config.yaml` — do not commit this file
- Terminal logs are kept local; never synced externally
- Large diffs are gated behind explicit user action

## Extending

The backend uses interfaces designed for runtime swapping:

```typescript
interface TerminalSession { write, interrupt, terminate, killTree, getStatus }
interface AgentRuntime { startSession(project, input?) }
interface GitInspector { getStatus(repoPath), getDiff(repoPath, filePath?) }
```

Future runtimes: `codex exec --json`, Codex SDK, Claude Code, Cursor backend.
