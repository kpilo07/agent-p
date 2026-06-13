// Package http implementa el adaptador de entrada (driving adapter) que expone
// la API REST, el endpoint WebSocket y el frontend embebido (SPA).
// Los handlers solo conocen domain.ProjectUseCases; nunca el service concreto.
package http

import (
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"strings"

	"agent-p/internal/project/domain"
	"agent-p/internal/project/infrastructure/hub"
)

// Server es el adaptador HTTP. Recibe los casos de uso por inyección.
type Server struct {
	log *slog.Logger
	uc  domain.ProjectUseCases
	hub *hub.Hub
}

// New construye el adaptador HTTP.
func New(log *slog.Logger, uc domain.ProjectUseCases, h *hub.Hub) *Server {
	return &Server{log: log, uc: uc, hub: h}
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

// spaHandler sirve los assets embebidos con fallback a index.html.
func spaHandler(dist fs.FS) http.Handler {
	fileServer := http.FileServerFS(dist)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		if f, err := dist.Open(p); err == nil {
			f.Close()
			if p == "index.html" {
				w.Header().Set("Cache-Control", "no-cache")
			} else {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			fileServer.ServeHTTP(w, r)
			return
		}
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
