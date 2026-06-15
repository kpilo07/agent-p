// Modal del visor de git diff general (review). El acordeón de archivos y el
// renderizado de líneas viven en DiffView, compartidos con el FileViewerModal
// del Mapa Táctico. Incluye acciones de gobierno del repo sobre el trabajo del
// agente: commit, stash y descartar (todo o por archivo).
import { useState } from 'react';

import { apiClient as api } from '../../../infrastructure/api/ApiClient';
import { selectFocusedProject, useStore } from '../../../infrastructure/store/store';
import { DiffFileList } from './DiffView';
import { ModalShell } from '../ui/ModalShell';
import { IconArchive, IconClose, IconGitCommit, IconRefresh, IconTrash } from '../ui/icons';

export function DiffModal() {
  const focused = useStore(selectFocusedProject);
  const snap = useStore((s) => (focused ? s.git[focused.id] : undefined));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const dirty = (snap?.files?.length ?? 0) > 0;

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

  // Ejecuta una acción git con feedback y refresco del diff.
  const run = async (title: string, action: () => Promise<void>, okMsg: string) => {
    if (!focused || busy) return;
    setBusy(true);
    try {
      await action();
      useStore.getState().pushToast({ level: 'info', title, message: okMsg });
      refresh();
    } catch (err) {
      useStore.getState().pushToast({ level: 'error', title, message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const commit = () => {
    const msg = message.trim();
    if (!msg) return;
    run('Commit', () => api.gitCommit(focused!.id, msg), 'Commit created').then(() =>
      setMessage(''),
    );
  };

  const stash = () =>
    run('Stash', () => api.gitStash(focused!.id), 'Changes saved to stash');

  const discardAll = () => {
    if (!window.confirm('Discard ALL changes in the working tree? This cannot be undone.'))
      return;
    run('Discard', () => api.gitDiscard(focused!.id), 'Changes discarded');
  };

  const discardFile = (path: string) => {
    if (!window.confirm(`Discard the changes to "${path}"? This cannot be undone.`)) return;
    run('Discard', () => api.gitDiscard(focused!.id, path), `Discarded: ${path}`);
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
                  <span className="text-secondary">{snap.files?.length ?? 0} files</span>
                  <span className="text-alert-green">+{snap.additions}</span>
                  <span className="text-alert-red">−{snap.deletions}</span>
                </span>
              )}
              <button
                className="btn-tactical btn-tactical--cyan flex items-center justify-center p-1.5"
                onClick={refresh}
                title="Refresh diff"
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
            <DiffFileList snap={snap} onDiscardFile={dirty ? discardFile : undefined} />
          </div>

          {/* Barra de acciones de gobierno del repo */}
          <div className="flex items-center gap-2 border-t border-[var(--border-secondary)] px-5 py-2.5">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
              disabled={!dirty || busy}
              placeholder="Commit message…"
              className="min-w-0 flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1.5 font-mono text-[12px] text-[var(--text-primary)] placeholder:text-muted focus:border-gold focus:outline-none disabled:opacity-50"
            />
            <button
              className="btn-tactical flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 !text-alert-green disabled:opacity-40"
              onClick={commit}
              disabled={!dirty || busy || !message.trim()}
              title="git add -A && git commit"
            >
              <IconGitCommit className="h-4 w-4" /> <span className="hud-label">Commit</span>
            </button>
            <button
              className="btn-tactical btn-tactical--cyan flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 disabled:opacity-40"
              onClick={stash}
              disabled={!dirty || busy}
              title="git stash push -u"
            >
              <IconArchive className="h-4 w-4" /> <span className="hud-label">Stash</span>
            </button>
            <button
              className="btn-tactical btn-tactical--danger flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 disabled:opacity-40"
              onClick={discardAll}
              disabled={!dirty || busy}
              title="Discard all changes"
            >
              <IconTrash className="h-4 w-4" /> <span className="hud-label">Discard</span>
            </button>
          </div>

          {snap && (
            <footer className="border-t border-[var(--border-secondary)] px-5 py-1.5">
              <span className="hud-label">
                Updated {new Date(snap.updatedAt).toLocaleTimeString()} · live via WebSocket
              </span>
            </footer>
          )}
        </div>
      )}
    </ModalShell>
  );
}
