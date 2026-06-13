// agent-p — herramienta local de desarrollo para seguir cambios de Git en
// vivo mientras agentes de IA (Claude Code, Codex…) trabajan en la terminal.
//
// cmd/api/main.go es el COMPOSITION ROOT: instancia todos los adaptadores e inyecta
// las dependencias. No contiene lógica de negocio; solo cableado.
//
// Compilar SIEMPRE con CGO_ENABLED=0 (SQLite puro vía modernc.org/sqlite).
package main

import (
	"context"
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
	"syscall"
	"time"

	agentspa "agent-p"
	"agent-p/internal/project/domain"
	"agent-p/internal/project/infrastructure/fswatch"
	"agent-p/internal/project/infrastructure/gitwatch"
	"agent-p/internal/project/infrastructure/hub"
	httpadapter "agent-p/internal/project/infrastructure/http"
	"agent-p/internal/project/infrastructure/sqlite"
	termadapter "agent-p/internal/project/infrastructure/term"
	"agent-p/internal/project/service"
)

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

	// ── Adaptadores driven (infraestructura de salida) ───────────

	if err := os.MkdirAll(filepath.Dir(*dbPath), 0o755); err != nil {
		return err
	}
	store, err := sqlite.Open(*dbPath)
	if err != nil {
		return err
	}
	defer store.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	h := hub.New(log)
	go h.Run(ctx)

	manager := termadapter.New(log, h)
	gitWatcher := gitwatch.New(log, h, *interval)
	fsWatcher := fswatch.New(log, h)

	// ── Capa de servicio (casos de uso del bounded context) ──────

	svc := service.New(store, store, gitWatcher, manager, fsWatcher, h)

	// Limpiar sesiones huérfanas del arranque anterior.
	if err := svc.InitSessions(ctx); err != nil {
		log.Warn("could not clean stale sessions", "err", err)
	}

	// Cuando un PTY termina por sí solo, cerramos la sesión en BD.
	manager.SetOnSessionEnd(func(projectID, termID string) {
		if termID != domain.AgentTermID {
			return
		}
		svc.EndDBSession(ctx, projectID)
		h.BroadcastGlobalEvent(hub.Events.Notification(projectID, map[string]any{
			"level":   "session",
			"message": "El proceso del agente ha terminado",
		}))
	})

	// Bombea los comandos WS hacia el gestor de PTYs.
	go routeCommands(ctx, log, h, manager)

	// ── Adaptador driving (HTTP) ─────────────────────────────────

	dist, err := fs.Sub(agentspa.Frontend, "web/dist")
	if err != nil {
		return err
	}

	srv := httpadapter.New(log, svc, h)
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
	gitWatcher.UnwatchAll()
	fsWatcher.UnwatchAll()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return httpServer.Shutdown(shutdownCtx)
}

// routeCommands enruta los mensajes WS del Hub hacia el gestor de PTYs.
func routeCommands(ctx context.Context, log *slog.Logger, h *hub.Hub, manager *termadapter.Manager) {
	for {
		select {
		case <-ctx.Done():
			return
		case cmd := <-h.Commands():
			termID := cmd.TermID
			if termID == "" {
				termID = domain.AgentTermID
			}
			switch cmd.Type {
			case hub.CmdAttach:
				if buf, ok := manager.Replay(cmd.ProjectID, termID); ok && len(buf) > 0 {
					cmd.Client.Send(hub.Events.Replay(cmd.ProjectID, termID, base64.StdEncoding.EncodeToString(buf)))
				}
			case hub.CmdInput:
				if err := manager.Write(cmd.ProjectID, termID, []byte(cmd.Data)); err != nil &&
					!errors.Is(err, domain.ErrNotRunning) {
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
