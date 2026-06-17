# Changelog

Todos los cambios notables de este proyecto se documentan aquí.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/)
y el versionado sigue [SemVer](https://semver.org/lang/es/).

## [Unreleased]

## [0.4.0] - 2026-06-16

### Añadido
- **Gestor de tickets**: crea tickets con título, descripción y archivos
  asociados; lánzalos (o relánzalos) al agente, ciérralos y consulta los
  commits relacionados con cada ticket (rango base..HEAD). Accesible desde el
  toolbar.
- **Commits granulares**: en el panel de review puedes elegir qué archivos
  entran en el commit (checkbox por archivo y selector de "todos"), para
  repartir el trabajo en varios commits. Por defecto entran todos; el commit
  parcial usa `git commit -- <rutas>` y deja el resto en el working tree.
- **Iconos por tipo de archivo** en el Mapa de nodos: html, css, js/ts, php,
  json, imágenes, markdown… cada extensión con su icono y color de lenguaje.
  Los archivos con cambios conservan el color de estado de git.
- **Vista previa de HTML** renderizado en el visor de archivos (iframe en
  sandbox), junto a la ya existente de Markdown.
- **Rutas en la URL** (React Router): el proyecto abierto se refleja en
  `/p/:id`, así al recargar o compartir el enlace se conserva la vista (antes la
  recarga volvía siempre a la lista de proyectos). Atrás/adelante del navegador
  funcionan.

### Corregido
- **Congelamiento al cerrar un modal**: si la animación de cierre se interrumpía
  (al abrir otro modal) o la pestaña estaba en segundo plano, el overlay quedaba
  capturando los clics y la app parecía colgada. Ahora el desmontaje está
  garantizado (red de seguridad por tiempo) y el fondo en cierre no bloquea la
  interacción.

## [0.3.0] - 2026-06-15

### Añadido
- **Cambio de rama** desde el StatusBar: selector con las ramas locales y
  remotas, marca de la rama actual y creación de ramas nuevas (`checkout -b`).
- **Sincronización con el remoto**: botones Fetch / Pull / Push e indicador
  *ahead/behind* (↑/↓) junto a la rama. El primer push crea el upstream; el
  pull es *fast-forward only* para no introducir merges sorpresa.
- **Búsqueda de contenido** (find in files) con `git grep`: resultados por
  archivo y línea, accesible con `Ctrl/⌘+Shift+F` o desde el toolbar.

### Cambiado
- **Toda la interfaz pasa a inglés** (textos, placeholders, toasts y mensajes
  de error del backend que se muestran al usuario).

### Corregido
- **Texto de las notificaciones ilegible** sobre el fondo negro: se fuerza el
  color neutro de la app (Sileo inyecta su CSS en runtime, de ahí el override
  con `!important`).

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

[Unreleased]: https://github.com/kpilo07/agent-p/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/kpilo07/agent-p/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kpilo07/agent-p/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kpilo07/agent-p/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kpilo07/agent-p/releases/tag/v0.1.0
