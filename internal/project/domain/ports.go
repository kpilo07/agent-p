// ports.go define todos los contratos (puertos) del bounded context "project":
// tanto los puertos de salida (driven) que la lógica necesita del exterior,
// como el puerto de entrada (driving) que el exterior usa para activar la lógica.
package domain

import "context"

// ── PUERTOS DE SALIDA (driven) ────────────────────────────────────────────
// Interfaces que el service necesita; las implementaciones viven en infrastructure/.

// ProjectRepository abstrae el acceso a la persistencia de proyectos.
type ProjectRepository interface {
	CreateProject(ctx context.Context, name, path, cliCommand string) (Project, error)
	GetProject(ctx context.Context, id string) (Project, error)
	ListProjects(ctx context.Context) ([]Project, error)
	UpdateProject(ctx context.Context, p Project) error
	DeleteProject(ctx context.Context, id string) error
}

// SessionRepository abstrae el acceso al historial de sesiones de agente.
type SessionRepository interface {
	CreateSession(ctx context.Context, projectID string) (int64, error)
	EndSession(ctx context.Context, id int64) error
	// EndAllRunning marca como terminadas las sesiones huérfanas de un arranque previo.
	EndAllRunning(ctx context.Context) error
	ListSessions(ctx context.Context, projectID string) ([]Session, error)
}

// BusEvent es el mensaje que viaja por el bus de eventos hacia los clientes UI.
type BusEvent struct {
	Type      string `json:"type"`
	ProjectID string `json:"projectId,omitempty"`
	TermID    string `json:"termId,omitempty"`
	Payload   any    `json:"payload,omitempty"`
}

// EventBus permite emitir eventos de dominio hacia los suscriptores de la UI.
// La implementación concreta usa WebSockets (infrastructure/hub).
type EventBus interface {
	BroadcastProject(projectID string, evt BusEvent)
	BroadcastGlobal(evt BusEvent)
}

// GitService abstrae la vigilancia y consulta del estado de git de los proyectos.
type GitService interface {
	Watch(ctx context.Context, projectID, name, path string)
	Unwatch(projectID string)
	UnwatchAll()
	Take(ctx context.Context, path string) (*GitSnapshot, error)
	TakeFile(ctx context.Context, dir, file string) (string, error)
	// Log devuelve los últimos `limit` commits de la rama actual, cada uno con
	// sus archivos (estado + numstat) pero sin el diff textual.
	Log(ctx context.Context, path string, limit int) ([]Commit, error)
	// Head devuelve el hash completo del commit actual (HEAD). Cadena vacía si
	// el repo aún no tiene commits.
	Head(ctx context.Context, path string) (string, error)
	// LogRange devuelve los commits del rango base..head (o base..HEAD si head
	// es ""), cada uno con sus archivos. Usado para relacionar commits con un
	// ticket. Devuelve nil si base está vacío.
	LogRange(ctx context.Context, path, base, head string, limit int) ([]Commit, error)
	// CommitDiff devuelve el diff unificado completo de un commit (git show).
	CommitDiff(ctx context.Context, path, hash string) (string, error)
	// Branches lista las ramas locales, remotas y la actual.
	Branches(ctx context.Context, path string) (*GitBranches, error)
	// Checkout cambia a `branch`; si create, la crea (git checkout -b).
	Checkout(ctx context.Context, path, branch string, create bool) error
	// Grep busca contenido en el repo (git grep) y devuelve coincidencias.
	Grep(ctx context.Context, path, query string) ([]GrepMatch, error)

	// Sincronización con el remoto.
	Fetch(ctx context.Context, path string) error
	Push(ctx context.Context, path string) error
	Pull(ctx context.Context, path string) error

	// Operaciones de gobierno del repo (mutan el repo, no el código fuente
	// desde la UI: consolidan o revierten el trabajo del agente).
	// Commit consolida el trabajo. Si files está vacío, incluye todos los
	// cambios (git add -A); si no, hace un commit parcial solo de esas rutas.
	Commit(ctx context.Context, path, message string, files []string) error
	Stash(ctx context.Context, path string) error
	// Discard revierte el working tree. Si file == "" descarta todos los cambios.
	Discard(ctx context.Context, path, file string) error

	// Checkpoints: snapshots del working tree bajo refs ocultas, para revertir
	// el trabajo del agente sin tocar el historial.
	CreateCheckpoint(ctx context.Context, path, label string, auto bool) (Checkpoint, error)
	ListCheckpoints(ctx context.Context, path string) ([]Checkpoint, error)
	// RestoreCheckpoint deja el working tree idéntico al checkpoint indicado.
	RestoreCheckpoint(ctx context.Context, path, id string) error
	DeleteCheckpoint(ctx context.Context, path, id string) error
}

// ActivityRepository abstrae la persistencia del timeline de actividad.
type ActivityRepository interface {
	CreateActivity(ctx context.Context, ev ActivityEvent) (ActivityEvent, error)
	ListActivity(ctx context.Context, projectID string, limit int) ([]ActivityEvent, error)
}

// ActivityRecorder registra un evento de actividad (lo persiste y lo emite a la
// UI). Es un puerto de salida usado por el service y por los watchers.
type ActivityRecorder interface {
	Record(ctx context.Context, ev ActivityEvent)
}

