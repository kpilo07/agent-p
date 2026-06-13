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
│   │   ├── project.ts             # Project, Session, GitSnapshot, TermInfo, TreeNode…
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
    │       ├── FileViewerModal.tsx
    │       ├── ProjectsModal.tsx
    │       ├── AddProjectModal.tsx
    │       └── TerminalModal.tsx
    └── hooks/                     # Connect UI with infrastructure (no direct store access)
        ├── useProjects.ts
        ├── useGit.ts
        ├── useTerminals.ts
        └── useFileTree.ts
```

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
