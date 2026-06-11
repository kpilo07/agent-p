// Package fswatch vigila el árbol de archivos de los proyectos abiertos con
// fsnotify. Cuando un archivo cambia en disco difunde un evento fs_change a
// los suscriptores del proyecto indicando el path relativo y la operación.
//
// Complementa a gitwatch: gitwatch sondea el diff completo; fswatch da la
// señal instantánea por archivo que alimenta el "Mapa Táctico" de la UI.
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

	"agent-p/internal/hub"
)

// Directorios que nunca se vigilan ni se reportan.
var ignoredDirs = map[string]bool{".git": true, "node_modules": true}

// Ventana de agregación: los editores y agentes escriben en ráfagas; un
// flush corto evita inundar el WebSocket sin perder inmediatez perceptible.
const flushEvery = 300 * time.Millisecond

type watch struct {
	cancel context.CancelFunc
}

// Watcher mantiene un vigilante de fsnotify por proyecto abierto.
type Watcher struct {
	log *slog.Logger
	hub *hub.Hub

	mu      sync.Mutex
	watches map[string]*watch
}

func New(log *slog.Logger, h *hub.Hub) *Watcher {
	return &Watcher{log: log, hub: h, watches: make(map[string]*watch)}
}

// Watch comienza a vigilar el árbol del proyecto. Idempotente.
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

// Unwatch detiene la vigilancia del proyecto.
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

	// path relativo → operación pendiente de difundir.
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
			// Chmod puro es ruido (touch, permisos): no aporta a la UI.
			if ev.Op&^fsnotify.Chmod == 0 {
				continue
			}
			// Los directorios creados durante la sesión también se vigilan.
			if ev.Op.Has(fsnotify.Create) {
				if info, err := os.Stat(ev.Name); err == nil && info.IsDir() {
					addDirsRecursive(fsw, ev.Name)
				}
			}
			// Create+Write llegan en ráfaga y se colapsan por path: una
			// operación estructural (create/remove/rename) nunca se degrada
			// a write, o la UI no recargaría el árbol.
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
				w.hub.BroadcastProject(projectID, hub.Event{
					Type:    hub.EventFSChange,
					Payload: map[string]any{"path": p, "op": op},
				})
			}
			clear(pending)
		}
	}
}

// addDirsRecursive registra root y todos sus subdirectorios no ignorados.
// fsnotify no es recursivo por sí mismo.
func addDirsRecursive(fsw *fsnotify.Watcher, root string) {
	filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil
		}
		if p != root && ignoredDirs[d.Name()] {
			return filepath.SkipDir
		}
		fsw.Add(p) // best-effort: un dir no legible no tumba el resto
		return nil
	})
}

// isIgnored descarta paths fuera del root o dentro de directorios ignorados.
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

// opString colapsa el bitmask de fsnotify a la operación más significativa.
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
