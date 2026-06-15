// Selector de rama: convierte el indicador de rama del StatusBar en un menú
// para cambiar entre las ramas locales (la actual marcada). Si el texto del
// filtro no coincide con ninguna rama, ofrece crearla (git checkout -b).
//
// Tras el checkout refresca el snapshot de git al instante; el resto (árbol,
// diff, rama del StatusBar) lo propagan el watcher y los eventos fs_change.
import { useEffect, useState } from 'react';

import { apiClient as api } from '../../../infrastructure/api/ApiClient';
import { useStore, type GitBranches } from '../../../infrastructure/store/store';
import { IconCheck, IconChevronDown, IconGitBranch, IconPlus, IconSearch } from '../ui/icons';

export function BranchSwitcher({ projectId, current }: { projectId: string; current: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<GitBranches | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFilter('');
    setData(null);
    api
      .getBranches(projectId)
      .then(setData)
      .catch((err) => {
        setData({ current, local: [] });
        useStore.getState().pushToast({ level: 'error', title: 'Ramas', message: (err as Error).message });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const checkout = async (branch: string, create: boolean) => {
    if (busy || (!create && branch === current)) return;
    setBusy(true);
    try {
      await api.gitCheckout(projectId, branch, create);
      api
        .getDiff(projectId)
        .then((snap) => useStore.getState().setGit(projectId, snap))
        .catch(() => {});
      useStore.getState().pushToast({
        level: 'info',
        title: 'Rama',
        message: create ? `Rama creada y activa: ${branch}` : `Ahora en ${branch}`,
      });
      setOpen(false);
    } catch (err) {
      useStore.getState().pushToast({
        level: 'error',
        title: 'Cambiar de rama',
        message: (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  const branches = data?.local ?? [];
  const q = filter.trim();
  const filtered = q ? branches.filter((b) => b.toLowerCase().includes(q.toLowerCase())) : branches;
  const canCreate = q !== '' && !branches.includes(q);

  return (
    <div className="relative">
      <button
        className={`hud-label flex min-w-0 shrink items-center gap-1.5 transition-colors hover:!text-[var(--text-primary)] ${
          open ? '!text-[var(--text-primary)]' : ''
        }`}
        onClick={() => setOpen((o) => !o)}
        title={`Rama actual: ${current} · clic para cambiar`}
      >
        <IconGitBranch className="h-3.5 w-3.5 shrink-0 text-gold" />
        <span className="hud-value truncate">{current}</span>
        <IconChevronDown
          className={`h-3 w-3 shrink-0 transition-transform duration-200 ${open ? '' : 'rotate-180'}`}
        />
      </button>

      {open && (
        <>
          {/* Click-away */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="gotham-enter absolute bottom-7 left-0 z-50 w-64 overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
            <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-2.5 py-1.5">
              <IconSearch className="h-3.5 w-3.5 shrink-0 text-muted" />
              <input
                className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-[var(--text-primary)] placeholder:text-muted focus:outline-none"
                placeholder="Filtrar o crear rama…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canCreate) checkout(q, true);
                  else if (e.key === 'Escape') setOpen(false);
                }}
              />
            </div>

            <div className="styled-scrollbar max-h-64 overflow-y-auto py-1">
              {data === null ? (
                <p className="hud-label px-3 py-2">Cargando ramas…</p>
              ) : filtered.length === 0 && !canCreate ? (
                <p className="hud-label px-3 py-2">Sin ramas que coincidan</p>
              ) : (
                filtered.map((b) => {
                  const isCurrent = b === current;
                  return (
                    <button
                      key={b}
                      disabled={busy}
                      onClick={() => checkout(b, false)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--hover-accent)] disabled:opacity-50 ${
                        isCurrent ? 'bg-[var(--hover-accent)]' : ''
                      }`}
                      title={isCurrent ? 'Rama actual' : `Cambiar a ${b}`}
                    >
                      {isCurrent ? (
                        <IconCheck className="h-3.5 w-3.5 shrink-0 text-alert-green" />
                      ) : (
                        <IconGitBranch className="h-3.5 w-3.5 shrink-0 text-muted" />
                      )}
                      <span className={`hud-value min-w-0 flex-1 truncate ${isCurrent ? '!text-gold' : ''}`}>
                        {b}
                      </span>
                      {isCurrent && <span className="hud-label shrink-0">actual</span>}
                    </button>
                  );
                })
              )}

              {canCreate && (
                <button
                  disabled={busy}
                  onClick={() => checkout(q, true)}
                  className="flex w-full items-center gap-2 border-t border-[var(--border-primary)] px-3 py-1.5 text-left text-alert-green transition-colors hover:bg-[var(--hover-accent)] disabled:opacity-50"
                  title={`Crear y cambiar a ${q}`}
                >
                  <IconPlus className="h-3.5 w-3.5 shrink-0" />
                  <span className="hud-label min-w-0 flex-1 truncate">Crear rama «{q}»</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
