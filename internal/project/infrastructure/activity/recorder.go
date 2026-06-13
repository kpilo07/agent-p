// Package activity implementa domain.ActivityRecorder: persiste los eventos del
// timeline en el repositorio y los emite en vivo a la UI por el hub.
package activity

import (
	"context"
	"log/slog"

	"agent-p/internal/project/domain"
	"agent-p/internal/project/infrastructure/hub"
)

// Recorder persiste eventos de actividad y los difunde por WebSocket.
type Recorder struct {
	log  *slog.Logger
	repo domain.ActivityRepository
	hub  *hub.Hub
}

// New crea un Recorder.
func New(log *slog.Logger, repo domain.ActivityRepository, h *hub.Hub) *Recorder {
	return &Recorder{log: log, repo: repo, hub: h}
}

// Record persiste el evento y, si tiene éxito, lo emite a los clientes
// suscritos al proyecto para que el timeline se actualice en vivo.
func (r *Recorder) Record(ctx context.Context, ev domain.ActivityEvent) {
	saved, err := r.repo.CreateActivity(ctx, ev)
	if err != nil {
		r.log.Warn("activity record failed", "project", ev.ProjectID, "kind", ev.Kind, "err", err)
		return
	}
	r.hub.BroadcastProjectEvent(saved.ProjectID, hub.Events.Activity(saved.ProjectID, saved))
}

// Compile-time check.
var _ domain.ActivityRecorder = (*Recorder)(nil)
