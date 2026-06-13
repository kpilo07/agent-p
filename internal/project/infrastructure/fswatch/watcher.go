// Package fswatch implementa domain.FSWatcher usando fsnotify. Vigila el árbol
// de archivos y emite eventos fs_change al hub cuando hay cambios en disco.
package fswatch

import (
	"context"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"agent-p/internal/project/infrastructure/hub"
)

var ignoredDirs = map[string]bool{".git": true, "node_modules": true}

const flushEvery = 300 * time.Millisecond

type watch struct {
	cancel context.CancelFunc
}

// Watcher implementa domain.FSWatcher usando fsnotify.
type Watcher struct {
	log *slog.Logger
	hub *hub.Hub

	mu      sync.Mutex
	watches map[string]*watch
}

// New crea un Watcher.
func New(log *slog.Logger, h *hub.Hub) *Watcher {
	return &Watcher{log: log, hub: h, watches: make(map[string]*watch)}
}

func (w *Watcher) Watch(ctx context.Context, projectID, root string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if _, ok := w.watches[projectID]; ok {
		return
	}
	wctx, cancel := context.WithCancel(ctx)
	w.watches[projectID] = &watch{cancel: cancel}
	go w.loop(wctx, projectID, root)
	w.log.Info("fs watch started", "project", projectID, "path", root)
}

func (w *Watcher) Unwatch(projectID string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if wt, ok := w.watches[projectID]; ok {
		wt.cancel()
		delete(w.watches, projectID)
		w.log.Info("fs watch stopped", "project", projectID)
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

func (w *Watcher) loop(ctx context.Context, projectID, root string) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		w.log.Warn("fsnotify unavailable", "project", projectID, "err", err)
		return
	}
	defer fsw.Close()

	addDirsRecursive(fsw, root)

	ticker := time.NewTicker(flushEvery)
	defer ticker.Stop()

	pending := map[string]string{}

	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-fsw.Events:
			if !ok {
				return
			}
			rel, err := filepath.Rel(root, ev.Name)
			if err != nil || isIgnored(rel) {
				continue
			}
			if ev.Op&^fsnotify.Chmod == 0 {
				continue
			}
			if ev.Op.Has(fsnotify.Create) {
				if info, err := os.Stat(ev.Name); err == nil && info.IsDir() {
					addDirsRecursive(fsw, ev.Name)
				}
			}
			key := filepath.ToSlash(rel)
			op := opString(ev.Op)
			if prev, ok := pending[key]; ok && prev != "write" && op == "write" {
				op = prev
			}
			pending[key] = op
		case err, ok := <-fsw.Errors:
			if !ok {
				return
			}
			w.log.Warn("fsnotify error", "project", projectID, "err", err)
		case <-ticker.C:
			for p, op := range pending {
				w.hub.BroadcastProjectEvent(projectID, hub.Events.FSChange(p, op))
			}
			clear(pending)
		}
	}
}

func addDirsRecursive(fsw *fsnotify.Watcher, root string) {
	filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil
		}
		if p != root && ignoredDirs[d.Name()] {
			return filepath.SkipDir
		}
		fsw.Add(p)
		return nil
	})
}

func isIgnored(rel string) bool {
	if rel == "." || strings.HasPrefix(rel, "..") {
		return true
	}
	for _, seg := range strings.Split(filepath.ToSlash(rel), "/") {
		if ignoredDirs[seg] {
			return true
		}
	}
	return false
}

func opString(op fsnotify.Op) string {
	switch {
	case op.Has(fsnotify.Remove):
		return "remove"
	case op.Has(fsnotify.Rename):
		return "rename"
	case op.Has(fsnotify.Create):
		return "create"
	default:
		return "write"
	}
}

// Compile-time check: Watcher implementa domain.FSWatcher.
var _ interface {
	Watch(ctx context.Context, projectID, root string)
	Unwatch(projectID string)
	UnwatchAll()
} = (*Watcher)(nil)
