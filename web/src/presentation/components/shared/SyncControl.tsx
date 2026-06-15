// Control de sincronización con el remoto, en el StatusBar. Muestra el estado
// ahead/behind (↑/↓) respecto al upstream y abre un menú con Fetch / Pull /
// Push. Si la rama no tiene upstream, ofrece "Publish" (push -u en el primer
// envío). Tras cada operación refresca el snapshot para actualizar ↑/↓ al vuelo.
import { useState } from 'react';

import { apiClient as api } from '../../../infrastructure/api/ApiClient';
import { useStore } from '../../../infrastructure/store/store';
import { IconArrowDown, IconArrowUp, IconRefresh } from '../ui/icons';

type Op = 'fetch' | 'pull' | 'push';

interface SyncControlProps {
  projectId: string;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
}

export function SyncControl({ projectId, ahead, behind, hasUpstream }: SyncControlProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Op | null>(null);

  const run = async (op: Op, fn: () => Promise<void>, okMsg: string) => {
    if (busy) return;
    setBusy(op);
    try {
      await fn();
      api
        .getDiff(projectId)
        .then((snap) => useStore.getState().setGit(projectId, snap))
        .catch(() => {});
      useStore.getState().pushToast({ level: 'info', title: 'Git', message: okMsg });
      setOpen(false);
    } catch (err) {
      useStore.getState().pushToast({ level: 'error', title: 'Git', message: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const fetch = () => run('fetch', () => api.gitFetch(projectId), 'Fetched from remote');
  const pull = () => run('pull', () => api.gitPull(projectId), 'Pulled from remote');
  const push = () =>
    run('push', () => api.gitPush(projectId), hasUpstream ? 'Pushed to remote' : 'Branch published');

  const item = (
    label: string,
    hint: string,
    icon: React.ReactNode,
    onClick: () => void,
    op: Op,
    disabled = false,
  ) => (
    <button
      disabled={disabled || !!busy}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-[var(--hover-accent)] disabled:opacity-40"
    >
      <span className={`shrink-0 text-gold ${busy === op ? 'animate-spin' : ''}`}>{icon}</span>
      <span className="hud-value min-w-0 flex-1">{label}</span>
      {hint && <span className="shrink-0 font-mono text-[10px] text-muted">{hint}</span>}
    </button>
  );

  return (
    <div className="relative">
      <button
        className={`hud-label flex shrink-0 items-center gap-1.5 transition-colors hover:!text-[var(--text-primary)] ${
          open ? '!text-[var(--text-primary)]' : ''
        }`}
        onClick={() => setOpen((o) => !o)}
        title={
          hasUpstream
            ? `↑${ahead} ahead · ↓${behind} behind · click to sync`
            : 'No upstream · click to publish'
        }
      >
        <IconRefresh className={`h-3.5 w-3.5 shrink-0 ${busy ? 'animate-spin' : ''}`} />
        {hasUpstream ? (
          <span className="flex items-center gap-1.5 font-mono text-[10px]">
            <span className={ahead > 0 ? 'text-gold' : 'text-muted'}>↑{ahead}</span>
            <span className={behind > 0 ? 'text-gold' : 'text-muted'}>↓{behind}</span>
          </span>
        ) : (
          <span>Publish</span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="gotham-enter absolute bottom-7 left-0 z-50 w-48 overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] py-1">
            {item('Fetch', '--prune', <IconRefresh className="h-3.5 w-3.5" />, fetch, 'fetch')}
            {item(
              'Pull',
              hasUpstream ? `↓${behind}` : '',
              <IconArrowDown className="h-3.5 w-3.5" />,
              pull,
              'pull',
              !hasUpstream,
            )}
            {item(
              hasUpstream ? 'Push' : 'Publish',
              hasUpstream ? `↑${ahead}` : '',
              <IconArrowUp className="h-3.5 w-3.5" />,
              push,
              'push',
            )}
          </div>
        </>
      )}
    </div>
  );
}
