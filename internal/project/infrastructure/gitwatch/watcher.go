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
	interval time.Duration

	mu      sync.Mutex
	watches map[string]*watch
}

// New crea un Watcher.
func New(log *slog.Logger, h *hub.Hub, interval time.Duration) *Watcher {
	if interval <= 0 {
		interval = 2 * time.Second
	}
	return &Watcher{log: log, hub: h, interval: interval, watches: make(map[string]*watch)}
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
				}
			}
			first = false
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func snapHash(s *domain.GitSnapshot) [32]byte {
	h := sha256.New()
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
