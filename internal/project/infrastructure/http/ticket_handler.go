package http

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"agent-p/internal/project/domain"
)

func (s *Server) handleListTickets(w http.ResponseWriter, r *http.Request) {
	if _, err := s.uc.GetProject(r.Context(), r.PathValue("id")); err != nil {
		s.failNotFound(w, err)
		return
	}
	tickets, err := s.uc.ListTickets(r.Context(), r.PathValue("id"))
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	if tickets == nil {
		tickets = []domain.Ticket{}
	}
	writeJSON(w, http.StatusOK, tickets)
}

type createTicketReq struct {
	Title string   `json:"title"`
	Body  string   `json:"body"`
	Files []string `json:"files"`
}

func (s *Server) handleCreateTicket(w http.ResponseWriter, r *http.Request) {
	if _, err := s.uc.GetProject(r.Context(), r.PathValue("id")); err != nil {
		s.failNotFound(w, err)
		return
	}
	var req createTicketReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.fail(w, err, http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.Title) == "" && strings.TrimSpace(req.Body) == "" {
		s.failMsg(w, "the ticket needs a title or a description", http.StatusBadRequest)
		return
	}
	t, err := s.uc.CreateTicket(r.Context(), r.PathValue("id"), req.Title, req.Body, req.Files)
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

func (s *Server) handleLaunchTicket(w http.ResponseWriter, r *http.Request) {
	id, ok := ticketID(r)
	if !ok {
		s.failMsg(w, "invalid ticket id", http.StatusBadRequest)
		return
	}
	t, err := s.uc.LaunchTicket(r.Context(), id)
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) handleCloseTicket(w http.ResponseWriter, r *http.Request) {
	id, ok := ticketID(r)
	if !ok {
		s.failMsg(w, "invalid ticket id", http.StatusBadRequest)
		return
	}
	t, err := s.uc.CloseTicket(r.Context(), id)
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) handleDeleteTicket(w http.ResponseWriter, r *http.Request) {
	id, ok := ticketID(r)
	if !ok {
		s.failMsg(w, "invalid ticket id", http.StatusBadRequest)
		return
	}
	if err := s.uc.DeleteTicket(r.Context(), id); err != nil {
		s.failNotFound(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleTicketCommits(w http.ResponseWriter, r *http.Request) {
	id, ok := ticketID(r)
	if !ok {
		s.failMsg(w, "invalid ticket id", http.StatusBadRequest)
		return
	}
	commits, err := s.uc.TicketCommits(r.Context(), id)
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	if commits == nil {
		commits = []domain.Commit{}
	}
	writeJSON(w, http.StatusOK, commits)
}

// ticketID extrae y valida el path param {tid}.
func ticketID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("tid"), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}