// TicketRepository abstrae la persistencia de tickets.
type TicketRepository interface {
	CreateTicket(ctx context.Context, t Ticket) (Ticket, error)
	ListTickets(ctx context.Context, projectID string) ([]Ticket, error)
	GetTicket(ctx context.Context, id int64) (Ticket, error)
	UpdateTicket(ctx context.Context, t Ticket) error
	DeleteTicket(ctx context.Context, id int64) error
}

// TerminalService abstrae la gestión de pseudo-terminales (PTY) por proyecto.
type TerminalService interface {
	Start(projectID, termID, title, dir, cliCommand string) error
	Stop(projectID, termID string) error
	StopProject(projectID string) error
	StopAll()
	Write(projectID, termID string, data []byte) error
	Resize(projectID, termID string, cols, rows uint16) error
	Replay(projectID, termID string) ([]byte, bool)
	Running(projectID, termID string) bool
	ListTerminals(projectID string) []TermInfo
	SetOnSessionEnd(fn func(projectID, termID string))
	NewTermID() string
}

// FSWatcher abstrae la vigilancia del árbol de archivos de los proyectos.
type FSWatcher interface {
	Watch(ctx context.Context, projectID, root string)
	Unwatch(projectID string)
	UnwatchAll()
}

// ── PUERTO DE ENTRADA (driving) ───────────────────────────────────────────
// Interfaz que los adaptadores de entrada (HTTP, CLI…) usan para activar
// la lógica de negocio. La implementación vive en service/.

// ProjectUseCases es la fachada del bounded context "project".
type ProjectUseCases interface {
	// Proyectos
	ListProjects(ctx context.Context) ([]Project, error)
	CreateProject(ctx context.Context, name, path, cliCommand string) (Project, error)
	GetProject(ctx context.Context, id string) (Project, error)
	UpdateProject(ctx context.Context, p Project) error
	DeleteProject(ctx context.Context, id string) error

	// Ciclo de vida del agente
	StartProject(ctx context.Context, p Project) error
	StopProject(ctx context.Context, projectID string) error
	IsRunning(projectID string) bool
	InterruptAgent(projectID string) error

	// Acciones de gobierno del repo (sobre el trabajo del agente)
	// GitCommit consolida el trabajo del agente. files vacío = todos los
	// cambios; en caso contrario, commit parcial solo de esas rutas.
	GitCommit(ctx context.Context, projectID, message string, files []string) error
	GitStash(ctx context.Context, projectID string) error
	GitDiscard(ctx context.Context, projectID, file string) error

	// Checkpoints del trabajo del agente (snapshot/revert del working tree).
	CreateCheckpoint(ctx context.Context, projectID, label string) (Checkpoint, error)
	ListCheckpoints(ctx context.Context, projectID string) ([]Checkpoint, error)
	RestoreCheckpoint(ctx context.Context, projectID, id string) error
	DeleteCheckpoint(ctx context.Context, projectID, id string) error

	// Timeline de actividad
	ListActivity(ctx context.Context, projectID string, limit int) ([]ActivityEvent, error)

	// Tickets: redacción, lanzamiento al agente y seguimiento.
	ListTickets(ctx context.Context, projectID string) ([]Ticket, error)
	CreateTicket(ctx context.Context, projectID, title, body string, files []string) (Ticket, error)
	LaunchTicket(ctx context.Context, ticketID int64) (Ticket, error)
	CloseTicket(ctx context.Context, ticketID int64) (Ticket, error)
	DeleteTicket(ctx context.Context, ticketID int64) error
	// TicketCommits devuelve los commits relacionados con el ticket (rango
	// BaseCommit..HEAD, o BaseCommit..HeadCommit si está cerrado).
	TicketCommits(ctx context.Context, ticketID int64) ([]Commit, error)

	// Terminales
	ListTerminals(projectID string) []TermInfo
	// CreateTerminal abre un nuevo PTY en el proyecto. kind "agent" lanza el
	// CLICommand del proyecto (un agente adicional); cualquier otro valor abre
	// un shell.
	CreateTerminal(ctx context.Context, projectID, title, kind string) (TermInfo, error)
	CloseTerminal(ctx context.Context, projectID, termID string) error

	// Git
	GetGitSnapshot(ctx context.Context, projectPath string) (*GitSnapshot, error)
	GetFileDiff(ctx context.Context, projectPath, filePath string) (string, error)
	GetCommits(ctx context.Context, projectPath string, limit int) ([]Commit, error)
	GetCommitDiff(ctx context.Context, projectPath, hash string) (string, error)
	GetBranches(ctx context.Context, projectPath string) (*GitBranches, error)
	GitCheckout(ctx context.Context, projectID, branch string, create bool) error
	GrepRepo(ctx context.Context, projectPath, query string) ([]GrepMatch, error)
	GitFetch(ctx context.Context, projectID string) error
	GitPush(ctx context.Context, projectID string) error
	GitPull(ctx context.Context, projectID string) error

	// Árbol de archivos
	GetFileTree(ctx context.Context, projectPath string) (*TreeNode, error)
	GetFile(ctx context.Context, projectPath, filePath string) (*FileContent, error)

	// Sesiones
	ListSessions(ctx context.Context, projectID string) ([]Session, error)

	// Explorador del sistema de archivos
	BrowseFS(ctx context.Context, path string) (*FSListing, error)
}
