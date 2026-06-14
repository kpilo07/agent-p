// Package sqlite implementa domain.UserRepository y domain.SessionRepository
// usando SQLite puro (modernc.org/sqlite, sin CGO). Comparte el mismo fichero
// que el resto de la aplicación pero sus propias tablas (auth_*).
package sqlite

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"agent-p/internal/auth/domain"
	"agent-p/internal/platform/storage"
)

const schema = `
CREATE TABLE IF NOT EXISTS auth_users (
	id            TEXT PRIMARY KEY,
	username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
	password_hash TEXT NOT NULL,
	created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_sessions (
	token      TEXT PRIMARY KEY,
	user_id    TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
	expires_at TIMESTAMP NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
`

// Store implementa UserRepository y SessionRepository sobre SQLite.
type Store struct {
	db *sql.DB
}

// Open abre (o crea) la base de datos, aplica el esquema y devuelve el Store.
func Open(path string) (*Store, error) {
	db, err := storage.OpenSQLite(path)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("auth/sqlite: migrate: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// ── domain.UserRepository ────────────────────────────────────────

func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM auth_users`).Scan(&n); err != nil {
		return 0, fmt.Errorf("auth/sqlite: count users: %w", err)
	}
	return n, nil
}

func (s *Store) CreateUser(ctx context.Context, username, passwordHash string) (domain.User, error) {
	u := domain.User{ID: newID(), Username: username, PasswordHash: passwordHash, CreatedAt: time.Now().UTC()}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO auth_users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`,
		u.ID, u.Username, u.PasswordHash, u.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.User{}, domain.ErrUserExists
		}
		return domain.User{}, fmt.Errorf("auth/sqlite: create user: %w", err)
	}
	return u, nil
}

func (s *Store) GetUserByUsername(ctx context.Context, username string) (domain.User, error) {
	return s.scanUser(s.db.QueryRowContext(ctx,
		`SELECT id, username, password_hash, created_at FROM auth_users WHERE username = ? COLLATE NOCASE`, username))
}

func (s *Store) GetUserByID(ctx context.Context, id string) (domain.User, error) {
	return s.scanUser(s.db.QueryRowContext(ctx,
		`SELECT id, username, password_hash, created_at FROM auth_users WHERE id = ?`, id))
}

func (s *Store) scanUser(row *sql.Row) (domain.User, error) {
	var u domain.User
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.User{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.User{}, fmt.Errorf("auth/sqlite: get user: %w", err)
	}
	return u, nil
}

// ── domain.SessionRepository ─────────────────────────────────────

func (s *Store) CreateSession(ctx context.Context, token, userID string, expiresAt time.Time) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO auth_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		token, userID, expiresAt.UTC(), time.Now().UTC())
	if err != nil {
		return fmt.Errorf("auth/sqlite: create session: %w", err)
	}
	return nil
}

func (s *Store) GetSession(ctx context.Context, token string) (domain.Session, error) {
	var sess domain.Session
	err := s.db.QueryRowContext(ctx,
		`SELECT token, user_id, expires_at FROM auth_sessions WHERE token = ?`, token).
		Scan(&sess.Token, &sess.UserID, &sess.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Session{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Session{}, fmt.Errorf("auth/sqlite: get session: %w", err)
	}
	return sess, nil
}

func (s *Store) DeleteSession(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM auth_sessions WHERE token = ?`, token)
	return err
}

func (s *Store) DeleteExpired(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM auth_sessions WHERE expires_at < ?`, time.Now().UTC())
	return err
}

// isUniqueViolation detecta el error de restricción UNIQUE de modernc/sqlite
// sin acoplarse al tipo concreto del driver.
func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}

var (
	_ domain.UserRepository    = (*Store)(nil)
	_ domain.SessionRepository = (*Store)(nil)
)
