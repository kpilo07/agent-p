// Checkpoints: snapshots del working tree para revertir el trabajo del agente.
// Se crean automáticamente antes de cada tanda (lanzar ticket) y manualmente
// desde aquí. Restaurar deja el working tree idéntico al checkpoint; antes de
// hacerlo el backend crea un checkpoint de seguridad, así el revert es reversible.
import { useEffect, useState } from 'react';

import { apiClient as api } from '../../../infrastructure/api/ApiClient';
import { selectFocusedProject, useStore, type Checkpoint } from '../../../infrastructure/store/store';
import { ModalShell } from '../ui/ModalShell';
import { IconCheckpoint, IconClose, IconPlus, IconRefresh, IconTrash } from '../ui/icons';

export function CheckpointsModal() {
  const focused = useStore(selectFocusedProject);
  const [items, setItems] = useState<Checkpoint[] | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = () => {
    if (!focused) return;
    setItems(null);
    api
      .listCheckpoints(focused.id)
      .then(setItems)
      .catch((err) => {
        setItems([]);
        useStore.getState().pushToast({ level: 'error', title: 'Checkpoints', message: (err as Error).message });
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [focused?.id]);

  if (!focused) return null;
  const projectId = focused.id;

  const create = async () => {
    setBusy(true);
    try {
      await api.createCheckpoint(projectId, label.trim());
      setLabel('');
      load();
    } catch (err) {
      useStore.getState().pushToast({ level: 'error', title: 'Checkpoint', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const restore = async (cid: string) => {
    setBusy(true);
    setConfirmId(null);
    try {
      await api.restoreCheckpoint(projectId, cid);
      useStore.getState().pushToast({
        level: 'info',
        title: 'Checkpoint',
        message: 'Working tree restaurado · se guardó un checkpoint de seguridad',
      });
      useStore.getState().reloadMap();
      load();
    } catch (err) {
      useStore.getState().pushToast({ level: 'error', title: 'Restore', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (cid: string) => {
    try {
      await api.deleteCheckpoint(projectId, cid);
      setItems((cur) => cur?.filter((c) => c.id !== cid) ?? null);
    } catch (err) {
      useStore.getState().pushToast({ level: 'error', title: 'Checkpoint', message: (err as Error).message });
    }
  };

  return (
    <ModalShell z="z-[800]" onClose={() => useStore.getState().setCheckpointsOpen(false)}>
      {(requestClose) => (
        <div className="glass-panel flex h-[78vh] w-[640px] max-w-[95vw] flex-col overflow-hidden">
          <header className="flex items-center justify-between gap-4 border-b border-[var(--border-secondary)] px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <IconCheckpoint className="h-4 w-4 shrink-0 text-gold" />
              <span className="hud-label shrink-0">Checkpoints</span>
              <span className="hud-value truncate">{focused.name}</span>
              {items && <span className="hud-label shrink-0">· {items.length}</span>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                className="btn-tactical btn-tactical--cyan flex items-center justify-center p-1.5"
                onClick={load}
                title="Reload"
              >
                <IconRefresh />
              </button>
              <button className="btn-tactical flex items-center justify-center p-1.5" onClick={requestClose}>
                <IconClose />
              </button>
            </div>
          </header>

          {/* Crear checkpoint manual */}
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-secondary)] px-5 py-2.5">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && create()}
              placeholder="Etiqueta del checkpoint (opcional)…"
              className="min-w-0 flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--border-active)]"
            />
            <button
              className="btn-tactical btn-tactical--cyan flex shrink-0 items-center gap-1.5 px-3 py-1.5"
              onClick={create}
              disabled={busy}
              title="Crear checkpoint del estado actual"
            >
              <IconPlus className="h-3.5 w-3.5" />
              <span className="hud-label">Checkpoint</span>
            </button>
          </div>

          {/* Lista */}
          <div className="styled-scrollbar min-h-0 flex-1 overflow-y-auto bg-[var(--bg-primary)]">
            {items === null ? (
              <CenteredLoader label="Cargando checkpoints…" />
            ) : items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <IconCheckpoint className="h-8 w-8 text-muted opacity-40" />
                <p className="hud-label">Aún no hay checkpoints</p>
                <p className="text-[11px] text-muted">Se crean al lanzar un ticket o con el botón de arriba</p>
              </div>
            ) : (
              items.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 border-b border-[var(--border-secondary)] px-5 py-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-[12px] text-[var(--text-primary)]">{c.label}</span>
                      {c.auto && <span className="gotham-tag gotham-tag--low shrink-0">auto</span>}
                    </span>
                    <span className="flex items-center gap-2 font-mono text-[10px] text-muted">
                      <span>{formatRelative(c.createdAt)}</span>
                      <span className="text-[var(--border-active)]">·</span>
                      <span className="hud-label">{c.files} files</span>
                      <span className="text-alert-green">+{c.additions}</span>
                      <span className="text-alert-red">−{c.deletions}</span>
                    </span>
                  </div>

                  {confirmId === c.id ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        className="btn-tactical btn-tactical--danger px-2.5 py-1"
                        onClick={() => restore(c.id)}
                        disabled={busy}
                      >
                        <span className="hud-label">Confirmar</span>
                      </button>
                      <button className="btn-tactical px-2.5 py-1" onClick={() => setConfirmId(null)}>
                        <span className="hud-label">Cancelar</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        className="btn-tactical btn-tactical--cyan px-2.5 py-1"
                        onClick={() => setConfirmId(c.id)}
                        disabled={busy}
                        title="Restaurar el working tree a este checkpoint"
                      >
                        <span className="hud-label">Restaurar</span>
                      </button>
                      <button
                        className="btn-tactical flex items-center justify-center p-1.5 hover:!text-alert-red"
                        onClick={() => remove(c.id)}
                        title="Eliminar checkpoint"
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <footer className="shrink-0 border-t border-[var(--border-secondary)] px-5 py-2">
            <span className="hud-label">
              Restaurar deja el working tree idéntico al checkpoint · se guarda uno de seguridad antes
            </span>
          </footer>
        </div>
      )}
    </ModalShell>
  );
}

function CenteredLoader({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="app-loader__bar">
          <span />
        </div>
        <span className="hud-label">{label}</span>
      </div>
    </div>
  );
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.round(diff / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
