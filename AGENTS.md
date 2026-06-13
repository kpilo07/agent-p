# AGENTS.md — Backend

You are an expert in Go, Hexagonal Architecture, and backend development. You write idiomatic, performant, and well-structured Go code.

## Commands

- `make dev-backend` — Run the backend (serves last web/dist build on :8089)
- `make build` — Build frontend + compile final binary with embedded SPA
- `make lint` — Static analysis (`go vet ./...`)
- `make test` — Run all tests (`go test ./...`)
- `go build ./...` — Quick compile check (no output binary)

> Always compile with `CGO_ENABLED=0` — SQLite uses `modernc.org/sqlite` (pure Go, no CGO).

## Architecture — Hexagonal Backend (Bounded Context)

```
agent-p/
├── cmd/
│   └── api/
│       └── main.go                  # Composition Root — wires all adapters, no business logic
│
├── frontend.go                      # package agentspa — embeds web/dist (go:embed)
│                                    # Separate file because go:embed forbids '..' paths
│
└── internal/
    ├── platform/                    # Global technical infrastructure (reusable across contexts)
    │   └── storage/
    │       └── sqlite.go            # SQLite connection factory (WAL mode, foreign keys)
    │
    └── project/                     # BOUNDED CONTEXT: project management
        │
        ├── domain/                  # The Hexagon — pure Go, zero external dependencies
        │   ├── project.go           # Entities: Project, Session, GitSnapshot, TermInfo…
        │   ├── errors.go            # Sentinel errors: ErrNotFound, ErrAlreadyRunning…
        │   └── ports.go             # ALL port interfaces (driven + driving)
        │       │
        │       │  ── OUTPUT PORTS (driven) ──────────────────────────────
        │       │  ProjectRepository   → implemented by infrastructure/sqlite
        │       │  SessionRepository   → implemented by infrastructure/sqlite
        │       │  EventBus            → implemented by infrastructure/hub
        │       │  GitService          → implemented by infrastructure/gitwatch
        │       │  TerminalService     → implemented by infrastructure/term
        │       │  FSWatcher           → implemented by infrastructure/fswatch
        │       │
        │       └─ INPUT PORT (driving) ───────────────────────────────────
        │          ProjectUseCases    → implemented by service/ProjectService
        │
        ├── service/                 # Use cases — orchestrates output ports, no infra deps
        │   └── service.go           # ProjectService: StartProject, StopProject, GetFileTree…
        │
        └── infrastructure/          # ADAPTERS — concrete implementations
            ├── sqlite/
            │   └── repository.go    # ProjectRepository + SessionRepository → SQLite
            ├── hub/                 # EventBus → WebSocket (gorilla/websocket)
            │   ├── hub.go           # Hub: broadcast, subscriptions, command routing
            │   └── client.go        # Client: read/write pumps, ping/pong
            ├── term/
            │   └── manager.go       # TerminalService → PTY (creack/pty)
            ├── gitwatch/
            │   └── watcher.go       # GitService → git polling + diff parsing
            ├── fswatch/
            │   └── watcher.go       # FSWatcher → fsnotify
            └── http/                # Driving adapter → HTTP handlers
                ├── server.go        # Route registration + SPA fallback handler
                ├── project_handler.go
                └── tree_handler.go
```

## Key Rules

### Dependency direction
```
cmd/api → infrastructure → service → domain
                                ↑
                           ports.go (interfaces)
```
- `domain/` NEVER imports from `service/`, `infrastructure/`, or `cmd/`
- `service/` imports only from `domain/` (uses the port interfaces)
- `infrastructure/` implements port interfaces defined in `domain/`
- `cmd/api/main.go` is the only place that imports everything and wires it together

### Ports (interfaces)
All port interfaces live in `internal/project/domain/ports.go`. Adding a new external dependency means:
1. Define the interface in `ports.go`
2. Implement it in `infrastructure/<adapter>/`
3. Inject it in `cmd/api/main.go`

### Compile-time interface checks
Every adapter must include a compile-time assertion:
```go
var _ domain.ProjectRepository = (*Store)(nil)
var _ domain.TerminalService   = (*Manager)(nil)
```

### Error handling
Use sentinel errors from `domain/errors.go` and wrap with `fmt.Errorf("context: %w", err)`.
Check with `errors.Is(err, domain.ErrNotFound)` — never compare strings.

### Concurrency
- `hub.Hub` owns its state exclusively via goroutine + channels (no mutexes in the hub loop)
- `term.Manager` and `gitwatch.Watcher` protect shared state with `sync.Mutex`
- Context cancellation propagates from `cmd/api/main.go` to all long-running goroutines

### SQLite
Always use `CGO_ENABLED=0`. The DSN is built in `internal/platform/storage/sqlite.go`:
```
file:<path>?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)
```
Single writer: `db.SetMaxOpenConns(1)`.

### WebSocket protocol (hub ↔ UI)
| Direction | Message types |
|---|---|
| Server → UI | `output`, `replay`, `git_update`, `fs_change`, `notification`, `session_state` |
| UI → Server | `subscribe`, `unsubscribe`, `attach`, `detach`, `input`, `resize` |

Use `hub.Events` (EventFactory) to build outgoing events consistently.

## Docs

- Go standard library: https://pkg.go.dev/std
- gorilla/websocket: https://pkg.go.dev/github.com/gorilla/websocket
- modernc.org/sqlite: https://pkg.go.dev/modernc.org/sqlite
- fsnotify: https://pkg.go.dev/github.com/fsnotify/fsnotify
- creack/pty: https://pkg.go.dev/github.com/creack/pty
