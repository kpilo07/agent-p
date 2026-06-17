# agent-p — Web frontend

React + TypeScript frontend for **agent-p**, built with Rspack and structured with
Hexagonal Architecture (Ports & Adapters). It talks to the Go API over HTTP (`/api`)
and WebSocket (`/ws`).

> For architecture rules, layer boundaries and conventions, see [AGENTS.md](./AGENTS.md).

## Stack

- **React 19** + **TypeScript**
- **Rspack** (build / dev server)
- **Zustand** (UI state)
- **Tailwind CSS 4**
- **xterm.js** (terminals), **@xyflow/react** (node map), **highlight.js** (syntax), **marked** (markdown)

## Setup

Install dependencies (requires [pnpm](https://pnpm.io)):

```bash
pnpm install
```

## Development

Start the dev server — the app is served at <http://localhost:8080> and proxies
`/api` and `/ws` to the Go backend at `localhost:8089`:

```bash
pnpm run dev
```

Make sure the backend is running (see the repository root README) before opening the app.

## Build

Build for production (output: `web/dist`):

```bash
pnpm run build
```

Preview the production build locally:

```bash
pnpm run preview
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/⌘ + K` | Search repository files |
| `Ctrl/⌘ + Shift + F` | Search content (`git grep`) |
| `Ctrl/⌘ + P` | Open the projects panel |
| `Ctrl/⌘ + I` | Open the tickets panel |
| `` Ctrl/⌘ + ` `` | Open a new terminal |

## Learn more

- [Rspack documentation](https://rspack.rs)
- [Zustand documentation](https://zustand.docs.pmnd.rs)
