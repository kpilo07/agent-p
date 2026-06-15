// Visor del archivo seleccionado en el Mapa Táctico. Pestañas:
//   · "Contenido" — el archivo completo con números de línea y sintaxis
//      resaltada; si es una imagen, la muestra incrustada.
//   · "Vista previa" — solo para Markdown: renderiza el .md como HTML.
//   · "Cambios" — su git diff individual (añadidos en verde, borrados en rojo).
import { marked } from 'marked';
import { useEffect, useMemo, useState } from 'react';

import { apiClient as api } from '../../../infrastructure/api/ApiClient';
import type { FileContent } from '../../../core/domain/project';
import { diffService } from '../../../core/use-cases/DiffService';
import { highlightService } from '../../../infrastructure/ui/HighlightService';

const parseDiff = (diff: string) => diffService.parseDiff(diff);
const highlightToLines = (code: string, path: string) => highlightService.highlightToLines(code, path);
const isImagePath = (path: string) => highlightService.isImagePath(path);
const isMarkdownPath = (path: string) => highlightService.isMarkdownPath(path);
import { selectFocusedProject, useStore } from '../../../infrastructure/store/store';
import { DiffRows } from './DiffView';
import { ModalShell } from '../ui/ModalShell';
import { IconClose, IconFile, IconRefresh } from '../ui/icons';

type Tab = 'content' | 'preview' | 'diff';

export function FileViewerModal() {
  const focused = useStore(selectFocusedProject);
  const path = useStore((s) => s.selectedFile);
  // ¿Tiene cambios según git? Decide la pestaña inicial y el badge.
  const dirty = useStore(
    (s) =>
      !!focused && !!path && (s.git[focused.id]?.files ?? []).some((f) => f.path === path),
  );

  const isImage = !!path && isImagePath(path);
  const isMarkdown = !!path && isMarkdownPath(path);

  // Markdown arranca en su preview; lo modificado en el diff; el resto en texto.
  const [tab, setTab] = useState<Tab>(
    dirty ? 'diff' : isMarkdown ? 'preview' : 'content',
  );
  const [file, setFile] = useState<FileContent | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    if (!focused || !path) return;
    setLoading(true);
    // Las imágenes se sirven por <img>; solo pedimos su diff (raro, pero
    // posible verlo marcado como modificado) y omitimos leer el contenido.
    const filePromise = isImage
      ? Promise.resolve(null)
      : api.getFile(focused.id, path);
    Promise.all([filePromise, api.getFileDiff(focused.id, path)])
      .then(([f, d]) => {
        setFile(f);
        setDiff(d.diff);
      })
      .catch((err) =>
        useStore.getState().pushToast({
          level: 'error',
          title: 'File viewer',
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
              {dirty && <span className="gotham-tag gotham-tag--medium shrink-0">modified</span>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isMarkdown && tabBtn('preview', 'Preview')}
              {tabBtn('content', isImage ? 'Image' : 'Content')}
              {tabBtn('diff', 'Changes')}
              <span className="mx-1 h-4 w-px bg-[var(--border-secondary)]" />
              <button
                className="btn-tactical btn-tactical--cyan flex items-center justify-center p-1.5"
                onClick={load}
                title="Refresh"
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
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="app-loader__bar">
                    <span />
                  </div>
                  <span className="hud-label">Loading file…</span>
                </div>
              </div>
            ) : tab === 'preview' ? (
              <MarkdownPreview source={file?.content ?? ''} />
            ) : tab === 'content' ? (
              isImage ? (
                <ImageBody src={api.rawFileURL(focused.id, path)} path={path} />
              ) : (
                <FileBody file={file} lines={lines} path={path} />
              )
            ) : diffRows.length > 0 ? (
              <DiffRows rows={diffRows} />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="hud-label flex items-center gap-2">
                  <span className="notification-pulse notification-pulse--green" />
                  No changes from HEAD
                </p>
              </div>
            )}
          </div>

          {(file || isImage) && (
            <footer className="border-t border-[var(--border-secondary)] px-5 py-1.5">
              <span className="hud-label">
                {isImage
                  ? 'Image'
                  : `${lines.length} lines · ${((file?.size ?? 0) / 1024).toFixed(1)} KiB${
                      file?.truncated ? ' · truncated to 1 MiB' : ''
                    }`}
              </span>
            </footer>
          )}
        </div>
      )}
    </ModalShell>
  );
}

function FileBody({
  file,
  lines,
  path,
}: {
  file: FileContent | null;
  lines: string[];
  path: string;
}) {
  // Resalta una sola vez por (contenido, ruta); cae a texto plano si falla.
  const html = useMemo(
    () => (file && !file.binary ? highlightToLines(file.content, path) : null),
    [file, path],
  );

  if (!file || file.binary) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="hud-label">
          {file?.binary ? 'Binary file: no preview' : 'Could not read the file'}
        </p>
      </div>
    );
  }
  return (
    <div className="hljs py-1">
      {lines.map((line, i) => (
        <div key={i} className="file-line">
          <span className="file-line__no">{i + 1}</span>
          {html ? (
            <span
              className="file-line__text"
              dangerouslySetInnerHTML={{ __html: html[i] || ' ' }}
            />
          ) : (
            <span className="file-line__text">{line || ' '}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function ImageBody({ src, path }: { src: string; path: string }) {
  const [error, setError] = useState(false);
  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="hud-label">Could not load the image</p>
      </div>
    );
  }
  return (
    <div className="file-image-wrap">
      <img src={src} alt={path} className="file-image" onError={() => setError(true)} />
    </div>
  );
}

function MarkdownPreview({ source }: { source: string }) {
  const html = useMemo(() => {
    try {
      return marked.parse(source, { async: false, gfm: true, breaks: false }) as string;
    } catch {
      return '';
    }
  }, [source]);

  if (!source.trim()) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="hud-label">Empty document</p>
      </div>
    );
  }
  return <div className="md-preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
