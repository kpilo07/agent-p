// Package db implementa la capa de persistencia en SQLite usando el driver
// puro de Go (modernc.org/sqlite) — sin CGO.
package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("db: not found")

type Project struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	CLICommand string    `json:"cliCommand"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Session struct {
	ID        int64      `json:"id"`
	ProjectID string     `json:"projectId"`
	Status    string     `json:"status"` // running | ended
	StartedAt time.Time  `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
}

type Store struct {
	db *sql.DB
}

const schema = `
CREATE TABLE IF NOT EXISTS projects (
	id          TEXT PRIMARY KEY,
	name        TEXT NOT NULL,
	path        TEXT NOT NULL,
	cli_command TEXT NOT NULL DEFAULT '',
	created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	status     TEXT NOT NULL DEFAULT 'running',
	started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	ended_at   TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
`

// Open abre (o crea) la base de datos y aplica el esquema.
func Open(path string) (*Store, error) {
	// busy_timeout + WAL: seguro para acceso concurrente desde varias goroutines.
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("db: open: %w", err)
	}
	// modernc/sqlite serializa escrituras; una sola conexión evita SQLITE_BUSY.
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("db: migrate: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// ── Projects ────────────────────────────────────────────────────

func (s *Store) CreateProject(ctx context.Context, name, path, cliCommand string) (Project, error) {
	p := Project{ID: newID(), Name: name, Path: path, CLICommand: cliCommand, CreatedAt: time.Now().UTC()}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO projects (id, name, path, cli_command, created_at) VALUES (?, ?, ?, ?, ?)`,
		p.ID, p.Name, p.Path, p.CLICommand, p.CreatedAt)
	if err != nil {
		return Project{}, fmt.Errorf("db: create project: %w", err)
	}
	return p, nil
}

func (s *Store) GetProject(ctx context.Context, id string) (Project, error) {
	var p Project
	err := s.db.QueryRowContext(ctx,
		`SELECT id, name, path, cli_command, created_at FROM projects WHERE id = ?`, id).
		Scan(&p.ID, &p.Name, &p.Path, &p.CLICommand, &p.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Project{}, ErrNotFound
	}
	if err != nil {
		return Project{}, fmt.Errorf("db: get project: %w", err)
	}
	return p, nil
}

func (s *Store) ListProjects(ctx context.Context) ([]Project, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, path, cli_command, created_at FROM projects ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("db: list projects: %w", err)
	}
	defer rows.Close()

	projects := []Project{}
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Path, &p.CLICommand, &p.CreatedAt); err != nil {
			return nil, err
		}
		projects = append(projects, p)
	}
	return projects, rows.Err()
}

func (s *Store) UpdateProject(ctx context.Context, p Project) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE projects SET name = ?, path = ?, cli_command = ? WHERE id = ?`,
		p.Name, p.Path, p.CLICommand, p.ID)
	if err != nil {
		return fmt.Errorf("db: update project: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteProject(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM projects WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("db: delete project: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ── Sessions ────────────────────────────────────────────────────

func (s *Store) CreateSession(ctx context.Context, projectID string) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO sessions (project_id, status, started_at) VALUES (?, 'running', ?)`,
		projectID, time.Now().UTC())
	if err != nil {
		return 0, fmt.Errorf("db: create session: %w", err)
	}
	return res.LastInsertId()
}

func (s *Store) EndSession(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ? AND status = 'running'`,
		time.Now().UTC(), id)
	if err != nil {
		return fmt.Errorf("db: end session: %w", err)
	}
	return nil
}

// EndAllRunning marca como terminadas las sesiones huérfanas de un arranque previo.
func (s *Store) EndAllRunning(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE sessions SET status = 'ended', ended_at = ? WHERE status = 'running'`,
		time.Now().UTC())
	return err
}

func (s *Store) ListSessions(ctx context.Context, projectID string) ([]Session, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, project_id, status, started_at, ended_at
		 FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 50`, projectID)
	if err != nil {
		return nil, fmt.Errorf("db: list sessions: %w", err)
	}
	defer rows.Close()

	sessions := []Session{}
	for rows.Next() {
		var sess Session
		var ended sql.NullTime
		if err := rows.Scan(&sess.ID, &sess.ProjectID, &sess.Status, &sess.StartedAt, &ended); err != nil {
			return nil, err
		}
		if ended.Valid {
			sess.EndedAt = &ended.Time
		}
		sessions = append(sessions, sess)
	}
	return sessions, rows.Err()
}
