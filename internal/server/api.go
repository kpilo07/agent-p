package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"agent-p/internal/db"
	"agent-p/internal/gitwatch"
	"agent-p/internal/term"
)

type projectView struct {
	db.Project
	Running bool `json:"running"`
}

// ── Explorador de carpetas (para registrar proyectos) ───────────

type fsEntry struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	IsGitRepo bool   `json:"isGitRepo"`
}

type fsListing struct {
	Path      string    `json:"path"`
	Parent    string    `json:"parent,omitempty"`
	IsGitRepo bool      `json:"isGitRepo"`
	Entries   []fsEntry `json:"entries"`
}

// isGitRepo acepta .git como directorio (repo normal) o fichero (worktree).
func isGitRepo(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, ".git"))
	return err == nil
}

// handleBrowseFS lista los subdirectorios de un path local, marcando cuáles
// son repositorios git. Sin path, arranca en el home del usuario.
func (s *Server) handleBrowseFS(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if p == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			s.fail(w, err, http.StatusInternalServerError)
			return
		}
		p = home
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		s.fail(w, err, http.StatusBadRequest)
		return
	}
	if info, err := os.Stat(abs); err != nil || !info.IsDir() {
		s.failMsg(w, "el path no existe o no es un directorio", http.StatusBadRequest)
		return
	}

	dirents, err := os.ReadDir(abs)
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}

	listing := fsListing{Path: abs, IsGitRepo: isGitRepo(abs), Entries: []fsEntry{}}
	if parent := filepath.Dir(abs); parent != abs {
		listing.Parent = parent
	}
	for _, e := range dirents {
		// Solo directorios visibles: los ocultos (.git, .cache…) no son
		// candidatos razonables a proyecto.
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		full := filepath.Join(abs, e.Name())
		listing.Entries = append(listing.Entries, fsEntry{
			Name:      e.Name(),
			Path:      full,
			IsGitRepo: isGitRepo(full),
		})
	}
	writeJSON(w, http.StatusOK, listing)
}

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := s.store.ListProjects(r.Context())
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	views := make([]projectView, 0, len(projects))
	for _, p := range projects {
		views = append(views, projectView{Project: p, Running: s.term.Running(p.ID, term.AgentTermID)})
	}
	writeJSON(w, http.StatusOK, views)
}

type createProjectReq struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	CLICommand string `json:"cliCommand"`
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	var req createProjectReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.fail(w, err, http.StatusBadRequest)
		return
	}
	if req.Name == "" || req.Path == "" {
		s.failMsg(w, "name y path son obligatorios", http.StatusBadRequest)
		return
	}

	abs, err := filepath.Abs(req.Path)
	if err != nil {
		s.fail(w, err, http.StatusBadRequest)
		return
	}
	if info, err := os.Stat(abs); err != nil || !info.IsDir() {
		s.failMsg(w, "el path no existe o no es un directorio", http.StatusBadRequest)
		return
	}
	if !isGitRepo(abs) {
		s.failMsg(w, "el directorio no es un repositorio git", http.StatusBadRequest)
		return
	}

	p, err := s.store.CreateProject(r.Context(), req.Name, abs, req.CLICommand)
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, projectView{Project: p})
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	_ = s.stopProject(id) // best-effort: apaga PTY y watcher si estaban vivos
	if err := s.store.DeleteProject(r.Context(), id); err != nil {
		s.failNotFound(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleStartProject(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	if err := s.startProject(p); err != nil && !errors.Is(err, term.ErrAlreadyRunning) {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, projectView{Project: p, Running: true})
}

func (s *Server) handleStopProject(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	if err := s.stopProject(p.ID); err != nil && !errors.Is(err, term.ErrNotRunning) {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, projectView{Project: p, Running: false})
}

// ── Terminales adicionales ──────────────────────────────────────

func (s *Server) handleListTerminals(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.term.ListTerminals(p.ID))
}

// handleCreateTerminal abre un shell adicional (sin cli_command) en el
// directorio del proyecto.
func (s *Server) handleCreateTerminal(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}

	var req struct {
		Title string `json:"title"`
	}
	json.NewDecoder(r.Body).Decode(&req) // body opcional

	title := req.Title
	if title == "" {
		title = fmt.Sprintf("Shell %d", len(s.term.ListTerminals(p.ID)))
	}
	termID := term.NewTermID()
	if err := s.term.Start(p.ID, termID, title, p.Path, ""); err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, term.TermInfo{ID: termID, Title: title, Running: true})
}

func (s *Server) handleCloseTerminal(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	termID := r.PathValue("termId")
	if termID == term.AgentTermID {
		s.failMsg(w, "la terminal del agente se cierra deteniendo el proyecto", http.StatusBadRequest)
		return
	}
	if err := s.term.Stop(p.ID, termID); err != nil && !errors.Is(err, term.ErrNotRunning) {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleProjectDiff devuelve el snapshot bajo demanda (carga inicial de la UI).
func (s *Server) handleProjectDiff(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	snap, err := gitwatch.Take(r.Context(), p.Path)
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

func (s *Server) handleProjectSessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := s.store.ListSessions(r.Context(), r.PathValue("id"))
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

// ── helpers ─────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func (s *Server) fail(w http.ResponseWriter, err error, status int) {
	s.log.Error("api error", "err", err, "status", status)
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func (s *Server) failMsg(w http.ResponseWriter, msg string, status int) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) failNotFound(w http.ResponseWriter, err error) {
	if errors.Is(err, db.ErrNotFound) {
		s.failMsg(w, "proyecto no encontrado", http.StatusNotFound)
		return
	}
	s.fail(w, err, http.StatusInternalServerError)
}
