// Package service implementa los casos de uso del bounded context "project".
// Orquesta los puertos de salida (domain.*Repository, domain.*Service) para
// ejecutar la lógica de negocio. Sin dependencias de infraestructura concretas.
package service

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
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
	activity domain.ActivityRepository
	recorder domain.ActivityRecorder
	tickets  domain.TicketRepository

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
	activity domain.ActivityRepository,
	recorder domain.ActivityRecorder,
	tickets domain.TicketRepository,
) *ProjectService {
	return &ProjectService{
		projects:     projects,
		sessions:     sessions,
		git:          git,
		terminal:     terminal,
		fswatch:      fswatch,
		bus:          bus,
		activity:     activity,
		recorder:     recorder,
		tickets:      tickets,
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
	// Los watchers son procesos de larga vida ligados al ciclo del proyecto,
	// NO al de la petición HTTP. Si heredan el contexto de la request, este se
	// cancela al responder el handler y los loops mueren tras el primer
	// snapshot: dejan de emitirse git_update/fs_change y el mapa no se anima.
	// Los detenemos explícitamente en StopProject (Unwatch).
	wctx := context.WithoutCancel(ctx)
	s.git.Watch(wctx, p.ID, p.Name, p.Path)
	s.fswatch.Watch(wctx, p.ID, p.Path)
	if id, err := s.sessions.CreateSession(ctx, p.ID); err == nil {
		s.sessMu.Lock()
		s.liveSessions[p.ID] = id
		s.sessMu.Unlock()
	}
	s.record(ctx, p.ID, domain.ActivitySessionStart, "Agente iniciado")
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

// InterruptAgent envía Ctrl-C (0x03) al PTY del agente sin matar la sesión.
func (s *ProjectService) InterruptAgent(projectID string) error {
	if err := s.terminal.Write(projectID, domain.AgentTermID, []byte{0x03}); err != nil {
		return err
	}
	s.record(context.Background(), projectID, domain.ActivityInterrupt, "Ctrl-C enviado al agente")
	return nil
}

// ── Gobierno del repo (sobre el trabajo del agente) ──────────────

func (s *ProjectService) GitCommit(ctx context.Context, projectID, message string) error {
	p, err := s.projects.GetProject(ctx, projectID)
	if err != nil {
		return err
	}
	if err := s.git.Commit(ctx, p.Path, message); err != nil {
		return err
	}
	s.record(ctx, projectID, domain.ActivityCommit, "Commit: "+message)
	return nil
}

func (s *ProjectService) GitStash(ctx context.Context, projectID string) error {
	p, err := s.projects.GetProject(ctx, projectID)
	if err != nil {
		return err
	}
	if err := s.git.Stash(ctx, p.Path); err != nil {
		return err
	}
	s.record(ctx, projectID, domain.ActivityStash, "Cambios guardados en stash")
	return nil
}

func (s *ProjectService) GitDiscard(ctx context.Context, projectID, file string) error {
	p, err := s.projects.GetProject(ctx, projectID)
	if err != nil {
		return err
	}
	if err := s.git.Discard(ctx, p.Path, file); err != nil {
		return err
	}
	msg := "Cambios descartados (todos)"
	if file != "" {
		msg = "Cambios descartados: " + file
	}
	s.record(ctx, projectID, domain.ActivityDiscard, msg)
	return nil
}

// EndDBSession cierra la sesión de BD del proyecto. Público para que el
// composition root pueda invocarlo desde el callback OnSessionEnd.
func (s *ProjectService) EndDBSession(ctx context.Context, projectID string) {
	s.sessMu.Lock()
	id, ok := s.liveSessions[projectID]
	delete(s.liveSessions, projectID)
	s.sessMu.Unlock()
	if ok {
		uctx := context.WithoutCancel(ctx)
		_ = s.sessions.EndSession(uctx, id)
		s.record(uctx, projectID, domain.ActivitySessionEnd, "El proceso del agente terminó")
	}
}

// record persiste y emite un evento de actividad (best-effort).
func (s *ProjectService) record(ctx context.Context, projectID, kind, message string) {
	if s.recorder != nil {
		s.recorder.Record(ctx, domain.ActivityEvent{ProjectID: projectID, Kind: kind, Message: message})
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

func (s *ProjectService) GetCommits(ctx context.Context, projectPath string, limit int) ([]domain.Commit, error) {
	return s.git.Log(ctx, projectPath, limit)
}

func (s *ProjectService) GetCommitDiff(ctx context.Context, projectPath, hash string) (string, error) {
	return s.git.CommitDiff(ctx, projectPath, hash)
}

func (s *ProjectService) GetBranches(ctx context.Context, projectPath string) (*domain.GitBranches, error) {
	return s.git.Branches(ctx, projectPath)
}

func (s *ProjectService) GitCheckout(ctx context.Context, projectID, branch string, create bool) error {
	p, err := s.projects.GetProject(ctx, projectID)
	if err != nil {
		return err
	}
	if err := s.git.Checkout(ctx, p.Path, branch, create); err != nil {
		return err
	}
	msg := "Cambio de rama: " + branch
	if create {
		msg = "Rama creada: " + branch
	}
	s.record(ctx, projectID, domain.ActivityBranchSwitch, msg)
	return nil
}

func (s *ProjectService) GrepRepo(ctx context.Context, projectPath, query string) ([]domain.GrepMatch, error) {
	return s.git.Grep(ctx, projectPath, query)
}

// gitRemoteOp resuelve el proyecto y ejecuta una operación de remoto. No
// registra actividad: el cambio (ahead/behind, working tree) lo capta el
// siguiente sondeo del watcher y se emite por git_update.
func (s *ProjectService) gitRemoteOp(ctx context.Context, projectID string, op func(ctx context.Context, path string) error) error {
	p, err := s.projects.GetProject(ctx, projectID)
	if err != nil {
		return err
	}
	return op(ctx, p.Path)
}

func (s *ProjectService) GitFetch(ctx context.Context, projectID string) error {
	return s.gitRemoteOp(ctx, projectID, s.git.Fetch)
}

func (s *ProjectService) GitPush(ctx context.Context, projectID string) error {
	return s.gitRemoteOp(ctx, projectID, s.git.Push)
}

func (s *ProjectService) GitPull(ctx context.Context, projectID string) error {
	return s.gitRemoteOp(ctx, projectID, s.git.Pull)
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

// ── Timeline de actividad ────────────────────────────────────────

func (s *ProjectService) ListActivity(ctx context.Context, projectID string, limit int) ([]domain.ActivityEvent, error) {
	return s.activity.ListActivity(ctx, projectID, limit)
}

// ── Tickets ──────────────────────────────────────────────────────

// Secuencias de bracketed paste: envuelven el texto inyectado para que los
// agentes TUI modernos (Claude Code, Codex…) lo traten como un pegado único
// —sin enviar al pulsar Enter intermedios— y el \r final lo confirma.
const (
	pasteStart = "\x1b[200~"
	pasteEnd   = "\x1b[201~"
)

// ticketStartupDelay es el margen para que el agente arranque y entre en su
// bucle de lectura antes de inyectarle el prompt cuando no estaba en ejecución.
const ticketStartupDelay = 1500 * time.Millisecond

func (s *ProjectService) ListTickets(ctx context.Context, projectID string) ([]domain.Ticket, error) {
	return s.tickets.ListTickets(ctx, projectID)
}

func (s *ProjectService) CreateTicket(ctx context.Context, projectID, title, body string, files []string) (domain.Ticket, error) {
	if _, err := s.projects.GetProject(ctx, projectID); err != nil {
		return domain.Ticket{}, err
	}
	if files == nil {
		files = []string{}
	}
	return s.tickets.CreateTicket(ctx, domain.Ticket{
		ProjectID: projectID,
		Title:     strings.TrimSpace(title),
		Body:      body,
		Files:     files,
		Status:    domain.TicketDraft,
	})
}

// LaunchTicket inyecta el ticket como prompt al agente. Modo inteligente: si el
// agente ya corre, escribe en su PTY; si no, arranca el proyecto y le inyecta el
// prompt tras un breve margen de arranque. La primera vez fija el commit base y
// la rama para poder relacionar después los commits del agente con el ticket.
func (s *ProjectService) LaunchTicket(ctx context.Context, ticketID int64) (domain.Ticket, error) {
	t, err := s.tickets.GetTicket(ctx, ticketID)
	if err != nil {
		return domain.Ticket{}, err
	}
	p, err := s.projects.GetProject(ctx, t.ProjectID)
	if err != nil {
		return domain.Ticket{}, err
	}

	payload := []byte(pasteStart + buildTicketPrompt(t) + pasteEnd + "\r")

	if s.terminal.Running(p.ID, domain.AgentTermID) {
		if err := s.terminal.Write(p.ID, domain.AgentTermID, payload); err != nil {
			return domain.Ticket{}, err
		}
	} else {
		if err := s.StartProject(ctx, p); err != nil && !errors.Is(err, domain.ErrAlreadyRunning) {
			return domain.Ticket{}, err
		}
		pid := p.ID
		time.AfterFunc(ticketStartupDelay, func() {
			_ = s.terminal.Write(pid, domain.AgentTermID, payload)
		})
	}

	// El commit base y la rama se fijan solo en el primer lanzamiento: un
	// relanzamiento (re-inyección) conserva el rango original.
	if t.Status == domain.TicketDraft {
		base, _ := s.git.Head(ctx, p.Path)
		t.BaseCommit = base
		if br, berr := s.git.Branches(ctx, p.Path); berr == nil {
			t.Branch = br.Current
		}
		now := time.Now().UTC()
		t.LaunchedAt = &now
	}
	t.Status = domain.TicketLaunched
	if err := s.tickets.UpdateTicket(ctx, t); err != nil {
		return domain.Ticket{}, err
	}
	s.record(ctx, p.ID, domain.ActivityTicket, "Ticket lanzado: "+ticketLabel(t))
	return t, nil
}

// CloseTicket congela el rango de commits del ticket guardando el HEAD actual.
func (s *ProjectService) CloseTicket(ctx context.Context, ticketID int64) (domain.Ticket, error) {
	t, err := s.tickets.GetTicket(ctx, ticketID)
	if err != nil {
		return domain.Ticket{}, err
	}
	if t.Status == domain.TicketClosed {
		return t, nil
	}
	if p, perr := s.projects.GetProject(ctx, t.ProjectID); perr == nil {
		if head, _ := s.git.Head(ctx, p.Path); head != "" {
			t.HeadCommit = head
		}
	}
	now := time.Now().UTC()
	t.ClosedAt = &now
	t.Status = domain.TicketClosed
	if err := s.tickets.UpdateTicket(ctx, t); err != nil {
		return domain.Ticket{}, err
	}
	return t, nil
}

func (s *ProjectService) DeleteTicket(ctx context.Context, ticketID int64) error {
	return s.tickets.DeleteTicket(ctx, ticketID)
}

func (s *ProjectService) TicketCommits(ctx context.Context, ticketID int64) ([]domain.Commit, error) {
	t, err := s.tickets.GetTicket(ctx, ticketID)
	if err != nil {
		return nil, err
	}
	if t.BaseCommit == "" {
		return []domain.Commit{}, nil
	}
	p, err := s.projects.GetProject(ctx, t.ProjectID)
	if err != nil {
		return nil, err
	}
	commits, err := s.git.LogRange(ctx, p.Path, t.BaseCommit, t.HeadCommit, 200)
	if err != nil {
		return nil, err
	}
	if commits == nil {
		commits = []domain.Commit{}
	}
	return commits, nil
}

// buildTicketPrompt arma el texto que recibe el agente: título, cuerpo y, si
// las hay, las rutas mencionadas como @ruta (las reconoce p. ej. Claude Code).
func buildTicketPrompt(t domain.Ticket) string {
	var b strings.Builder
	if t.Title != "" {
		b.WriteString(t.Title)
		b.WriteString("\n\n")
	}
	b.WriteString(t.Body)
	if len(t.Files) > 0 {
		b.WriteString("\n\nArchivos relevantes:\n")
		for _, f := range t.Files {
			b.WriteString("@")
			b.WriteString(f)
			b.WriteString("\n")
		}
	}
	return b.String()
}

// ticketLabel resume el ticket para el timeline: el título o la primera línea
// del cuerpo, recortado.
func ticketLabel(t domain.Ticket) string {
	s := t.Title
	if s == "" {
		s, _, _ = strings.Cut(t.Body, "\n")
	}
	s = strings.TrimSpace(s)
	if len(s) > 80 {
		s = s[:80] + "…"
	}
	if s == "" {
		return "(sin título)"
	}
	return s
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
