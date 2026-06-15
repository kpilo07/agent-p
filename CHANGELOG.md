# Changelog

Todos los cambios notables de este proyecto se documentan aquí.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/)
y el versionado sigue [SemVer](https://semver.org/lang/es/).

## [Unreleased]

## [0.2.0] - 2026-06-15

### Añadido
- **Historial de commits**: nueva vista en el toolbar para explorar los commits
  de la rama actual, con los archivos modificados por commit y su diff completo
  bajo demanda (reutiliza el acordeón del review).
- **Favicon** con el logo de marca (sprite pixel-art).
- **Loader global de arranque**, **loader de modales diferidos** y **loader al
  abrir un archivo**: feedback inmediato mientras se descargan los chunks o se
  recupera el contenido, clave en accesos por red.

### Cambiado
- **Logo de marca unificado** (pixel-art) en login/registro, pantalla de inicio,
  nodo raíz del Mapa de nodos y pantalla de arranque.

## [0.1.0] - 2026-06-14

Primera versión pública. Binario único para Linux (amd64 y arm64) con el
frontend de React embebido.

### Añadido
- **Centro de mando de Git en tiempo real**: seguimiento de múltiples
  proyectos mientras agentes de IA (Claude Code, Codex, Gemini, Cursor,
  Aider, OpenCode…) trabajan en la terminal.
- **Mapa de nodos** (`@xyflow/react`): el repositorio como grafo interactivo,
  con animación en vivo de las rutas con cambios y reencuadre automático.
- **Terminales por proyecto** (PTY): agente + shells, anclables al tablero.
- **Operaciones de Git** desde la UI: commit, stash y discard.
- **Explorador de archivos**: árbol, búsqueda y visor con resaltado de
  sintaxis y render de Markdown.
- **Watcher de filesystem** (fsnotify) además del sondeo de git.
- **Registro de actividad** por proyecto.
- **Autenticación local**: usuarios propios en SQLite (PBKDF2-HMAC-SHA256),
  con creación del primer usuario en el arranque inicial y sesión por cookie
  `HttpOnly`.
- **Atajos de teclado**: buscar archivos (Ctrl/⌘+K), panel de proyectos
  (Ctrl/⌘+P) y nueva terminal (Ctrl/⌘+`).
- **Flag `-version`** que imprime versión, commit y fecha de build.

### Rendimiento
- **Code-splitting (lazy loading)** del frontend: la descarga inicial baja de
  ~1.3 MiB a ~0.4 MiB; las librerías pesadas se cargan bajo demanda.

[Unreleased]: https://github.com/kpilo07/agent-p/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/kpilo07/agent-p/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kpilo07/agent-p/releases/tag/v0.1.0
