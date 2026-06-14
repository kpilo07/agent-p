// Package service implementa los casos de uso del bounded context "auth"
// (domain.AuthUseCases). No conoce ni HTTP ni SQLite: solo orquesta los puertos.
package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"agent-p/internal/auth/domain"
)

const (
	minUsernameLen = 3
	minPasswordLen = 8
	maxInputLen    = 256
	// sessionTTL es la duración de una sesión emitida.
	sessionTTL = 7 * 24 * time.Hour
)

// Service implementa domain.AuthUseCases.
type Service struct {
	users    domain.UserRepository
	sessions domain.SessionRepository
	hasher   domain.PasswordHasher
}

// New construye el servicio con sus dependencias (puertos de salida).
func New(users domain.UserRepository, sessions domain.SessionRepository, hasher domain.PasswordHasher) *Service {
	return &Service{users: users, sessions: sessions, hasher: hasher}
}

func (s *Service) NeedsSetup(ctx context.Context) (bool, error) {
	n, err := s.users.CountUsers(ctx)
	if err != nil {
		return false, err
	}
	return n == 0, nil
}

func (s *Service) Setup(ctx context.Context, username, password string) (domain.Session, error) {
	n, err := s.users.CountUsers(ctx)
	if err != nil {
		return domain.Session{}, err
	}
	if n > 0 {
		return domain.Session{}, domain.ErrSetupDone
	}
	return s.createUserAndSession(ctx, username, password)
}

func (s *Service) Login(ctx context.Context, username, password string) (domain.Session, error) {
	user, err := s.users.GetUserByUsername(ctx, strings.TrimSpace(username))
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return domain.Session{}, domain.ErrInvalidCredentials
		}
		return domain.Session{}, err
	}
	if !s.hasher.Compare(user.PasswordHash, password) {
		return domain.Session{}, domain.ErrInvalidCredentials
	}
	return s.issueSession(ctx, user.ID)
}

func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	return s.sessions.DeleteSession(ctx, token)
}

func (s *Service) Authenticate(ctx context.Context, token string) (domain.User, error) {
	if token == "" {
		return domain.User{}, domain.ErrUnauthorized
	}
	sess, err := s.sessions.GetSession(ctx, token)
	if err != nil {
		return domain.User{}, domain.ErrUnauthorized
	}
	if time.Now().After(sess.ExpiresAt) {
		_ = s.sessions.DeleteSession(ctx, token)
		return domain.User{}, domain.ErrUnauthorized
	}
	user, err := s.users.GetUserByID(ctx, sess.UserID)
	if err != nil {
		return domain.User{}, domain.ErrUnauthorized
	}
	return user, nil
}

// createUserAndSession valida la entrada, persiste el usuario y emite sesión.
func (s *Service) createUserAndSession(ctx context.Context, username, password string) (domain.Session, error) {
	username = strings.TrimSpace(username)
	if err := validateCredentials(username, password); err != nil {
		return domain.Session{}, err
	}
	hash, err := s.hasher.Hash(password)
	if err != nil {
		return domain.Session{}, err
	}
	user, err := s.users.CreateUser(ctx, username, hash)
	if err != nil {
		return domain.Session{}, err
	}
	return s.issueSession(ctx, user.ID)
}

func (s *Service) issueSession(ctx context.Context, userID string) (domain.Session, error) {
	token, err := randomToken()
	if err != nil {
		return domain.Session{}, err
	}
	sess := domain.Session{Token: token, UserID: userID, ExpiresAt: time.Now().Add(sessionTTL)}
	if err := s.sessions.CreateSession(ctx, sess.Token, sess.UserID, sess.ExpiresAt); err != nil {
		return domain.Session{}, err
	}
	return sess, nil
}

func validateCredentials(username, password string) error {
	if len(username) < minUsernameLen || len(username) > maxInputLen {
		return domain.ErrWeakInput
	}
	if len(password) < minPasswordLen || len(password) > maxInputLen {
		return domain.ErrWeakInput
	}
	return nil
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

var _ domain.AuthUseCases = (*Service)(nil)
