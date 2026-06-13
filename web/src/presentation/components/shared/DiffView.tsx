// Piezas de renderizado de diffs compartidas: DiffRows pinta las filas de un
// archivo (añadido en verde, borrado en rojo); DiffFileList es el acordeón de
// archivos modificados que usa la modal de review.
import { useMemo, useState } from 'react';

import { diffService } from '../../core/use-cases/DiffService';
import type { DiffRow } from '../../core/domain/diff';

const parseDiff = (diff: string) => diffService.parseDiff(diff);
const statusTag = (status: string) => diffService.statusTag(status);
import type { GitSnapshot } from '../../infrastructure/store/store';
import { IconChevronDown, IconChevronRight } from '../ui/icons';

// ── Filas de un archivo ─────────────────────────────────────────

export function DiffRows({ rows }: { rows: DiffRow[] }) {
  return (
    <>
      {rows.map((row, i) =>
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
      )}
    </>
  );
}

// ── Acordeón de archivos del snapshot ───────────────────────────

export function DiffFileList({ snap }: { snap?: GitSnapshot }) {
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

  if (allFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="hud-label flex items-center gap-2">
          <span className="notification-pulse notification-pulse--green" />
          Working tree limpio
        </p>
      </div>
    );
  }

  return (
    <>
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
                  <DiffRows rows={file.rows} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
