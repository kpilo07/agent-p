# AGENT-P — Git Ops Command Center

Herramienta web **local** para seguir los cambios de Git en tiempo real mientras
agentes de IA (Claude Code, Codex, aider…) trabajan en la terminal. Soporta
múltiples proyectos abiertos simultáneamente, con notificaciones cuando un
proyecto en segundo plano sufre cambios.

Un **único binario Go** sin CGO que sirve el frontend de React embebido vía
`go:embed`. Backend y frontend siguen ambos **arquitectura hexagonal**
(puertos y adaptadores).

## Novedades recientes

- 🔐 **Autenticación** (contexto acotado `auth`): usuarios locales propios en
  SQLite con hashing PBKDF2-HMAC-SHA256. En el primer arranque se crea el primer
  usuario; después, login con cookie de sesión `HttpOnly`. Ver [Autenticación](#autenticación).
- 🗺️ **Mapa de nodos** (`NodeMap`, vía `@xyflow/react`): los proyectos se
  visualizan como un grafo interactivo, no solo como lista.
- 📜 **Registro de actividad** (`activity`): cada proyecto acumula un historial
  de eventos consultable desde la UI (`ActivityModal`).
- 🌳 **Explorador de archivos**: árbol de ficheros del proyecto, búsqueda
  (`FileSearchModal`) y visor con resaltado de sintaxis (`FileViewerModal`,
  vía `highlight.js`) y render de Markdown (`marked`).
- 👁️ **Watcher de filesystem** (`fswatch`, vía `fsnotify`) además del sondeo de
  git: el árbol y los diffs reaccionan a cambios en disco.
- 🎬 **Animaciones FLIP** (`blendy`) para transiciones de modales.
- 🏗️ **Refactor a arquitectura hexagonal** completa en backend y frontend, con
  contexto acotado `project` y puertos/adaptadores explícitos.
- 🔧 Toolchain: **Go 1.26**, **pnpm**, **React 19**, **Tailwind v4**, **Rspack 2**.

## Arquitectura en tiempo de ejecución

```
 Navegador ──── 1 WebSocket ────┐
   xterm ◄── output/replay      │        ┌── goroutine PTY        (proyecto A)
   zustand ◄── git_update       ├── HUB ─┼── goroutine PTY        (proyecto B)
   nodemap ◄── fs_change        │        ├── goroutine git-watch  (A)
   toasts ◄── notification      │        ├── goroutine git-watch  (B)
   input/resize/attach ──────►  │        └── goroutine fs-watch   (A, B)
                                └── SQLite (modernc, sin CGO)
```

- **Eventos por proyecto** (`output`, `git_update`, `fs_change`) → solo a los
  clientes suscritos (attach) a ese proyecto.
- **Eventos globales** (`notification`, `session_state`) → a todos los
  clientes; la UI muestra toast + badge solo si el proyecto está en fondo.
- La salida del PTY viaja en **base64** (puede no ser UTF-8 válido) y se
  conserva un scrollback que se reenvía (`replay`) al hacer attach.

### Protocolo WebSocket (hub ↔ UI)

| Dirección | Tipos de mensaje |
|---|---|
| Servidor → UI | `output`, `replay`, `git_update`, `fs_change`, `notification`, `session_state` |
| UI → Servidor | `subscribe`, `unsubscribe`, `attach`, `detach`, `input`, `resize` |

## Estructura — Backend (hexagonal)

Regla de dependencias: `cmd/api → infrastructure → service → domain`.
El dominio no importa nada de fuera; los adaptadores implementan los puertos
definidos en `domain/ports.go`.

```
agent-p/
├── cmd/api/main.go                 # Composition Root — cablea todos los adaptadores
├── frontend.go                     # package agentspa — embebe web/dist (go:embed)
├── go.mod                          # Go 1.26
├── Makefile
└── internal/
    ├── platform/storage/sqlite.go  # Factory de conexión SQLite (WAL, foreign keys)
    ├── auth/                       # CONTEXTO ACOTADO: usuarios y sesiones locales
    │   ├── domain/auth.go          # User, Session, puertos y errores
    │   ├── service/service.go      # AuthUseCases: Setup, Login, Logout, Authenticate
    │   └── infrastructure/
    │       ├── crypto/pbkdf2.go    # PasswordHasher (PBKDF2-HMAC-SHA256, stdlib)
    │       └── sqlite/repository.go # User/SessionRepository (tablas auth_*)
    └── project/                    # CONTEXTO ACOTADO: gestión de proyectos
        ├── domain/                 # El Hexágono — Go puro, sin dependencias externas
        │   ├── project.go          # Entidades: Project, Session, GitSnapshot, TermInfo…
        │   ├── errors.go           # Errores centinela: ErrNotFound, ErrAlreadyRunning…
        │   └── ports.go            # TODAS las interfaces de puertos (driven + driving)
        ├── service/service.go      # Casos de uso (ProjectService): orquesta los puertos
        └── infrastructure/         # ADAPTADORES — implementaciones concretas
            ├── sqlite/repository.go    # ProjectRepository + SessionRepository
            ├── hub/                    # EventBus → WebSocket (gorilla/websocket)
            │   ├── hub.go              # broadcast, suscripciones, ruteo de comandos
            │   └── client.go           # bombas read/write, ping/pong
            ├── term/manager.go         # TerminalService → PTY (creack/pty)
            ├── gitwatch/watcher.go     # GitService → sondeo de git + parseo de diff
            ├── fswatch/watcher.go      # FSWatcher → fsnotify
            ├── activity/recorder.go    # Registro de actividad por proyecto
            └── http/                   # Adaptador driving → handlers HTTP
                ├── server.go           # Rutas + middleware de auth + fallback SPA
                ├── project_handler.go
                ├── auth_handler.go     # /api/auth/* + requireAuth (cookie de sesión)
                └── tree_handler.go     # Árbol de archivos / lectura de ficheros
```

## Estructura — Frontend (hexagonal)

Regla de dependencias: `presentation → infrastructure → core/use-cases → core/domain`.
El `core/` nunca importa de `infrastructure/` ni `presentation/`. Los servicios de
`infrastructure/` y `core/use-cases/` son **Singletons** (`getInstance()`).

```
web/                                # Rspack 2 + React 19 + Tailwind v4
├── rspack.config.ts                # PostCSS/Tailwind + proxy dev hacia :8089
└── src/
    ├── core/                       # El Hexágono — lógica pura, sin framework
    │   ├── domain/                 # Entidades y reglas
    │   │   ├── project.ts          # Project, Session, GitSnapshot, TreeNode…
    │   │   ├── diff.ts             # DiffFile, DiffRow, RowKind
    │   │   ├── events.ts           # ServerEvent, WsStatus, Toast…
    │   │   └── ports/              # PUERTOS DE SALIDA (contratos)
    │   │       ├── IApiRepository.ts
    │   │       ├── IRealtimeClient.ts
    │   │       └── IStorage.ts
    │   └── use-cases/              # Servicios de aplicación
    │       ├── ProjectService.ts
    │       └── DiffService.ts
    ├── infrastructure/             # ADAPTADORES de los puertos
    │   ├── api/ApiClient.ts        # IApiRepository vía fetch
    │   ├── ws/WsClient.ts          # IRealtimeClient vía WebSocket (Observer)
    │   ├── storage/StorageService.ts  # IStorage vía localStorage
    │   ├── ui/BlendyService.ts     # Animaciones FLIP (blendy)
    │   ├── ui/HighlightService.ts  # Resaltado de sintaxis (highlight.js)
    │   └── store/store.ts          # Estado global UI — Zustand (único lugar)
    └── presentation/               # Capa React — solo UI
        ├── App.tsx                 # Raíz: AuthGate (setup/login/app) + cableado
        ├── components/
        │   ├── ui/                 # Atómicos: icons, ModalShell, Blendy, AgentLogo
        │   ├── auth/AuthScreen.tsx # Pantalla de setup (primer usuario) y de login
        │   ├── layout/             # StatusBar (incl. botón SALIR), Toolbar, Home, NodeMap
        │   └── shared/             # DiffModal/View, TerminalModal/View, ActivityModal,
        │                           # FileSearchModal, FileViewerModal, DirBrowser,
        │                           # ProjectsModal, AddProjectModal
        └── hooks/                  # Puente UI ↔ infra (sin acceso directo al store)
            ├── useProjects.ts  useGit.ts  useTerminals.ts
            ├── useFileTree.ts   useActivity.ts
```

## Uso

```bash
make build          # compila web/dist (pnpm) y el binario (CGO_ENABLED=0)
./agent-p           # http://127.0.0.1:8089
./agent-p -addr 127.0.0.1:9000 -db ~/agent-p.db -poll 1s
```

Desarrollo con HMR:

```bash
make dev-backend    # Go en :8089 (sirve el último build de web/dist)
make dev-frontend   # Rspack en :3000 con proxy /api y /ws hacia :8089
```

Otros targets:

```bash
make lint           # go vet ./...
make test           # go test ./... (CGO_ENABLED=0)
make clean          # elimina binario y web/dist
```

## Autenticación

agent-p protege la UI con un **módulo de usuarios propio** (contexto acotado
`auth`), no con credenciales del sistema operativo: PAM exigiría CGO —incompatible
con el binario único `CGO_ENABLED=0`— y no encaja con un servidor TCP local.

- **Primer arranque:** si no existe ningún usuario, la app muestra la pantalla
  «Crear primer usuario» (será el administrador).
- **Después:** pantalla de login. La sesión viaja en una cookie `HttpOnly` +
  `SameSite=Lax` (caducidad 7 días) y se limpia con el botón **SALIR**.
- **Contraseñas:** hash **PBKDF2-HMAC-SHA256** (600 000 iteraciones, salt
  aleatorio) vía `crypto/pbkdf2` de la stdlib — sin dependencias externas ni CGO.
- **Persistencia:** tablas `auth_users` y `auth_sessions` en el mismo SQLite.

Protección de rutas (en `infrastructure/http`):

| Ruta | Acceso |
|---|---|
| `GET /api/auth/status` | público — decide qué pantalla mostrar |
| `POST /api/auth/setup` | público — solo si aún no hay usuarios |
| `POST /api/auth/login` · `POST /api/auth/logout` | público |
| `GET /ws` y el resto de `/api/*` | **requiere sesión** (`requireAuth`) |
| assets de la SPA | público — para poder servir la pantalla de login |

```bash
# Comprobar el estado de autenticación
curl -s http://127.0.0.1:8089/api/auth/status
# → {"needsSetup":true,"authenticated":false}   (primer arranque)
```

## Notas de seguridad

Esta herramienta expone PTYs (ejecución de comandos). Por eso:
- escucha solo en `127.0.0.1` por defecto;
- el upgrade WebSocket rechaza `Origin` no locales (anti DNS-rebinding);
- el acceso a la UI exige autenticación (ver [Autenticación](#autenticación)).

Si la expones en red, sirve detrás de **TLS** y marca la cookie como `Secure`:
al ser HTTP local la cookie de sesión viaja sin cifrar, lo cual es aceptable
solo en `127.0.0.1`.

## Requisitos en runtime

- `git` en el PATH (para el monitoreo de diffs).
- Linux/macOS (PTY vía `creack/pty`).

## Stack

- **Backend:** Go 1.26 · gorilla/websocket · creack/pty · fsnotify ·
  modernc.org/sqlite (SQLite puro, sin CGO).
- **Frontend:** React 19 · Rspack 2 · Tailwind v4 · Zustand 5 · @xyflow/react
  (mapa de nodos) · xterm.js · highlight.js · marked · blendy.
- **Tooling:** pnpm.
