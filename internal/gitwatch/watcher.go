// Package gitwatch vigila concurrentemente los repositorios de los proyectos
// abiertos. Cuando el `git diff` de un proyecto cambia, difunde el snapshot a
// sus suscriptores y una notificación global para los proyectos en segundo
// plano.
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

	"agent-p/internal/hub"
)

// FileStat resume el estado de un archivo dentro del diff.
type FileStat struct {
	Path      string `json:"path"`
	Status    string `json:"status"` // M, A, D, R, ?? (untracked)…
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

// Snapshot es el estado de git de un proyecto en un instante.
type Snapshot struct {
	Diff      string     `json:"diff"`
	Files     []FileStat `json:"files"`
	Additions int        `json:"additions"`
	Deletions int        `json:"deletions"`
	Initial   bool       `json:"initial"` // primera lectura: no notificar
	UpdatedAt time.Time  `json:"updatedAt"`
}

type watch struct {
	cancel context.CancelFunc
}

// Watcher lanza una goroutine de sondeo por proyecto vigilado.
type Watcher struct {
	log      *slog.Logger
	hub      *hub.Hub
	interval time.Duration

	mu      sync.Mutex
	watches map[string]*watch
}

func New(log *slog.Logger, h *hub.Hub, interval time.Duration) *Watcher {
	if interval <= 0 {
		interval = 2 * time.Second
	}
	return &Watcher{log: log, hub: h, interval: interval, watches: make(map[string]*watch)}
}

// Watch comienza a vigilar el repositorio del proyecto. Idempotente.
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

// Unwatch detiene la vigilancia del proyecto.
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
		snap, err := Take(ctx, path)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			w.log.Warn("git snapshot failed", "project", projectID, "err", err)
		} else {
			hash := snap.hash()
			if hash != lastHash {
				lastHash = hash
				snap.Initial = first

				// El snapshot completo solo viaja a los suscriptores del proyecto.
				w.hub.BroadcastProject(projectID, hub.Event{
					Type:    hub.EventGitUpdate,
					Payload: snap,
				})

				// La alerta ligera viaja a TODOS: la UI decide mostrar toast y
				// badge si el proyecto está en segundo plano.
				if !first {
					w.hub.BroadcastGlobal(hub.Event{
						Type:      hub.EventNotification,
						ProjectID: projectID,
						Payload: map[string]any{
							"level":     "git",
							"project":   name,
							"message":   summarize(snap),
							"files":     len(snap.Files),
							"additions": snap.Additions,
							"deletions": snap.Deletions,
						},
					})
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

func (s *Snapshot) hash() [32]byte {
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

func summarize(s *Snapshot) string {
	return "Working tree modificado: " + strconv.Itoa(len(s.Files)) + " archivo(s), +" +
		strconv.Itoa(s.Additions) + " / -" + strconv.Itoa(s.Deletions)
}

// ── Lectura de git (también usada por la API REST bajo demanda) ──

// Take captura el estado actual del repositorio en path.
func Take(ctx context.Context, path string) (*Snapshot, error) {
	diff, err := runGit(ctx, path, "diff", "HEAD")
	if err != nil {
		// Repos sin commits aún no tienen HEAD: cae al diff del index.
		diff, err = runGit(ctx, path, "diff")
		if err != nil {
			return nil, err
		}
	}

	numstat, _ := runGit(ctx, path, "diff", "HEAD", "--numstat")
	status, _ := runGit(ctx, path, "status", "--porcelain")

	snap := &Snapshot{Diff: string(diff), UpdatedAt: time.Now().UTC()}
	stats := parseNumstat(numstat)

	for line := range strings.Lines(strings.TrimRight(string(status), "\n")) {
		line = strings.TrimRight(line, "\n")
		if len(line) < 4 {
			continue
		}
		st := strings.TrimSpace(line[:2])
		p := strings.TrimSpace(line[3:])
		// "old -> new" en renames: nos quedamos con el destino.
		if i := strings.Index(p, " -> "); i >= 0 {
			p = p[i+4:]
		}
		fs := FileStat{Path: p, Status: st}
		if n, ok := stats[p]; ok {
			fs.Additions, fs.Deletions = n[0], n[1]
		}
		snap.Files = append(snap.Files, fs)
		snap.Additions += fs.Additions
		snap.Deletions += fs.Deletions
	}
	return snap, nil
}

// TakeFile devuelve el diff unificado de UN archivo del repositorio. Los
// archivos sin seguimiento (untracked) no aparecen en `git diff`, así que se
// comparan contra /dev/null para que también tengan diff textual en la UI.
func TakeFile(ctx context.Context, dir, file string) (string, error) {
	out, err := runGit(ctx, dir, "diff", "HEAD", "--", file)
	if err != nil {
		// Repos sin commits aún no tienen HEAD: cae al diff del index.
		out, err = runGit(ctx, dir, "diff", "--", file)
		if err != nil {
			return "", err
		}
	}
	if len(bytes.TrimSpace(out)) > 0 {
		return string(out), nil
	}

	status, _ := runGit(ctx, dir, "status", "--porcelain", "--", file)
	if strings.HasPrefix(strings.TrimSpace(string(status)), "??") {
		// `--no-index` sale con código 1 cuando HAY diferencias: no es error.
		if nout, err := runGitDiffOK(ctx, dir, "diff", "--no-index", "--", os.DevNull, file); err == nil {
			return string(nout), nil
		}
	}
	return string(out), nil
}

// runGitDiffOK ejecuta git tolerando el exit code 1 (convención de `git diff`
// para "hay diferencias").
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
		add, _ := strconv.Atoi(parts[0]) // "-" (binario) queda en 0
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
		// Devuelve también stdout: `git diff --no-index` produce salida útil
		// con exit code 1 y el caller decide si lo tolera.
		return stdout.Bytes(), &GitError{Args: args, Stderr: stderr.String(), Err: err}
	}
	return stdout.Bytes(), nil
}

type GitError struct {
	Args   []string
	Stderr string
	Err    error
}

func (e *GitError) Error() string {
	return "git " + strings.Join(e.Args, " ") + ": " + e.Err.Error() + ": " + strings.TrimSpace(e.Stderr)
}

func (e *GitError) Unwrap() error { return e.Err }
