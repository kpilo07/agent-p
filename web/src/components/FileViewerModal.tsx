// Visor del archivo seleccionado en el Mapa Táctico: pestaña "Contenido"
// (el archivo completo con números de línea) y pestaña "Cambios" (su git
// diff individual con añadidos en verde y eliminados en rojo).
import { useEffect, useMemo, useState } from 'react';

import { api, type FileContent } from '../lib/api';
import { parseDiff } from '../lib/diff';
import { selectFocusedProject, useStore } from '../store/store';
import { DiffRows } from './DiffView';
import { ModalShell } from './ModalShell';
import { IconClose, IconFile, IconRefresh } from './icons';

type Tab = 'content' | 'diff';

export function FileViewerModal() {
  const focused = useStore(selectFocusedProject);
  const path = useStore((s) => s.selectedFile);
  // ¿Tiene cambios según git? Decide la pestaña inicial y el badge.
  const dirty = useStore(
    (s) =>
      !!focused && !!path && (s.git[focused.id]?.files ?? []).some((f) => f.path === path),
  );

  const [tab, setTab] = useState<Tab>(dirty ? 'diff' : 'content');
  const [file, setFile] = useState<FileContent | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    if (!focused || !path) return;
    setLoading(true);
    Promise.all([api.getFile(focused.id, path), api.getFileDiff(focused.id, path)])
      .then(([f, d]) => {
        setFile(f);
        setDiff(d.diff);
      })
      .catch((err) =>
        useStore.getState().pushToast({
          level: 'error',
          title: 'Visor de archivo',
          message: (err as Error).message,
        }),
      )
      .finally(() => setLoading(false));
  };

  useEffect(load, [focused?.id, path]);

  const diffRows = useMemo(
    () => (diff ? parseDiff(diff).flatMap((f) => f.rows) : []),
    [diff],
  );
  const lines = useMemo(() => (file?.content ? file.content.split('\n') : []), [file?.content]);

  if (!focused || !path) return null;

  const tabBtn = (t: Tab, label: string) => (
    <button
      className={`hud-label cursor-pointer rounded px-2.5 py-1 transition-colors ${
        tab === t
          ? 'bg-[var(--hover-accent)] !text-gold'
          : 'hover:bg-[var(--hover-accent)] hover:text-[var(--text-secondary)]'
      }`}
      onClick={() => setTab(t)}
    >
      {label}
    </button>
  );

  return (
    <ModalShell z="z-[900]" onClose={() => useStore.getState().setSelectedFile(null)}>
      {(requestClose) => (
        <div className="glass-panel flex h-[82vh] w-[920px] max-w-[95vw] flex-col overflow-hidden">
          <header className="flex items-center justify-between gap-4 border-b border-[var(--border-secondary)] px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <IconFile className="h-4 w-4 shrink-0 text-gold" />
              <span className="hud-value truncate">{path}</span>
              {dirty && <span className="gotham-tag gotham-tag--medium shrink-0">modificado</span>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {tabBtn('content', 'Contenido')}
              {tabBtn('diff', 'Cambios')}
              <span className="mx-1 h-4 w-px bg-[var(--border-secondary)]" />
              <button
                className="btn-tactical btn-tactical--cyan flex items-center justify-center p-1.5"
                onClick={load}
                title="Refrescar"
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

          <div className="styled-scrollbar min-h-0 flex-1 overflow-y-auto bg-[var(--bg-primary)]">
            {loading ? (
              <p className="hud-label px-5 py-4">Cargando archivo…</p>
            ) : tab === 'content' ? (
              <FileBody file={file} lines={lines} />
            ) : diffRows.length > 0 ? (
              <DiffRows rows={diffRows} />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="hud-label flex items-center gap-2">
                  <span className="notification-pulse notification-pulse--green" />
                  Sin cambios respecto a HEAD
                </p>
              </div>
            )}
          </div>

          {file && (
            <footer className="border-t border-[var(--border-secondary)] px-5 py-1.5">
              <span className="hud-label">
                {lines.length} líneas · {(file.size / 1024).toFixed(1)} KiB
                {file.truncated && ' · truncado a 1 MiB'}
              </span>
            </footer>
          )}
        </div>
      )}
    </ModalShell>
  );
}

function FileBody({ file, lines }: { file: FileContent | null; lines: string[] }) {
  if (!file || file.binary) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="hud-label">
          {file?.binary ? 'Archivo binario: sin vista previa' : 'No se pudo leer el archivo'}
        </p>
      </div>
    );
  }
  return (
    <div className="py-1">
      {lines.map((line, i) => (
        <div key={i} className="file-line">
          <span className="file-line__no">{i + 1}</span>
          <span className="file-line__text">{line || ' '}</span>
        </div>
      ))}
    </div>
  );
}
