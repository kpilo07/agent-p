// Package gitwatch implementa domain.GitService: vigila los repositorios git
// y emite eventos git_update y notification al hub.
package gitwatch

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"agent-p/internal/project/domain"
	"agent-p/internal/project/infrastructure/hub"
)

type watch struct {
	cancel context.CancelFunc
}

// Watcher implementa domain.GitService con polling periódico de git.
type Watcher struct {
	log      *slog.Logger
	hub      *hub.Hub
	recorder domain.ActivityRecorder
	interval time.Duration

	mu      sync.Mutex
	watches map[string]*watch
}

// New crea un Watcher. recorder puede ser nil (no se registra actividad).
func New(log *slog.Logger, h *hub.Hub, recorder domain.ActivityRecorder, interval time.Duration) *Watcher {
	if interval <= 0 {
		interval = 2 * time.Second
	}
	return &Watcher{log: log, hub: h, recorder: recorder, interval: interval, watches: make(map[string]*watch)}
}

func (w *Watcher) Watch(ctx context.Context, projectID, name, path string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if _, ok := w.watches[projectID]; ok {
		return
	}
	wctx, cancel := context.WithCancel(ctx)
	w.watches[projectID] = &watch{cancel: cancel}
	go w.loop(wctx, projectID, name, path)
	w.log.Info("git watch started", "project", projectID, "path", path)
}

func (w *Watcher) Unwatch(projectID string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if wt, ok := w.watches[projectID]; ok {
		wt.cancel()
		delete(w.watches, projectID)
		w.log.Info("git watch stopped", "project", projectID)
	}
}

func (w *Watcher) UnwatchAll() {
	w.mu.Lock()
	defer w.mu.Unlock()
	for id, wt := range w.watches {
		wt.cancel()
		delete(w.watches, id)
	}
}

