# AGENTS.md — Frontend

You are an expert in TypeScript, React, Rspack, Zustand, and Hexagonal Architecture for frontend applications. You write maintainable, performant, and accessible code.

## Commands

- `pnpm run dev` — Start the dev server (HMR, proxy /api y /ws → localhost:8089)
- `pnpm run build` — Build the app for production (output: web/dist)
- `pnpm run preview` — Preview the production build locally

## Architecture — Hexagonal Frontend

The frontend follows **Hexagonal Architecture** (Ports & Adapters) with three layers:

```
src/
├── core/                          # The Hexagon — pure business logic, NO framework deps
│   ├── domain/                    # Entities, value objects and business rules
│   │   ├── project.ts             # Project, Session, GitSnapshot, TermInfo, TreeNode, Ticket…
│   │   ├── diff.ts                # DiffFile, DiffRow, RowKind
│   │   ├── events.ts              # ServerEvent, WsStatus, Toast, ToastLevel
│   │   └── ports/                 # OUTPUT PORTS — contracts the core needs from outside
│   │       ├── IApiRepository.ts  # HTTP contract (implemented by ApiClient)
│   │       ├── IRealtimeClient.ts # WebSocket contract (implemented by WsClient)
│   │       └── IStorage.ts        # Persistence contract (implemented by StorageService)
│   └── use-cases/                 # Application services — orchestrate ports
│       ├── ProjectService.ts      # openProject, stopProject (Singleton + Facade)
│       └── DiffService.ts         # parseDiff, statusTag (Singleton + Strategy)
│
├── infrastructure/                # ADAPTERS — concrete implementations of ports
│   ├── api/
│   │   └── ApiClient.ts           # Implements IApiRepository via fetch (Singleton)
│   ├── ws/
│   │   └── WsClient.ts            # Implements IRealtimeClient via WebSocket (Singleton + Observer)
│   ├── storage/
│   │   └── StorageService.ts      # Implements IStorage via localStorage (Singleton)
│   ├── ui/
│   │   ├── BlendyService.ts       # FLIP animations — Blendy wrapper (Singleton)
│   │   └── HighlightService.ts    # Syntax highlighting — hljs wrapper (Singleton)
│   └── store/
│       └── store.ts               # Global UI state — Zustand (bridges infra ↔ presentation)
│
└── presentation/                  # React layer — UI only, no business logic
    ├── App.tsx                    # Root: wires adapters with use-cases (composition)
    ├── assets/
    │   └── fonts/
    ├── components/
    │   ├── ui/                    # 1. Atomic — agnostic primitives, no business logic
    │   │   ├── icons.tsx
    │   │   ├── ModalShell.tsx
    │   │   ├── ModalLoader.tsx    # Suspense fallback for lazy-loaded modals
    │   │   ├── AppLoader.tsx      # Full-screen boot loader
    │   │   ├── Blendy.tsx
    │   │   └── AgentLogo.tsx
    │   ├── layout/                # 2. Visual structure
    │   │   ├── StatusBar.tsx
    │   │   ├── Toolbar.tsx
    │   │   ├── Home.tsx
    │   │   └── NodeMap.tsx
    │   └── shared/                # 3. Complex reusable components (domain-aware)
    │       ├── DiffModal.tsx
    │       ├── DiffView.tsx
    │       ├── DirBrowser.tsx
    │       ├── FileSearchModal.tsx
    │       ├── ContentSearchModal.tsx  # git grep search
    │       ├── FileViewerModal.tsx
    │       ├── ProjectsModal.tsx
    │       ├── AddProjectModal.tsx
    │       ├── CommitHistoryModal.tsx
    │       ├── ActivityModal.tsx       # Activity timeline (commit, stash, ticket…)
    │       ├── TicketModal.tsx         # Tickets: redact → launch as agent prompt → track
    │       ├── BranchSwitcher.tsx
    │       ├── SyncControl.tsx         # pull / fetch / push
    │       ├── TerminalModal.tsx
    │       ├── TerminalView.tsx        # xterm.js mount
    │       └── ErrorBoundary.tsx
    └── hooks/                     # Connect UI with infrastructure (no direct store access)
        ├── useProjects.ts
        ├── useGit.ts
        ├── useTerminals.ts
        ├── useActivity.ts
        ├── useFileTree.ts
        └── useGlobalShortcuts.ts       # Global keyboard shortcuts (see below)
```

## Keyboard shortcuts

Registered in `hooks/useGlobalShortcuts.ts`. They do not fire while focus is in an
editable field or a terminal.

| Shortcut | Action |
|---|---|
| `Ctrl/⌘ + K` | Search repository files (requires a focused project) |
| `Ctrl/⌘ + Shift + F` | Search content (`git grep`) in the repository |
| `Ctrl/⌘ + P` | Open the projects panel |
| `Ctrl/⌘ + I` | Open the tickets panel (requires a focused project) |
| `` Ctrl/⌘ + ` `` | Create and open a new terminal (requires a focused project) |

## Tickets feature

A **ticket** is a task the user redacts and injects into the agent as a prompt.
Launching a ticket starts the agent (if needed), feeds it the ticket body, and opens
its console for live tracking. Lifecycle status is `draft → launched → closed`
(`TicketStatus` in `core/domain/project.ts`, mirroring `domain.Ticket*` in Go).

- Domain type: `Ticket` in `core/domain/project.ts`
- Port methods: `listTickets`, `createTicket`, `launchTicket`, `closeTicket`,
  `deleteTicket`, `ticketCommits` in `IApiRepository`
- UI: `TicketModal.tsx` — history on the left, new-ticket editor / existing-ticket
  detail (with related `base..HEAD` commits) on the right. Files mentioned with `@`
  are attached from the repo tree.
- Store flag: `ticketsModalOpen` / `setTicketsModalOpen`

## Key Rules

### Dependency direction
```
presentation → infrastructure → core/use-cases → core/domain
```
- `core/` NEVER imports from `infrastructure/` or `presentation/`
- `infrastructure/` imports from `core/domain/` (ports) only
- `presentation/` imports from `infrastructure/` and `core/use-cases/`

### Ports (interfaces)
All output ports live in `core/domain/ports/`. When adding a new external dependency (API endpoint, browser API, third-party service), define its interface there first, then implement it in `infrastructure/`.

### Singletons
Every class in `infrastructure/` and `core/use-cases/` uses the Singleton pattern via a static `getInstance()` method. Export the instance directly:
```ts
export const apiClient = ApiClient.getInstance();
```

### State management
- `infrastructure/store/store.ts` is the **only** place Zustand lives
- Components access state through `presentation/hooks/` — never call `useStore` directly in shared/ or layout/ components
- The store re-exports domain types for stable import paths

### Atomic Design for components
| Layer | Rule |
|---|---|
| `ui/` | Zero business logic. Props only, no store access |
| `layout/` | Structural composition. May read from store via hooks |
| `shared/` | Domain-aware. Uses hooks, ports and use-cases |

## Docs

- Rspack: https://rspack.rs/llms.txt
- Zustand: https://zustand.docs.pmnd.rs/llms.txt
