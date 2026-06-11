# AGENT-P — Git Ops Command Center

Herramienta web **local** para seguir los cambios de Git en tiempo real mientras
agentes de IA (Claude Code, Codex, aider…) trabajan en la terminal. Soporta
múltiples proyectos abiertos simultáneamente, con notificaciones cuando un
proyecto en segundo plano sufre cambios.

Un **único binario Go** sin CGO que sirve el frontend de React embebido.

## Estructura

```
agent-p/
├── main.go                      # Orquestación: embed, wiring, ciclo de vida
├── go.mod
├── Makefile
├── internal/
│   ├── db/db.go                 # SQLite puro (modernc.org/sqlite) — proyectos y sesiones
│   ├── hub/
│   │   ├── hub.go               # Hub central de WebSockets (multi-proyecto, multi-cliente)
│   │   └── client.go            # read/write pumps por conexión
│   ├── term/manager.go          # PTY por proyecto (creack/pty), goroutine por sesión
│   ├── gitwatch/watcher.go      # Sondeo concurrente de git diff + notificaciones
│   └── server/
│       ├── server.go            # Router, SPA embebida con fallback
│       └── api.go               # API REST de proyectos
└── web/                         # Frontend (Rspack + React 19 + Tailwind v4)
    ├── rspack.config.ts         # PostCSS/Tailwind + proxy dev hacia :8089
    └── src/
        ├── store/store.ts       # Zustand: foco, activos, notificaciones, git
        ├── lib/ws.ts            # WS con reconexión; stream de terminal fuera de React
        ├── lib/api.ts           # Cliente REST
        └── components/
            ├── Sidebar.tsx      # Lista de proyectos + badges de no-leídos
            ├── TerminalPanel.tsx# xterm + fit, conmuta según proyecto en foco
            ├── DiffPanel.tsx    # Visualizador de git diff en vivo
            └── Toasts.tsx       # Alertas flotantes de proyectos en fondo
```

## Arquitectura

```
 Navegador ──── 1 WebSocket ────┐
   xterm ◄── output/replay      │        ┌── goroutine PTY  (proyecto A)
   zustand ◄── git_update       ├── HUB ─┼── goroutine PTY  (proyecto B)
   toasts ◄── notification      │        ├── goroutine git-watch (A)
   input/resize/attach ──────►  │        └── goroutine git-watch (B)
                                └── SQLite (modernc, sin CGO)
```

- **Eventos por proyecto** (`output`, `git_update`) → solo a los clientes
  suscritos (attach) a ese proyecto.
- **Eventos globales** (`notification`, `session_state`) → a todos los
  clientes; la UI muestra toast + badge solo si el proyecto está en fondo.
- La salida del PTY viaja en **base64** (puede no ser UTF-8 válido) y se
  conserva un scrollback de 256 KB que se reenvía (`replay`) al hacer attach.

## Uso

```bash
make build          # compila web/dist y el binario (CGO_ENABLED=0)
./agent-p           # http://127.0.0.1:8089
./agent-p -addr 127.0.0.1:9000 -db ~/agent-p.db -poll 1s
```

Desarrollo con HMR:

```bash
make dev-backend    # Go en :8089
make dev-frontend   # Rspack en :3000 con proxy /api y /ws
```

## Notas de seguridad

Esta herramienta expone PTYs (ejecución de comandos). Por eso:
- escucha solo en `127.0.0.1` por defecto;
- el upgrade WebSocket rechaza `Origin` no locales (anti DNS-rebinding).

No la expongas a la red sin añadir autenticación.

## Requisitos en runtime

- `git` en el PATH (para el monitoreo de diffs).
- Linux/macOS (PTY vía `creack/pty`).
