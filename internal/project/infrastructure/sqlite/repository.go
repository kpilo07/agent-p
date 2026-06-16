// Package sqlite implementa domain.ProjectRepository y domain.SessionRepository
// usando SQLite puro (modernc.org/sqlite, sin CGO).
package sqlite

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"agent-p/internal/platform/storage"
	"agent-p/internal/project/domain"
)

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

CREATE TABLE IF NOT EXISTS activity (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	kind       TEXT NOT NULL,
	message    TEXT NOT NULL DEFAULT '',
	branch     TEXT NOT NULL DEFAULT '',
	additions  INTEGER NOT NULL DEFAULT 0,
	deletions  INTEGER NOT NULL DEFAULT 0,
	files      INTEGER NOT NULL DEFAULT 0,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id, id DESC);

CREATE TABLE IF NOT EXISTS tickets (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	title       TEXT NOT NULL DEFAULT '',
	body        TEXT NOT NULL DEFAULT '',
	files       TEXT NOT NULL DEFAULT '[]',
	status      TEXT NOT NULL DEFAULT 'draft',
	base_commit TEXT NOT NULL DEFAULT '',
	head_commit TEXT NOT NULL DEFAULT '',
	branch      TEXT NOT NULL DEFAULT '',
	created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	launched_at TIMESTAMP,
	closed_at   TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tickets_project ON tickets(project_id, id DESC);
`

// Store implementa ProjectRepository y SessionRepository sobre SQLite.
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
		return nil, fmt.Errorf("sqlite: migrate: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// ── domain.ProjectRepository ─────────────────────────────────────

func (s *Store) CreateProject(ctx context.Context, name, path, cliCommand string) (domain.Project, error) {
	p := domain.Project{ID: newID(), Name: name, Path: path, CLICommand: cliCommand, CreatedAt: time.Now().UTC()}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO projects (id, name, path, cli_command, created_at) VALUES (?, ?, ?, ?, ?)`,
		p.ID, p.Name, p.Path, p.CLICommand, p.CreatedAt)
	if err != nil {
		return domain.Project{}, fmt.Errorf("sqlite: create project: %w", err)
	}
	return p, nil
}

func (s *Store) GetProject(ctx context.Context, id string) (domain.Project, error) {
	var p domain.Project
	err := s.db.QueryRowContext(ctx,
		`SELECT id, name, path, cli_command, created_at FROM projects WHERE id = ?`, id).
		Scan(&p.ID, &p.Name, &p.Path, &p.CLICommand, &p.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Project{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Project{}, fmt.Errorf("sqlite: get project: %w", err)
	}
	return p, nil
}

func (s *Store) ListProjects(ctx context.Context) ([]domain.Project, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, path, cli_command, created_at FROM projects ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list projects: %w", err)
	}
	defer rows.Close()

	projects := []domain.Project{}
	for rows.Next() {
		var p domain.Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Path, &p.CLICommand, &p.CreatedAt); err != nil {
			return nil, err
		}
		projects = append(projects, p)
	}
	return projects, rows.Err()
}

func (s *Store) UpdateProject(ctx context.Context, p domain.Project) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE projects SET name = ?, path = ?, cli_command = ? WHERE id = ?`,
		p.Name, p.Path, p.CLICommand, p.ID)
	if err != nil {
		return fmt.Errorf("sqlite: update project: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (s *Store) DeleteProject(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM projects WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("sqlite: delete project: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ── domain.SessionRepository ─────────────────────────────────────

func (s *Store) CreateSession(ctx context.Context, projectID string) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO sessions (project_id, status, started_at) VALUES (?, 'running', ?)`,
		projectID, time.Now().UTC())
	if err != nil {
		return 0, fmt.Errorf("sqlite: create session: %w", err)
	}
	return res.LastInsertId()
}

func (s *Store) EndSession(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ? AND status = 'running'`,
		time.Now().UTC(), id)
	return err
}

func (s *Store) EndAllRunning(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE sessions SET status = 'ended', ended_at = ? WHERE status = 'running'`,
		time.Now().UTC())
	return err
}

