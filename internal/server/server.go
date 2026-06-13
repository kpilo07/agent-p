// Package server expone la API REST, el endpoint WebSocket y el frontend
// embebido (SPA) en un único http.Handler.
package server

import (
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"strings"

	"agent-p/internal/db"
	"agent-p/internal/gitwatch"
	"agent-p/internal/hub"
	"agent-p/internal/term"
)

type Server struct {
	log     *slog.Logger
	store   *db.Store
	hub     *hub.Hub
	term    *term.Manager
	watcher *gitwatch.Watcher

	// StartProject/StopProject los inyecta la orquestación (main) para que la
	// API no tenga que conocer el cableado entre PTY, watcher y sesiones BD.
	startProject func(p db.Project) error
	stopProject  func(projectID string) error
}

func New(
	log *slog.Logger,
	store *db.Store,
	h *hub.Hub,
	tm *term.Manager,
	w *gitwatch.Watcher,
	start func(p db.Project) error,
	stop func(projectID string) error,
) *Server {
	return &Server{log: log, store: store, hub: h, term: tm, watcher: w, startProject: start, stopProject: stop}
}

// Handler monta todas las rutas. dist es el frontend embebido (web/dist).
func (s *Server) Handler(dist fs.FS) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /ws", s.hub.ServeWS)

	mux.HandleFunc("GET /api/fs", s.handleBrowseFS)
	mux.HandleFunc("GET /api/projects", s.handleListProjects)
	mux.HandleFunc("POST /api/projects", s.handleCreateProject)
	mux.HandleFunc("DELETE /api/projects/{id}", s.handleDeleteProject)
	mux.HandleFunc("POST /api/projects/{id}/start", s.handleStartProject)
	mux.HandleFunc("POST /api/projects/{id}/stop", s.handleStopProject)
	mux.HandleFunc("GET /api/projects/{id}/terminals", s.handleListTerminals)
	mux.HandleFunc("POST /api/projects/{id}/terminals", s.handleCreateTerminal)
	mux.HandleFunc("DELETE /api/projects/{id}/terminals/{termId}", s.handleCloseTerminal)
	mux.HandleFunc("GET /api/projects/{id}/diff", s.handleProjectDiff)
	mux.HandleFunc("GET /api/projects/{id}/tree", s.handleProjectTree)
	mux.HandleFunc("GET /api/projects/{id}/file", s.handleProjectFile)
	mux.HandleFunc("GET /api/projects/{id}/raw", s.handleProjectRaw)
	mux.HandleFunc("GET /api/projects/{id}/file-diff", s.handleProjectFileDiff)
	mux.HandleFunc("GET /api/projects/{id}/sessions", s.handleProjectSessions)

	mux.Handle("/", spaHandler(dist))
	return mux
}

// spaHandler sirve los assets embebidos con fallback a index.html para que el
// enrutado del lado del cliente funcione en recargas y deep-links.
func spaHandler(dist fs.FS) http.Handler {
	fileServer := http.FileServerFS(dist)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		if f, err := dist.Open(p); err == nil {
			f.Close()
			// index.html no se cachea (siempre revalida y referencia los assets
			// actuales); el resto lleva hash de contenido → inmutable.
			if p == "index.html" {
				w.Header().Set("Cache-Control", "no-cache")
			} else {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			fileServer.ServeHTTP(w, r)
			return
		}
		// Fallback SPA: cualquier ruta desconocida devuelve el index.
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		f, err := dist.Open("index.html")
		if err != nil {
			http.Error(w, "frontend not embedded — run `make web`", http.StatusInternalServerError)
			return
		}
		defer f.Close()
		io.Copy(w, f)
	})
}
