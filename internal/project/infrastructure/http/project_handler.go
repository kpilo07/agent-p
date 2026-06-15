package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

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

func (s *Server) handleProjectCommits(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	limit := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		limit, _ = strconv.Atoi(v)
	}
	commits, err := s.uc.GetCommits(r.Context(), p.Path, limit)
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, commits)
}

func (s *Server) handleProjectCommitDiff(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	hash := r.URL.Query().Get("hash")
	if !isValidCommitHash(hash) {
		s.failMsg(w, "hash de commit inválido", http.StatusBadRequest)
		return
	}
	diff, err := s.uc.GetCommitDiff(r.Context(), p.Path, hash)
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"hash": hash, "diff": diff})
}

func (s *Server) handleProjectBranches(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	branches, err := s.uc.GetBranches(r.Context(), p.Path)
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, branches)
}

func (s *Server) handleGitCheckout(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	var req struct {
		Branch string `json:"branch"`
		Create bool   `json:"create"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if !isValidBranchName(req.Branch) {
		s.failMsg(w, "nombre de rama inválido", http.StatusBadRequest)
		return
	}
	if err := s.uc.GitCheckout(r.Context(), p.ID, req.Branch, req.Create); err != nil {
		// El fallo típico es un working tree con cambios que se sobreescribirían:
		// 409 + el mensaje de git para que la UI lo muestre tal cual.
		s.fail(w, err, http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// isValidBranchName aplica una validación pragmática de las reglas de refs de
// git. Clave de seguridad: rechaza el guion inicial para que el nombre no se
// interprete como flag en `git checkout`.
func isValidBranchName(b string) bool {
	if b == "" || len(b) > 255 {
		return false
	}
	if strings.HasPrefix(b, "-") || strings.HasPrefix(b, "/") || strings.HasSuffix(b, "/") ||
		strings.HasSuffix(b, ".lock") || strings.Contains(b, "..") || strings.Contains(b, "@{") {
		return false
	}
	for _, c := range b {
		if c <= 0x20 || c == 0x7f { // control y espacio
			return false
		}
		switch c {
		case '~', '^', ':', '?', '*', '[', '\\':
			return false
		}
	}
	return true
}

// isValidCommitHash acepta solo hex (4–64 chars): evita inyectar flags/refs
// arbitrarios en `git show`.
func isValidCommitHash(h string) bool {
	if len(h) < 4 || len(h) > 64 {
		return false
	}
	for _, c := range h {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

func (s *Server) handleInterruptProject(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	if err := s.uc.InterruptAgent(p.ID); err != nil {
		if errors.Is(err, domain.ErrNotRunning) {
			s.failMsg(w, "el agente no está en ejecución", http.StatusConflict)
			return
		}
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGitCommit(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	var req struct {
		Message string `json:"message"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Message == "" {
		s.failMsg(w, "el mensaje de commit es obligatorio", http.StatusBadRequest)
		return
	}
	if err := s.uc.GitCommit(r.Context(), p.ID, req.Message); err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGitStash(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	if err := s.uc.GitStash(r.Context(), p.ID); err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGitDiscard(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	var req struct {
		Path string `json:"path"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if err := s.uc.GitDiscard(r.Context(), p.ID, req.Path); err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleProjectActivity(w http.ResponseWriter, r *http.Request) {
	limit := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		limit, _ = strconv.Atoi(v)
	}
	events, err := s.uc.ListActivity(r.Context(), r.PathValue("id"), limit)
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, events)
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