func (s *Store) ListSessions(ctx context.Context, projectID string) ([]domain.Session, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, project_id, status, started_at, ended_at
		 FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 50`, projectID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list sessions: %w", err)
	}
	defer rows.Close()

	sessions := []domain.Session{}
	for rows.Next() {
		var sess domain.Session
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

// ── domain.ActivityRepository ────────────────────────────────────

func (s *Store) CreateActivity(ctx context.Context, ev domain.ActivityEvent) (domain.ActivityEvent, error) {
	if ev.CreatedAt.IsZero() {
		ev.CreatedAt = time.Now().UTC()
	}
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO activity (project_id, kind, message, branch, additions, deletions, files, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		ev.ProjectID, ev.Kind, ev.Message, ev.Branch, ev.Additions, ev.Deletions, ev.Files, ev.CreatedAt)
	if err != nil {
		return domain.ActivityEvent{}, fmt.Errorf("sqlite: create activity: %w", err)
	}
	ev.ID, _ = res.LastInsertId()
	return ev, nil
}

func (s *Store) ListActivity(ctx context.Context, projectID string, limit int) ([]domain.ActivityEvent, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, project_id, kind, message, branch, additions, deletions, files, created_at
		 FROM activity WHERE project_id = ? ORDER BY id DESC LIMIT ?`, projectID, limit)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list activity: %w", err)
	}
	defer rows.Close()

	events := []domain.ActivityEvent{}
	for rows.Next() {
		var e domain.ActivityEvent
		if err := rows.Scan(&e.ID, &e.ProjectID, &e.Kind, &e.Message, &e.Branch,
			&e.Additions, &e.Deletions, &e.Files, &e.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

// ── domain.TicketRepository ──────────────────────────────────────

func (s *Store) CreateTicket(ctx context.Context, t domain.Ticket) (domain.Ticket, error) {
	if t.CreatedAt.IsZero() {
		t.CreatedAt = time.Now().UTC()
	}
	if t.Status == "" {
		t.Status = domain.TicketDraft
	}
	if t.Files == nil {
		t.Files = []string{}
	}
	files, _ := json.Marshal(t.Files)
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO tickets (project_id, title, body, files, status, base_commit, head_commit, branch, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ProjectID, t.Title, t.Body, string(files), t.Status, t.BaseCommit, t.HeadCommit, t.Branch, t.CreatedAt)
	if err != nil {
		return domain.Ticket{}, fmt.Errorf("sqlite: create ticket: %w", err)
	}
	t.ID, _ = res.LastInsertId()
	return t, nil
}

func (s *Store) ListTickets(ctx context.Context, projectID string) ([]domain.Ticket, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, project_id, title, body, files, status, base_commit, head_commit, branch, created_at, launched_at, closed_at
		 FROM tickets WHERE project_id = ? ORDER BY id DESC LIMIT 200`, projectID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list tickets: %w", err)
	}
	defer rows.Close()

	tickets := []domain.Ticket{}
	for rows.Next() {
		t, err := scanTicket(rows)
		if err != nil {
			return nil, err
		}
		tickets = append(tickets, t)
	}
	return tickets, rows.Err()
}

func (s *Store) GetTicket(ctx context.Context, id int64) (domain.Ticket, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, project_id, title, body, files, status, base_commit, head_commit, branch, created_at, launched_at, closed_at
		 FROM tickets WHERE id = ?`, id)
	t, err := scanTicket(row)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Ticket{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Ticket{}, fmt.Errorf("sqlite: get ticket: %w", err)
	}
	return t, nil
}

func (s *Store) UpdateTicket(ctx context.Context, t domain.Ticket) error {
	if t.Files == nil {
		t.Files = []string{}
	}
	files, _ := json.Marshal(t.Files)
	res, err := s.db.ExecContext(ctx,
		`UPDATE tickets SET title = ?, body = ?, files = ?, status = ?, base_commit = ?, head_commit = ?, branch = ?, launched_at = ?, closed_at = ?
		 WHERE id = ?`,
		t.Title, t.Body, string(files), t.Status, t.BaseCommit, t.HeadCommit, t.Branch,
		nullTime(t.LaunchedAt), nullTime(t.ClosedAt), t.ID)
	if err != nil {
		return fmt.Errorf("sqlite: update ticket: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (s *Store) DeleteTicket(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM tickets WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("sqlite: delete ticket: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// scanner abstrae *sql.Row y *sql.Rows (ambos exponen Scan).
type scanner interface{ Scan(dest ...any) error }

func scanTicket(sc scanner) (domain.Ticket, error) {
	var t domain.Ticket
	var files string
	var launched, closed sql.NullTime
	if err := sc.Scan(&t.ID, &t.ProjectID, &t.Title, &t.Body, &files, &t.Status,
		&t.BaseCommit, &t.HeadCommit, &t.Branch, &t.CreatedAt, &launched, &closed); err != nil {
		return domain.Ticket{}, err
	}
	if err := json.Unmarshal([]byte(files), &t.Files); err != nil || t.Files == nil {
		t.Files = []string{}
	}
	if launched.Valid {
		t.LaunchedAt = &launched.Time
	}
	if closed.Valid {
		t.ClosedAt = &closed.Time
	}
	return t, nil
}

func nullTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return *t
}

// Compile-time checks.
var (
	_ domain.ProjectRepository  = (*Store)(nil)
	_ domain.SessionRepository  = (*Store)(nil)
	_ domain.ActivityRepository = (*Store)(nil)
	_ domain.TicketRepository   = (*Store)(nil)
)
