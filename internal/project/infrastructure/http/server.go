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

	authdomain "agent-p/internal/auth/domain"
	"agent-p/internal/project/domain"
	"agent-p/internal/project/infrastructure/hub"
)

// Server es el adaptador HTTP. Recibe los casos de uso por inyección.
type Server struct {
	log  *slog.Logger
	uc   domain.ProjectUseCases
	auth authdomain.AuthUseCases
	hub  *hub.Hub
}

// New construye el adaptador HTTP.
func New(log *slog.Logger, uc domain.ProjectUseCases, auth authdomain.AuthUseCases, h *hub.Hub) *Server {
	return &Server{log: log, uc: uc, auth: auth, hub: h}
}

// Handler monta todas las rutas. dist es el frontend embebido (web/dist).
//
// Estructura de seguridad:
//   - /api/auth/* → públicas (status, setup, login, logout).
//   - /ws y el resto de /api/* → protegidas por requireAuth (cookie de sesión).
//   - assets de la SPA → públicos, para poder servir la pantalla de login.
func (s *Server) Handler(dist fs.FS) http.Handler {
	mux := http.NewServeMux()

	// Endpoints de autenticación (públicos). Patrones más específicos que
	// "/api/" → el ServeMux les da precedencia sobre el grupo protegido.
	mux.HandleFunc("GET /api/auth/status", s.handleAuthStatus)
	mux.HandleFunc("POST /api/auth/setup", s.handleAuthSetup)
	mux.HandleFunc("POST /api/auth/login", s.handleAuthLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleAuthLogout)

	// Grupo protegido: WebSocket + toda la API de proyectos.
	protected := http.NewServeMux()
	protected.HandleFunc("GET /ws", s.hub.ServeWS)
	protected.HandleFunc("GET /api/fs", s.handleBrowseFS)
	protected.HandleFunc("GET /api/projects", s.handleListProjects)
	protected.HandleFunc("POST /api/projects", s.handleCreateProject)
	protected.HandleFunc("DELETE /api/projects/{id}", s.handleDeleteProject)
	protected.HandleFunc("POST /api/projects/{id}/start", s.handleStartProject)
	protected.HandleFunc("POST /api/projects/{id}/stop", s.handleStopProject)
	protected.HandleFunc("POST /api/projects/{id}/interrupt", s.handleInterruptProject)
	protected.HandleFunc("POST /api/projects/{id}/git/commit", s.handleGitCommit)
	protected.HandleFunc("POST /api/projects/{id}/git/stash", s.handleGitStash)
	protected.HandleFunc("POST /api/projects/{id}/git/discard", s.handleGitDiscard)
	protected.HandleFunc("GET /api/projects/{id}/terminals", s.handleListTerminals)
	protected.HandleFunc("POST /api/projects/{id}/terminals", s.handleCreateTerminal)
	protected.HandleFunc("DELETE /api/projects/{id}/terminals/{termId}", s.handleCloseTerminal)
	protected.HandleFunc("GET /api/projects/{id}/diff", s.handleProjectDiff)
	protected.HandleFunc("GET /api/projects/{id}/commits", s.handleProjectCommits)
	protected.HandleFunc("GET /api/projects/{id}/commit", s.handleProjectCommitDiff)
	protected.HandleFunc("GET /api/projects/{id}/branches", s.handleProjectBranches)
	protected.HandleFunc("POST /api/projects/{id}/git/checkout", s.handleGitCheckout)
	protected.HandleFunc("GET /api/projects/{id}/tree", s.handleProjectTree)
	protected.HandleFunc("GET /api/projects/{id}/file", s.handleProjectFile)
	protected.HandleFunc("GET /api/projects/{id}/raw", s.handleProjectRaw)
	protected.HandleFunc("GET /api/projects/{id}/file-diff", s.handleProjectFileDiff)
	protected.HandleFunc("GET /api/projects/{id}/sessions", s.handleProjectSessions)
	protected.HandleFunc("GET /api/projects/{id}/activity", s.handleProjectActivity)

	guarded := s.requireAuth(protected)
	mux.Handle("/api/", guarded)
	mux.Handle("/ws", guarded)

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
