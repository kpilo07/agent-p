// Package service implementa los casos de uso del bounded context "project".
// Orquesta los puertos de salida (domain.*Repository, domain.*Service) para
// ejecutar la lógica de negocio. Sin dependencias de infraestructura concretas.
package service

import (
	"bytes"
	"context"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"agent-p/internal/project/domain"
)

const maxFileContent = 1 << 20 // 1 MiB

var treeIgnored = map[string]bool{".git": true, "node_modules": true}

// ProjectService implementa domain.ProjectUseCases orquestando los puertos.
type ProjectService struct {
	projects domain.ProjectRepository
	sessions domain.SessionRepository
	git      domain.GitService
	terminal domain.TerminalService
	fswatch  domain.FSWatcher
	bus      domain.EventBus

	sessMu       sync.Mutex
	liveSessions map[string]int64 // projectID → sessionID de BD
}

// New construye el servicio inyectando sus dependencias.
func New(
	projects domain.ProjectRepository,
	sessions domain.SessionRepository,
	git domain.GitService,
	terminal domain.TerminalService,
	fswatch domain.FSWatcher,
	bus domain.EventBus,
) *ProjectService {
	return &ProjectService{
		projects:     projects,
		sessions:     sessions,
		git:          git,
		terminal:     terminal,
		fswatch:      fswatch,
		bus:          bus,
		liveSessions: make(map[string]int64),
	}
}

// ── Proyectos ────────────────────────────────────────────────────

func (s *ProjectService) ListProjects(ctx context.Context) ([]domain.Project, error) {
	return s.projects.ListProjects(ctx)
}

func (s *ProjectService) CreateProject(ctx context.Context, name, projPath, cliCommand string) (domain.Project, error) {
	return s.projects.CreateProject(ctx, name, projPath, cliCommand)
}

func (s *ProjectService) GetProject(ctx context.Context, id string) (domain.Project, error) {
	return s.projects.GetProject(ctx, id)
}

func (s *ProjectService) UpdateProject(ctx context.Context, p domain.Project) error {
	return s.projects.UpdateProject(ctx, p)
}

func (s *ProjectService) DeleteProject(ctx context.Context, id string) error {
	_ = s.StopProject(ctx, id) // best-effort
	return s.projects.DeleteProject(ctx, id)
}

// ── Ciclo de vida del agente ─────────────────────────────────────

func (s *ProjectService) StartProject(ctx context.Context, p domain.Project) error {
	if err := s.terminal.Start(p.ID, domain.AgentTermID, "Agente", p.Path, p.CLICommand); err != nil {
		return err
	}
	s.git.Watch(ctx, p.ID, p.Name, p.Path)
	s.fswatch.Watch(ctx, p.ID, p.Path)
	if id, err := s.sessions.CreateSession(ctx, p.ID); err == nil {
		s.sessMu.Lock()
		s.liveSessions[p.ID] = id
		s.sessMu.Unlock()
	}
	return nil
}

func (s *ProjectService) StopProject(ctx context.Context, projectID string) error {
	s.git.Unwatch(projectID)
	s.fswatch.Unwatch(projectID)
	err := s.terminal.StopProject(projectID)
	if err != nil {
		s.EndDBSession(ctx, projectID)
	}
	return err
}

func (s *ProjectService) IsRunning(projectID string) bool {
	return s.terminal.Running(projectID, domain.AgentTermID)
}

// EndDBSession cierra la sesión de BD del proyecto. Público para que el
// composition root pueda invocarlo desde el callback OnSessionEnd.
func (s *ProjectService) EndDBSession(ctx context.Context, projectID string) {
	s.sessMu.Lock()
	id, ok := s.liveSessions[projectID]
	delete(s.liveSessions, projectID)
	s.sessMu.Unlock()
	if ok {
		_ = s.sessions.EndSession(context.WithoutCancel(ctx), id)
	}
}

// InitSessions limpia las sesiones huérfanas al arrancar el servidor.
func (s *ProjectService) InitSessions(ctx context.Context) error {
	return s.sessions.EndAllRunning(ctx)
}

// ── Terminales ───────────────────────────────────────────────────

func (s *ProjectService) ListTerminals(projectID string) []domain.TermInfo {
	return s.terminal.ListTerminals(projectID)
}

