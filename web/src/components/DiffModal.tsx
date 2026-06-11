// Modal del visor de git diff. Lista los archivos modificados como acordeón;
// al desplegar un archivo se muestra el cambio estilo editor: dos columnas de
// números de línea (antes/después) y resaltado de añadido/borrado.
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { selectFocusedProject, useStore } from '../store/store';
import { ModalShell } from './ModalShell';
import { IconChevronDown, IconChevronRight, IconClose, IconRefresh } from './icons';

// ── Parsing del diff unificado ──────────────────────────────────

type RowKind = 'add' | 'del' | 'ctx' | 'hunk';

interface DiffRow {
  kind: RowKind;
  oldNo?: number;
  newNo?: number;
  text: string;
}

interface DiffFile {
  path: string;
  rows: DiffRow[];
  additions: number;
  deletions: number;
}

function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const path = line.replace(/^diff --git a\/(.*) b\/.*$/, '$1');
      current = { path, rows: [], additions: 0, deletions: 0 };
      files.push(current);
      continue;
    }
    if (!current) continue;

    // Metadatos que no aportan en la vista de editor.
    if (
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename from') ||
      line.startsWith('rename to')
    ) {
      continue;
    }

    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
      if (m) {
        oldNo = parseInt(m[1], 10);
        newNo = parseInt(m[2], 10);
        current.rows.push({ kind: 'hunk', text: line });
      }
      continue;
    }

    if (line.startsWith('+')) {
      current.rows.push({ kind: 'add', newNo: newNo++, text: line.slice(1) });
      current.additions++;
    } else if (line.startsWith('-')) {
      current.rows.push({ kind: 'del', oldNo: oldNo++, text: line.slice(1) });
      current.deletions++;
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file"
      current.rows.push({ kind: 'hunk', text: line });
    } else {
      current.rows.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    }
  }
  return files;
}

function statusTag(status: string): { cls: string; label: string } {
  if (status.includes('?')) return { cls: 'gotham-tag--info', label: 'nuevo' };
  if (status.includes('D')) return { cls: 'gotham-tag--critical', label: 'borrado' };
  if (status.includes('A')) return { cls: 'gotham-tag--low', label: 'añadido' };
  if (status.includes('R')) return { cls: 'gotham-tag--medium', label: 'renombrado' };
  return { cls: 'gotham-tag--medium', label: 'modificado' };
}

// ── Componente ──────────────────────────────────────────────────

export function DiffModal() {
  const focused = useStore(selectFocusedProject);
  const snap = useStore((s) => (focused ? s.git[focused.id] : undefined));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const diffFiles = useMemo(() => (snap?.diff ? parseDiff(snap.diff) : []), [snap?.diff]);

  // Une el porcelain status (incluye untracked/binarios) con el diff textual.
  const allFiles = useMemo(() => {
    const byPath = new Map(diffFiles.map((f) => [f.path, f]));
    const merged = (snap?.files ?? []).map((f) => ({
      path: f.path,
      status: f.status,
      additions: byPath.get(f.path)?.additions ?? f.additions,
      deletions: byPath.get(f.path)?.deletions ?? f.deletions,
      rows: byPath.get(f.path)?.rows ?? [],
    }));
    // Archivos presentes en el diff pero no en el status (raro, pero posible).
    for (const df of diffFiles) {
      if (!merged.some((m) => m.path === df.path)) {
        merged.push({ ...df, status: 'M' });
      }
    }
    return merged;
  }, [diffFiles, snap?.files]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

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
                <span className="text-secondary">{allFiles.length} archivos</span>
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
          {allFiles.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <p className="hud-label flex items-center gap-2">
                <span className="notification-pulse notification-pulse--green" />
                Working tree limpio
              </p>
            </div>
          )}

          {allFiles.map((file) => {
            const isOpen = expanded.has(file.path);
            const tag = statusTag(file.status);
            return (
              <div key={file.path} className="border-b border-[var(--border-secondary)]">
                {/* Cabecera del acordeón */}
                <button
                  className="diff-file-header w-full cursor-pointer text-left hover:bg-[var(--hover-accent)]"
                  onClick={() => toggle(file.path)}
                >
                  {isOpen ? (
                    <IconChevronDown className="h-3.5 w-3.5 text-muted" />
                  ) : (
                    <IconChevronRight className="h-3.5 w-3.5 text-muted" />
                  )}
                  <span className={`gotham-tag ${tag.cls} shrink-0`}>{tag.label}</span>
                  <span className="min-w-0 flex-1 truncate">{file.path}</span>
                  <span className="shrink-0 font-mono text-[10px] font-semibold">
                    <span className="text-alert-green">+{file.additions}</span>{' '}
                    <span className="text-alert-red">−{file.deletions}</span>
                  </span>
                </button>

                {/* Cuerpo: diff estilo editor */}
                {isOpen && (
                  <div className="bg-[var(--bg-primary)]">
                    {file.rows.length === 0 ? (
                      <p className="hud-label px-12 py-3">
                        {file.status.includes('?')
                          ? 'Archivo nuevo sin seguimiento (sin diff hasta hacer git add)'
                          : 'Sin diff textual (binario o sin cambios de contenido)'}
                      </p>
                    ) : (
                      file.rows.map((row, i) =>
                        row.kind === 'hunk' ? (
                          <div key={i} className="diff-row diff-row--hunk">
                            <span className="diff-row__no" />
                            <span className="diff-row__no" />
                            <span className="diff-row__text">{row.text}</span>
                          </div>
                        ) : (
                          <div key={i} className={`diff-row diff-row--${row.kind}`}>
                            <span className="diff-row__no">{row.oldNo ?? ''}</span>
                            <span className="diff-row__no">{row.newNo ?? ''}</span>
                            <span className="diff-row__text">
                              <span className="diff-row__sign">
                                {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}
                              </span>
                              {row.text || ' '}
                            </span>
                          </div>
                        ),
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
