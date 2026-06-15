package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	authdomain "agent-p/internal/auth/domain"
)

// sessionCookie es el nombre de la cookie HttpOnly que transporta el token.
const sessionCookie = "agentp_session"

// authStatusView informa al frontend de qué pantalla mostrar al cargar.
type authStatusView struct {
	NeedsSetup    bool `json:"needsSetup"`
	Authenticated bool `json:"authenticated"`
}

type credentialsReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	needsSetup, err := s.auth.NeedsSetup(r.Context())
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, authStatusView{
		NeedsSetup:    needsSetup,
		Authenticated: s.isAuthenticated(r),
	})
}

func (s *Server) handleAuthSetup(w http.ResponseWriter, r *http.Request) {
	req, ok := decodeCredentials(s, w, r)
	if !ok {
		return
	}
	sess, err := s.auth.Setup(r.Context(), req.Username, req.Password)
	if err != nil {
		s.failAuth(w, err)
		return
	}
	s.setSessionCookie(w, sess)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	req, ok := decodeCredentials(s, w, r)
	if !ok {
		return
	}
	sess, err := s.auth.Login(r.Context(), req.Username, req.Password)
	if err != nil {
		s.failAuth(w, err)
		return
	}
	s.setSessionCookie(w, sess)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		_ = s.auth.Logout(r.Context(), c.Value)
	}
	s.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

// requireAuth envuelve un handler exigiendo una sesión válida. Las peticiones
// no autenticadas reciben 401 (también las del upgrade de WebSocket, que ocurre
// dentro de next: al cortar aquí nunca se hace el upgrade).
func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.isAuthenticated(r) {
			s.failMsg(w, "no autorizado", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) isAuthenticated(r *http.Request) bool {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return false
	}
	_, err = s.auth.Authenticate(r.Context(), c.Value)
	return err == nil
}

func (s *Server) setSessionCookie(w http.ResponseWriter, sess authdomain.Session) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    sess.Token,
		Path:     "/",
		Expires:  sess.ExpiresAt,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func decodeCredentials(s *Server, w http.ResponseWriter, r *http.Request) (credentialsReq, bool) {
	var req credentialsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.failMsg(w, "invalid request body", http.StatusBadRequest)
		return credentialsReq{}, false
	}
	return req, true
}

// failAuth traduce los errores del dominio auth a códigos HTTP adecuados.
func (s *Server) failAuth(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, authdomain.ErrInvalidCredentials):
		s.failMsg(w, "incorrect username or password", http.StatusUnauthorized)
	case errors.Is(err, authdomain.ErrWeakInput):
		s.failMsg(w, "username must be at least 3 characters and password at least 8", http.StatusBadRequest)
	case errors.Is(err, authdomain.ErrSetupDone):
		s.failMsg(w, "the app already has users; sign in", http.StatusConflict)
	case errors.Is(err, authdomain.ErrUserExists):
		s.failMsg(w, "that username already exists", http.StatusConflict)
	default:
		s.fail(w, err, http.StatusInternalServerError)
	}
}
