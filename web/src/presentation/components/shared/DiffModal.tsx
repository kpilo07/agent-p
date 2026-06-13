// Modal del visor de git diff general (review). El acordeón de archivos y el
// renderizado de líneas viven en DiffView, compartidos con el FileViewerModal
// del Mapa Táctico.
import { apiClient as api } from '../../infrastructure/api/ApiClient';
import { selectFocusedProject, useStore } from '../../infrastructure/store/store';
import { DiffFileList } from './DiffView';
import { ModalShell } from '../ui/ModalShell';
import { IconClose, IconRefresh } from '../ui/icons';

export function DiffModal() {
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
    <ModalShell z="z-[800]" onClose={() => useStore.getState().setDiffModalOpen(false)}>
      {(requestClose) => (
        <div className="glass-panel flex h-[82vh] w-[960px] max-w-[95vw] flex-col overflow-hidden">
          <header className="flex items-center justify-between gap-4 border-b border-[var(--border-secondary)] px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="hud-label shrink-0">Review</span>
              <span className="hud-value truncate">{focused.name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              {snap && (
                <span className="flex items-center gap-3 font-mono text-[10px] font-semibold">
                  <span className="text-secondary">{snap.files?.length ?? 0} archivos</span>
                  <span className="text-alert-green">+{snap.additions}</span>
                  <span className="text-alert-red">−{snap.deletions}</span>
                </span>
              )}
              <button
                className="btn-tactical btn-tactical--cyan flex items-center justify-center p-1.5"
                onClick={refresh}
                title="Refrescar diff"
              >
                <IconRefresh />
              </button>
              <button
                className="btn-tactical flex items-center justify-center p-1.5"
                onClick={requestClose}
              >
                <IconClose />
              </button>
            </div>
          </header>

          <div className="styled-scrollbar min-h-0 flex-1 overflow-y-auto">
            <DiffFileList snap={snap} />
          </div>

          {snap && (
            <footer className="border-t border-[var(--border-secondary)] px-5 py-1.5">
              <span className="hud-label">
                Actualizado {new Date(snap.updatedAt).toLocaleTimeString()} · en vivo vía WebSocket
              </span>
            </footer>
          )}
        </div>
      )}
    </ModalShell>
  );
}
