package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"agent-p/internal/project/domain"
)

type projectView struct {
	domain.Project
	Running bool `json:"running"`
}

func (s *Server) handleBrowseFS(w http.ResponseWriter, r *http.Request) {
	listing, err := s.uc.BrowseFS(r.Context(), r.URL.Query().Get("path"))
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			s.failMsg(w, "el path no existe o no es un directorio", http.StatusBadRequest)
			return
		}
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, listing)
}

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := s.uc.ListProjects(r.Context())
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	views := make([]projectView, 0, len(projects))
	for _, p := range projects {
		views = append(views, projectView{Project: p, Running: s.uc.IsRunning(p.ID)})
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
	p, err := s.uc.CreateProject(r.Context(), req.Name, abs, req.CLICommand)
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, projectView{Project: p})
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	if err := s.uc.DeleteProject(r.Context(), r.PathValue("id")); err != nil {
		s.failNotFound(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleStartProject(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	if err := s.uc.StartProject(r.Context(), p); err != nil && !errors.Is(err, domain.ErrAlreadyRunning) {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, projectView{Project: p, Running: true})
}

func (s *Server) handleStopProject(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	if err := s.uc.StopProject(r.Context(), p.ID); err != nil && !errors.Is(err, domain.ErrNotRunning) {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, projectView{Project: p, Running: false})
}

func (s *Server) handleListTerminals(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.uc.ListTerminals(p.ID))
}

func (s *Server) handleCreateTerminal(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	var req struct {
		Title string `json:"title"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Title == "" {
		req.Title = fmt.Sprintf("Shell %d", len(s.uc.ListTerminals(p.ID)))
	}
	term, err := s.uc.CreateTerminal(r.Context(), p.ID, req.Title)
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, term)
}

func (s *Server) handleCloseTerminal(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	termID := r.PathValue("termId")
	if termID == domain.AgentTermID {
		s.failMsg(w, "la terminal del agente se cierra deteniendo el proyecto", http.StatusBadRequest)
		return
	}
	if err := s.uc.CloseTerminal(r.Context(), p.ID, termID); err != nil && !errors.Is(err, domain.ErrNotRunning) {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleProjectDiff(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	snap, err := s.uc.GetGitSnapshot(r.Context(), p.Path)
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

func (s *Server) handleProjectSessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := s.uc.ListSessions(r.Context(), r.PathValue("id"))
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

// ── helpers ──────────────────────────────────────────────────────

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
	if errors.Is(err, domain.ErrNotFound) {
		s.failMsg(w, "proyecto no encontrado", http.StatusNotFound)
		return
	}
	s.fail(w, err, http.StatusInternalServerError)
}

func isGitRepo(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, ".git"))
	return err == nil
}