func (w *Watcher) loop(ctx context.Context, projectID, name, path string) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	var lastHash [32]byte
	lastBranch := ""
	first := true

	for {
		snap, err := w.Take(ctx, path)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			w.log.Warn("git snapshot failed", "project", projectID, "err", err)
		} else {
			hash := snapHash(snap)
			if hash != lastHash {
				lastHash = hash
				snap.Initial = first
				w.hub.BroadcastProjectEvent(projectID, hub.Events.GitUpdate(snap))
				if !first {
					w.hub.BroadcastGlobalEvent(hub.Events.Notification(projectID, map[string]any{
						"level":     "git",
						"project":   name,
						"message":   summarize(snap),
						"files":     len(snap.Files),
						"additions": snap.Additions,
						"deletions": snap.Deletions,
					}))
					w.recordActivity(ctx, projectID, lastBranch, snap)
				}
			}
			lastBranch = snap.Branch
			first = false
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// currentBranch devuelve la rama actual; cadena vacía en HEAD desacoplado o error.
func currentBranch(ctx context.Context, path string) string {
	out, err := runGit(ctx, path, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return ""
	}
	branch := strings.TrimSpace(string(out))
	if branch == "HEAD" { // detached: usar el hash corto
		if short, err := runGit(ctx, path, "rev-parse", "--short", "HEAD"); err == nil {
			return "@" + strings.TrimSpace(string(short))
		}
		return ""
	}
	return branch
}

func snapHash(s *domain.GitSnapshot) [32]byte {
	h := sha256.New()
	h.Write([]byte(s.Branch))
	h.Write([]byte(s.Diff))
	for _, f := range s.Files {
		h.Write([]byte(f.Status))
		h.Write([]byte(f.Path))
	}
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

func summarize(s *domain.GitSnapshot) string {
	return "Working tree modificado: " + strconv.Itoa(len(s.Files)) + " archivo(s), +" +
		strconv.Itoa(s.Additions) + " / -" + strconv.Itoa(s.Deletions)
}

// recordActivity registra en el timeline el cambio detectado: un cambio de rama
// si la rama difiere, o un cambio del working tree en otro caso.
func (w *Watcher) recordActivity(ctx context.Context, projectID, prevBranch string, snap *domain.GitSnapshot) {
	if w.recorder == nil {
		return
	}
	if snap.Branch != "" && prevBranch != "" && snap.Branch != prevBranch {
		w.recorder.Record(ctx, domain.ActivityEvent{
			ProjectID: projectID,
			Kind:      domain.ActivityBranchSwitch,
			Branch:    snap.Branch,
			Message:   "Cambio de rama: " + prevBranch + " → " + snap.Branch,
		})
		return
	}
	w.recorder.Record(ctx, domain.ActivityEvent{
		ProjectID: projectID,
		Kind:      domain.ActivityGitChange,
		Branch:    snap.Branch,
		Additions: snap.Additions,
		Deletions: snap.Deletions,
		Files:     len(snap.Files),
		Message:   summarize(snap),
	})
}

// ── Operaciones de gobierno del repo ─────────────────────────────

func (w *Watcher) Commit(ctx context.Context, path, message string) error {
	if _, err := runGit(ctx, path, "add", "-A"); err != nil {
		return err
	}
	_, err := runGit(ctx, path, "commit", "-m", message)
	return err
}

func (w *Watcher) Stash(ctx context.Context, path string) error {
	_, err := runGit(ctx, path, "stash", "push", "-u")
	return err
}

func (w *Watcher) Branches(ctx context.Context, path string) (*domain.GitBranches, error) {
	out, err := runGit(ctx, path, "branch", "--format=%(refname:short)")
	if err != nil {
		return nil, err
	}
	br := &domain.GitBranches{Current: currentBranch(ctx, path)}
	for line := range strings.Lines(strings.TrimRight(string(out), "\n")) {
		if name := strings.TrimSpace(line); name != "" {
			br.Local = append(br.Local, name)
		}
	}
	return br, nil
}

func (w *Watcher) Checkout(ctx context.Context, path, branch string, create bool) error {
	args := []string{"checkout"}
	if create {
		args = append(args, "-b")
	}
	args = append(args, branch)
	_, err := runGit(ctx, path, args...)
	return err
}

func (w *Watcher) Discard(ctx context.Context, path, file string) error {
	if file == "" {
		if _, err := runGit(ctx, path, "reset", "--hard", "HEAD"); err != nil {
			return err
		}
		_, err := runGit(ctx, path, "clean", "-fd")
		return err
	}
	// Archivo concreto: revertir si está trazado; si es untracked, limpiarlo.
	if _, err := runGit(ctx, path, "checkout", "HEAD", "--", file); err != nil {
		if _, cerr := runGit(ctx, path, "clean", "-fd", "--", file); cerr != nil {
			return err
		}
	}
	return nil
}

func (w *Watcher) Take(ctx context.Context, path string) (*domain.GitSnapshot, error) {
	diff, err := runGit(ctx, path, "diff", "HEAD")
	if err != nil {
		diff, err = runGit(ctx, path, "diff")
		if err != nil {
			return nil, err
		}
	}
	numstat, _ := runGit(ctx, path, "diff", "HEAD", "--numstat")
	status, _ := runGit(ctx, path, "status", "--porcelain")

	snap := &domain.GitSnapshot{Diff: string(diff), UpdatedAt: time.Now().UTC()}
	snap.Branch = currentBranch(ctx, path)
	stats := parseNumstat(numstat)

	for line := range strings.Lines(strings.TrimRight(string(status), "\n")) {
		line = strings.TrimRight(line, "\n")
		if len(line) < 4 {
			continue
		}
		st := strings.TrimSpace(line[:2])
		p := strings.TrimSpace(line[3:])
		if i := strings.Index(p, " -> "); i >= 0 {
			p = p[i+4:]
		}
		fs := domain.FileStat{Path: p, Status: st}
		if n, ok := stats[p]; ok {
			fs.Additions, fs.Deletions = n[0], n[1]
		}
		snap.Files = append(snap.Files, fs)
		snap.Additions += fs.Additions
		snap.Deletions += fs.Deletions
	}
	return snap, nil
}

func (w *Watcher) TakeFile(ctx context.Context, dir, file string) (string, error) {
	out, err := runGit(ctx, dir, "diff", "HEAD", "--", file)
	if err != nil {
		out, err = runGit(ctx, dir, "diff", "--", file)
		if err != nil {
			return "", err
		}
	}
	if len(bytes.TrimSpace(out)) > 0 {
		return string(out), nil
	}
	statusOut, _ := runGit(ctx, dir, "status", "--porcelain", "--", file)
	if strings.HasPrefix(strings.TrimSpace(string(statusOut)), "??") {
		if nout, err := runGitDiffOK(ctx, dir, "diff", "--no-index", "--", os.DevNull, file); err == nil {
			return string(nout), nil
		}
	}
	return string(out), nil
}

// ── Historial de commits ─────────────────────────────────────────

const defaultLogLimit = 100
const maxLogLimit = 500

// Log devuelve los últimos commits de la rama actual. Hace DOS pasadas baratas
// (solo metadata, sin contenido de diff) porque git no combina --numstat con
// --name-status: la primera trae conteos (+/−) por archivo, la segunda el
// estado (M/A/D/R). Se fusionan por (hash, ruta). Los registros van separados
// por \x1e y los campos por \x1f para que el parseo no choque con el contenido.
func (w *Watcher) Log(ctx context.Context, path string, limit int) ([]domain.Commit, error) {
	if limit <= 0 || limit > maxLogLimit {
		limit = defaultLogLimit
	}
	n := strconv.Itoa(limit)

	out, err := runGit(ctx, path, "log", "-n", n, "--numstat",
		"--pretty=format:%x1e%H%x1f%h%x1f%an%x1f%aI%x1f%s")
	if err != nil {
		return nil, err
	}
	statusOut, _ := runGit(ctx, path, "log", "-n", n, "--name-status",
		"--pretty=format:%x1e%H")
	statusByCommit := parseNameStatus(statusOut)

	var commits []domain.Commit
	for _, rec := range strings.Split(string(out), "\x1e") {
		rec = strings.TrimLeft(rec, "\n")
		if rec == "" {
			continue
		}
		lines := strings.Split(rec, "\n")
		fields := strings.Split(lines[0], "\x1f")
		if len(fields) < 5 {
			continue
		}
		c := domain.Commit{Hash: fields[0], ShortHash: fields[1], Author: fields[2], Subject: fields[4]}
		if t, perr := time.Parse(time.RFC3339, fields[3]); perr == nil {
			c.Date = t
		}
		statuses := statusByCommit[c.Hash]
		for _, ln := range lines[1:] {
			ln = strings.TrimRight(ln, "\r")
			if strings.TrimSpace(ln) == "" {
				continue
			}
			parts := strings.SplitN(ln, "\t", 3)
			if len(parts) < 3 {
				continue
			}
			add, _ := strconv.Atoi(parts[0]) // "-" (binario) → 0
			del, _ := strconv.Atoi(parts[1])
			p := normalizeRenamePath(parts[2])
			fs := domain.FileStat{Path: p, Status: statuses[p], Additions: add, Deletions: del}
			if fs.Status == "" {
				fs.Status = "M"
			}
			c.Files = append(c.Files, fs)
			c.Additions += add
			c.Deletions += del
		}
		commits = append(commits, c)
	}
	return commits, nil
}

// CommitDiff devuelve el diff unificado del commit. --format= suprime la
// cabecera del commit, dejando solo los "diff --git …" que el parser de la UI
// espera. runGitDiffOK tolera el exit code 1 (sin cambios, raro en un commit).
func (w *Watcher) CommitDiff(ctx context.Context, path, hash string) (string, error) {
	out, err := runGitDiffOK(ctx, path, "show", "--format=", "--no-color", hash)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// parseNameStatus mapea hash → (ruta → letra de estado) a partir de la salida
// de `git log --name-status`. En renombrados (R100 old new) se queda con el
// destino, que es lo que también produce normalizeRenamePath sobre numstat.
func parseNameStatus(out []byte) map[string]map[string]string {
	result := make(map[string]map[string]string)
	for _, rec := range strings.Split(string(out), "\x1e") {
		rec = strings.TrimLeft(rec, "\n")
		if rec == "" {
			continue
		}
		lines := strings.Split(rec, "\n")
		cur := make(map[string]string)
		result[strings.TrimSpace(lines[0])] = cur
		for _, ln := range lines[1:] {
			ln = strings.TrimRight(ln, "\r")
			if ln == "" {
				continue
			}
			parts := strings.Split(ln, "\t")
			if len(parts) < 2 || parts[0] == "" {
				continue
			}
			cur[parts[len(parts)-1]] = parts[0][:1] // M, A, D, R…
		}
	}
	return result
}

// normalizeRenamePath resuelve la ruta de destino de un renombrado tal como lo
// imprime numstat: "old => new" o "dir/{old => new}/file".
func normalizeRenamePath(p string) string {
	i := strings.Index(p, " => ")
	if i < 0 {
		return p
	}
	if l := strings.Index(p, "{"); l >= 0 {
		if r := strings.Index(p, "}"); r > l {
			mid := p[l+1 : r] // "old => new"
			newPart := mid
			if j := strings.Index(mid, " => "); j >= 0 {
				newPart = mid[j+4:]
			}
			return p[:l] + newPart + p[r+1:]
		}
	}
	return strings.TrimSpace(p[i+4:])
}

func runGitDiffOK(ctx context.Context, dir string, args ...string) ([]byte, error) {
	out, err := runGit(ctx, dir, args...)
	var ge *GitError
	if errors.As(err, &ge) {
		var xe *exec.ExitError
		if errors.As(ge.Err, &xe) && xe.ExitCode() == 1 {
			return out, nil
		}
	}
	return out, err
}

func parseNumstat(out []byte) map[string][2]int {
	stats := make(map[string][2]int)
	for line := range strings.Lines(strings.TrimRight(string(out), "\n")) {
		parts := strings.Fields(strings.TrimRight(line, "\n"))
		if len(parts) < 3 {
			continue
		}
		add, _ := strconv.Atoi(parts[0])
		del, _ := strconv.Atoi(parts[1])
		stats[parts[len(parts)-1]] = [2]int{add, del}
	}
	return stats
}

func runGit(ctx context.Context, dir string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return stdout.Bytes(), &GitError{Args: args, Stderr: stderr.String(), Err: err}
	}
	return stdout.Bytes(), nil
}

// GitError encapsula los errores del comando git.
type GitError struct {
	Args   []string
	Stderr string
	Err    error
}

func (e *GitError) Error() string {
	return "git " + strings.Join(e.Args, " ") + ": " + e.Err.Error() + ": " + strings.TrimSpace(e.Stderr)
}

func (e *GitError) Unwrap() error { return e.Err }

// Compile-time check: Watcher implementa domain.GitService.
var _ domain.GitService = (*Watcher)(nil)
