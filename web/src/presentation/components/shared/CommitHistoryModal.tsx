// Historial de commits de la rama actual. A la izquierda, la lista de commits
// (asunto, autor, fecha, hash, +/−); al seleccionar uno, a la derecha se pide
// su diff bajo demanda (git show) y se reusa el acordeón de archivos del review
// (DiffFileList) para verlos modificados igual que en el diff general.
import { useEffect, useMemo, useState } from 'react';

import { apiClient as api } from '../../../infrastructure/api/ApiClient';
import { selectFocusedProject, useStore, type Commit, type GitSnapshot } from '../../../infrastructure/store/store';
import { DiffFileList } from './DiffView';
import { ModalShell } from '../ui/ModalShell';
import { IconClose, IconGitBranch, IconGitCommit, IconRefresh } from '../ui/icons';

const COMMIT_LIMIT = 100;

export function CommitHistoryModal() {
  const focused = useStore(selectFocusedProject);
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  // Caché de diffs ya pedidos (hash → diff textual): evita repetir git show.
  const [diffCache] = useState(() => new Map<string, string>());

  const loadCommits = () => {
    if (!focused) return;
    setCommits(null);
    api
      .getCommits(focused.id, COMMIT_LIMIT)
      .then((cs) => {
        setCommits(cs);
        if (cs.length > 0) select(cs[0].hash);
      })
      .catch((err) => {
        setCommits([]);
        useStore.getState().pushToast({
          level: 'error',
          title: 'History',
          message: (err as Error).message,
        });
      });
  };

  const select = (hash: string) => {
    if (!focused) return;
    setSelected(hash);
    const cached = diffCache.get(hash);
    if (cached !== undefined) {
      setDiff(cached);
      return;
    }
    setDiff(null);
    setDiffLoading(true);
    api
      .getCommitDiff(focused.id, hash)
      .then((d) => {
        diffCache.set(hash, d.diff);
        // Solo aplicamos si el commit seleccionado no cambió mientras llegaba.
        setSelected((cur) => {
          if (cur === hash) setDiff(d.diff);
          return cur;
        });
      })
      .catch((err) =>
        useStore.getState().pushToast({
          level: 'error',
          title: 'Commit diff',
          message: (err as Error).message,
        }),
      )
      .finally(() => setDiffLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadCommits, [focused?.id]);

  const selectedCommit = useMemo(
    () => commits?.find((c) => c.hash === selected) ?? null,
    [commits, selected],
  );

  // Snapshot sintético para reutilizar DiffFileList: el diff del commit + sus
  // archivos (estado y conteos vienen ya en la lista, del numstat/name-status).
  const snap = useMemo<GitSnapshot | undefined>(() => {
    if (!selectedCommit || diff === null) return undefined;
    return {
      branch: '',
      diff,
      files: selectedCommit.files,
      additions: selectedCommit.additions,
      deletions: selectedCommit.deletions,
      ahead: 0,
      behind: 0,
      hasUpstream: false,
      initial: false,
      updatedAt: selectedCommit.date,
    };
  }, [selectedCommit, diff]);

  if (!focused) return null;

  return (
    <ModalShell z="z-[800]" onClose={() => useStore.getState().setCommitHistoryOpen(false)}>
      {(requestClose) => (
        <div className="glass-panel flex h-[82vh] w-[1040px] max-w-[95vw] flex-col overflow-hidden">
          <header className="flex items-center justify-between gap-4 border-b border-[var(--border-secondary)] px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <IconGitCommit className="h-4 w-4 shrink-0 text-gold" />
              <span className="hud-label shrink-0">History</span>
              <span className="hud-value truncate">{focused.name}</span>
              {focused.path && commits && (
                <span className="hud-label shrink-0">· {commits.length} commits</span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                className="btn-tactical btn-tactical--cyan flex items-center justify-center p-1.5"
                onClick={loadCommits}
                title="Reload history"
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

          <div className="flex min-h-0 flex-1">
            {/* Lista de commits */}
            <aside className="styled-scrollbar w-80 shrink-0 overflow-y-auto border-r border-[var(--border-secondary)]">
              {commits === null ? (
                <CenteredLoader label="Loading history…" />
              ) : commits.length === 0 ? (
                <p className="hud-label px-4 py-4">No commits on this branch</p>
              ) : (
                commits.map((c) => (
                  <button
                    key={c.hash}
                    onClick={() => select(c.hash)}
                    className={`flex w-full flex-col gap-1 border-b border-[var(--border-secondary)] px-4 py-2.5 text-left transition-colors hover:bg-[var(--hover-accent)] ${
                      c.hash === selected ? 'bg-[var(--hover-accent)]' : ''
                    }`}
                  >
                    <span
                      className={`min-w-0 truncate text-[12px] ${
                        c.hash === selected ? 'text-gold' : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {c.subject}
                    </span>
                    <span className="flex items-center gap-2 font-mono text-[10px] text-muted">
                      <span className="text-secondary">{c.shortHash}</span>
                      <span className="truncate">{c.author}</span>
                      <span className="ml-auto shrink-0">{formatDate(c.date)}</span>
                    </span>
                    <span className="flex items-center gap-2 font-mono text-[10px] font-semibold">
                      <span className="hud-label">{c.files?.length ?? 0} files</span>
                      <span className="text-alert-green">+{c.additions}</span>
                      <span className="text-alert-red">−{c.deletions}</span>
                    </span>
                  </button>
                ))
              )}
            </aside>

            {/* Detalle: archivos del commit seleccionado */}
            <div className="styled-scrollbar min-h-0 flex-1 overflow-y-auto bg-[var(--bg-primary)]">
              {selectedCommit && (
                <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-5 py-2.5">
                  <IconGitBranch className="h-3.5 w-3.5 shrink-0 text-gold" />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-primary)]">
                    {selectedCommit.subject}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-secondary">
                    {selectedCommit.shortHash}
                  </span>
                </div>
              )}
              {diffLoading || (selected && diff === null) ? (
                <CenteredLoader label="Loading commit diff…" />
              ) : snap ? (
                <DiffFileList snap={snap} />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="hud-label">Select a commit to see its changes</p>
                </div>
              )}
            </div>
          </div>
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' });
}
