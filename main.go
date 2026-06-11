// agent-p — herramienta local de desarrollo para seguir cambios de Git en
// vivo mientras agentes de IA (Claude Code, Codex…) trabajan en la terminal.
//
// Binario único: el frontend de React (web/dist) viaja embebido con go:embed.
// Compilar SIEMPRE con CGO_ENABLED=0 (SQLite puro vía modernc.org/sqlite).
package main

import (
	"context"
	"embed"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"agent-p/internal/db"
	"agent-p/internal/gitwatch"
	"agent-p/internal/hub"
	"agent-p/internal/server"
	"agent-p/internal/term"
)

//go:embed all:web/dist
var embeddedFrontend embed.FS

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "fatal:", err)
		os.Exit(1)
	}
}

func run() error {
	var (
		addr     = flag.String("addr", "127.0.0.1:8089", "dirección de escucha HTTP")
		dbPath   = flag.String("db", defaultDBPath(), "ruta del fichero SQLite")
		interval = flag.Duration("poll", 2*time.Second, "intervalo de sondeo de git")
	)
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))

	if err := os.MkdirAll(filepath.Dir(*dbPath), 0o755); err != nil {
		return err
	}
	store, err := db.Open(*dbPath)
	if err != nil {
		return err
	}
	defer store.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Sesiones que quedaron "running" si el proceso anterior murió en frío.
	if err := store.EndAllRunning(ctx); err != nil {
		log.Warn("could not clean stale sessions", "err", err)
	}

	h := hub.New(log)
	go h.Run(ctx)

	manager := term.NewManager(log, h)
	watcher := gitwatch.New(log, h, *interval)

	// Sesiones de BD vivas, indexadas por proyecto.
	var sessMu sync.Mutex
	liveSessions := map[string]int64{}

	startProject := func(p db.Project) error {
		if err := manager.Start(p.ID, term.AgentTermID, "Agente", p.Path, p.CLICommand); err != nil {
			return err
		}
		watcher.Watch(ctx, p.ID, p.Name, p.Path)
		if id, err := store.CreateSession(ctx, p.ID); err == nil {
			sessMu.Lock()
			liveSessions[p.ID] = id
			sessMu.Unlock()
		} else {
			log.Warn("could not persist session", "project", p.ID, "err", err)
		}
		return nil
	}

	endDBSession := func(projectID string) {
		sessMu.Lock()
		id, ok := liveSessions[projectID]
		delete(liveSessions, projectID)
		sessMu.Unlock()
		if ok {
			if err := store.EndSession(context.WithoutCancel(ctx), id); err != nil {
				log.Warn("could not end session", "project", projectID, "err", err)
			}
		}
	}

	stopProject := func(projectID string) error {
		watcher.Unwatch(projectID)
		err := manager.StopProject(projectID)
		if errors.Is(err, term.ErrNotRunning) {
			endDBSession(projectID) // por si quedó registro huérfano
		}
		return err
	}

	// Cuando un PTY muere por sí solo (exit del agente o de un shell extra),
	// la UI ya recibe session_state; aquí solo cerramos la sesión de BD y
	// notificamos si era la terminal principal del agente.
	manager.OnSessionEnd = func(projectID, termID string) {
		if termID != term.AgentTermID {
			return
		}
		endDBSession(projectID)
		h.BroadcastGlobal(hub.Event{
			Type:      hub.EventNotification,
			ProjectID: projectID,
			Payload: map[string]any{
				"level":   "session",
				"message": "El proceso del agente ha terminado",
			},
		})
	}

	// Bombea los comandos de los clientes WS hacia el gestor de PTYs.
	go routeCommands(ctx, log, h, manager)

	dist, err := fs.Sub(embeddedFrontend, "web/dist")
	if err != nil {
		return err
	}

	srv := server.New(log, store, h, manager, watcher, startProject, stopProject)
	httpServer := &http.Server{
		Addr:    *addr,
		Handler: srv.Handler(dist),
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("agent-p listening", "url", "http://"+*addr)
		if err := httpServer.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	log.Info("shutting down…")
	manager.StopAll()
	watcher.UnwatchAll()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return httpServer.Shutdown(shutdownCtx)
}

// routeCommands enruta los mensajes entrantes del Hub hacia el PTY del
// proyecto correspondiente.
func routeCommands(ctx context.Context, log *slog.Logger, h *hub.Hub, manager *term.Manager) {
	for {
		select {
		case <-ctx.Done():
			return
		case cmd := <-h.Commands():
			// Compatibilidad: sin termId explícito se asume la del agente.
			termID := cmd.TermID
			if termID == "" {
				termID = term.AgentTermID
			}
			switch cmd.Type {
			case hub.CmdAttach:
				// Repinta el scrollback acumulado solo en el cliente que se une.
				if buf, ok := manager.Replay(cmd.ProjectID, termID); ok && len(buf) > 0 {
					cmd.Client.Send(hub.Event{
						Type:      hub.EventReplay,
						ProjectID: cmd.ProjectID,
						TermID:    termID,
						Payload:   base64.StdEncoding.EncodeToString(buf),
					})
				}
			case hub.CmdInput:
				if err := manager.Write(cmd.ProjectID, termID, []byte(cmd.Data)); err != nil &&
					!errors.Is(err, term.ErrNotRunning) {
					log.Warn("pty write failed", "project", cmd.ProjectID, "term", termID, "err", err)
				}
			case hub.CmdResize:
				if cmd.Cols > 0 && cmd.Rows > 0 {
					manager.Resize(cmd.ProjectID, termID, cmd.Cols, cmd.Rows)
				}
			}
		}
	}
}

func defaultDBPath() string {
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "agent-p", "agent-p.db")
	}
	return "agent-p.db"
}
