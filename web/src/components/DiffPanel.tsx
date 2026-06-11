// Panel derecho del Modo Consola: el diff general del proyecto en foco,
// siempre visible y alimentado en vivo por los git_update del WebSocket.
// Reutiliza el mismo acordeón que la modal de review (DiffFileList).
import { api } from '../lib/api';
import { selectFocusedProject, useStore } from '../store/store';
import { DiffFileList } from './DiffView';
import { IconRefresh } from './icons';

export function DiffPanel() {
  const focused = useStore(selectFocusedProject);
  const snap = useStore((s) => (focused ? s.git[focused.id] : undefined));

  const refresh = () => {
    if (!focused) return;
    api
      .getDiff(focused.id)
      .then((s) => useStore.getState().setGit(focused.id, s))
      .catch((err) =>
        useStore.getState().pushToast({
          level: 'error',
          title: 'git diff',
          message: (err as Error).message,
        }),
      );
  };

  if (!focused) return null;

  return (
    <section className="glass-panel gotham-enter flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-secondary)] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="hud-label shrink-0">Cambios</span>
          <span className="hud-value truncate">{focused.name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {snap && (
            <span className="flex items-center gap-2 font-mono text-[10px] font-semibold">
              <span className="text-secondary">{snap.files?.length ?? 0}</span>
              <span className="text-alert-green">+{snap.additions}</span>
              <span className="text-alert-red">−{snap.deletions}</span>
            </span>
          )}
          <button
            className="btn-tactical btn-tactical--cyan flex items-center justify-center p-1.5"
            onClick={refresh}
            title="Refrescar diff"
          >
            <IconRefresh className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="styled-scrollbar min-h-0 flex-1 overflow-y-auto">
        <DiffFileList snap={snap} />
      </div>

      {snap && (
        <footer className="shrink-0 border-t border-[var(--border-secondary)] px-4 py-1.5">
          <span className="hud-label">
            Actualizado {new Date(snap.updatedAt).toLocaleTimeString()} · en vivo vía WebSocket
          </span>
        </footer>
      )}
    </section>
  );
}