func (s *ProjectService) CreateTerminal(ctx context.Context, projectID, title string) (domain.TermInfo, error) {
	p, err := s.projects.GetProject(ctx, projectID)
	if err != nil {
		return domain.TermInfo{}, err
	}
	if title == "" {
		title = "Shell"
	}
	termID := s.terminal.NewTermID()
	if err := s.terminal.Start(p.ID, termID, title, p.Path, ""); err != nil {
		return domain.TermInfo{}, err
	}
	return domain.TermInfo{ID: termID, Title: title, Running: true}, nil
}

func (s *ProjectService) CloseTerminal(_ context.Context, projectID, termID string) error {
	return s.terminal.Stop(projectID, termID)
}

// ── Git ──────────────────────────────────────────────────────────

func (s *ProjectService) GetGitSnapshot(ctx context.Context, projectPath string) (*domain.GitSnapshot, error) {
	return s.git.Take(ctx, projectPath)
}

func (s *ProjectService) GetFileDiff(ctx context.Context, projectPath, filePath string) (string, error) {
	return s.git.TakeFile(ctx, projectPath, filePath)
}

// ── Árbol de archivos ────────────────────────────────────────────

func (s *ProjectService) GetFileTree(_ context.Context, projectPath string) (*domain.TreeNode, error) {
	root, err := scanTree(projectPath, "")
	if err != nil {
		return nil, err
	}
	root.Name = filepath.Base(projectPath)
	return root, nil
}

func scanTree(absDir, rel string) (*domain.TreeNode, error) {
	node := &domain.TreeNode{Name: path.Base(rel), Path: rel, Dir: true, Children: []*domain.TreeNode{}}

	entries, err := os.ReadDir(absDir)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].IsDir() && !entries[j].IsDir()
	})

	for _, e := range entries {
		if treeIgnored[e.Name()] {
			continue
		}
		childRel := path.Join(rel, e.Name())
		switch {
		case e.IsDir():
			child, err := scanTree(filepath.Join(absDir, e.Name()), childRel)
			if err != nil {
				continue
			}
			node.Children = append(node.Children, child)
		case e.Type().IsRegular():
			node.Children = append(node.Children, &domain.TreeNode{Name: e.Name(), Path: childRel})
		}
	}
	return node, nil
}

func (s *ProjectService) GetFile(_ context.Context, projectPath, filePath string) (*domain.FileContent, error) {
	abs := filepath.Join(projectPath, filePath)
	info, err := os.Stat(abs)
	if err != nil || info.IsDir() {
		return nil, domain.ErrNotFound
	}

	f, err := os.Open(abs)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	buf := make([]byte, maxFileContent)
	n, _ := io.ReadFull(f, buf)
	data := buf[:n]

	truncated := info.Size() > int64(n)
	out := &domain.FileContent{
		Path:      filepath.ToSlash(filePath),
		Size:      info.Size(),
		Truncated: truncated,
		Binary:    isBinary(data, truncated),
	}
	if !out.Binary {
		out.Content = string(data)
	}
	return out, nil
}

// ── Sesiones ─────────────────────────────────────────────────────

func (s *ProjectService) ListSessions(ctx context.Context, projectID string) ([]domain.Session, error) {
	return s.sessions.ListSessions(ctx, projectID)
}

// ── Explorador de sistema de archivos ────────────────────────────

func (s *ProjectService) BrowseFS(_ context.Context, p string) (*domain.FSListing, error) {
	if p == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		p = home
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil || !info.IsDir() {
		return nil, domain.ErrNotFound
	}

	dirents, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}

	listing := &domain.FSListing{Path: abs, IsGitRepo: isGitRepo(abs), Entries: []domain.FSEntry{}}
	if parent := filepath.Dir(abs); parent != abs {
		listing.Parent = parent
	}
	for _, e := range dirents {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		full := filepath.Join(abs, e.Name())
		listing.Entries = append(listing.Entries, domain.FSEntry{
			Name:      e.Name(),
			Path:      full,
			IsGitRepo: isGitRepo(full),
		})
	}
	return listing, nil
}

// ── helpers ──────────────────────────────────────────────────────

func isGitRepo(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, ".git"))
	return err == nil
}

func isBinary(data []byte, truncated bool) bool {
	head := data
	if len(head) > 8192 {
		head = head[:8192]
	}
	if bytes.IndexByte(head, 0) >= 0 {
		return true
	}
	if truncated && len(data) > utf8.UTFMax {
		data = data[:len(data)-utf8.UTFMax]
	}
	return !utf8.Valid(data)
}
