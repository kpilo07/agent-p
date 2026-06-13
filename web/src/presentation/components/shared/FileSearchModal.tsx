// Buscador de archivos (command palette, estilo ⌘K): input arriba-centrado,
// filtra los archivos del árbol del repositorio mientras escribes y permite
// navegar con ↑/↓ + Enter o con clic. Seleccionar un archivo lo abre en el
// FileViewerModal (contenido + cambios), exactamente igual que el clic en un
// nodo del mapa.
import { useEffect, useMemo, useRef, useState } from 'react';

import { apiClient as api } from '../../../infrastructure/api/ApiClient';
import type { TreeNode } from '../../../core/domain/project';
import { selectFocusedProject, useStore } from '../../../infrastructure/store/store';
import { BlendySeed, useBlendyModal } from '../ui/Blendy';
import { IconFile, IconSearch } from '../ui/icons';

interface FileEntry {
  path: string;
  name: string;
}

/** Aplana el árbol a la lista de archivos (solo archivos, sin carpetas). */
function flatten(node: TreeNode, out: FileEntry[] = []): FileEntry[] {
  for (const child of node.children ?? []) {
    if (child.dir) flatten(child, out);
    else out.push({ path: child.path, name: child.name });
  }
  return out;
}

/** Ranking simple: nombre que empieza igual > nombre que contiene > path. */
function score(entry: FileEntry, q: string): number {
  const name = entry.name.toLowerCase();
  const path = entry.path.toLowerCase();
  if (name.startsWith(q)) return 0;
  if (name.includes(q)) return 1;
  if (path.includes(q)) return 2;
  return -1;
}

const MAX_RESULTS = 50;

export function FileSearchModal() {
  const focused = useStore(selectFocusedProject);
  const snap = useStore((s) => (focused ? s.git[focused.id] : undefined));

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Cierre con transición Blendy (colapsa al centro) antes de desmontar.
  const { id, closing, requestClose } = useBlendyModal(() =>
    useStore.getState().setSearchOpen(false),
  );
  const close = requestClose;

  // Carga el árbol al abrir y enfoca el input.
  useEffect(() => {
    if (!focused) return;
    api
      .getTree(focused.id)
      .then((t) => setFiles(flatten(t)))
      .catch((err) =>
        useStore.getState().pushToast({
          level: 'error',
          title: 'Buscador',
          message: (err as Error).message,
        }),
      );
    inputRef.current?.focus();
  }, [focused?.id]);

  const gitByPath = useMemo(
    () => new Map((snap?.files ?? []).map((f) => [f.path, f])),
    [snap?.files],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Sin consulta: primero los archivos con cambios, luego el resto.
      const dirty = files.filter((f) => gitByPath.has(f.path));
      const rest = files.filter((f) => !gitByPath.has(f.path));
      return [...dirty, ...rest].slice(0, MAX_RESULTS);
    }
    return files
      .map((f) => ({ f, s: score(f, q) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => a.s - b.s || a.f.path.localeCompare(b.f.path))
      .slice(0, MAX_RESULTS)
      .map((r) => r.f);
  }, [files, query, gitByPath]);

  // La selección vuelve al inicio con cada consulta nueva.
  useEffect(() => setSel(0), [query]);

  const open = (path: string) => {
    if (!focused) return;
    close();
    useStore.getState().setSelectedFile(path);
    useStore.getState().clearFileAlert(focused.id, path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[sel]) {
      open(results[sel].path);
    }
  };

  // Mantiene la opción seleccionada a la vista al navegar con teclado.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${sel}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!focused) return null;

  return (
    <>
      <BlendySeed id={id} />
      <div
        className={`fixed inset-0 z-[860] flex items-center justify-center bg-black/70 p-6 ${
          closing ? 'modal-backdrop-out' : 'modal-backdrop-in'
        }`}
        onClick={close}
      >
        <div className="blendy-panel flex min-w-0" data-blendy-to={id} onClick={(e) => e.stopPropagation()}>
          {/* Blendy exige UN único wrapper dentro del elemento data-blendy-to */}
          <div className="flex h-fit max-h-[70vh] w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-[var(--border-active)] bg-[var(--bg-secondary)]">
            {/* Input */}
            <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border-primary)] px-4 py-3">
              <IconSearch className="h-4 w-4 shrink-0 text-muted" />
              <input
                ref={inputRef}
                className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                placeholder={`Buscar archivos en ${focused.name}…`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <span className="hud-label shrink-0">{results.length} resultado(s)</span>
            </div>

            {/* Resultados */}
            <div ref={listRef} className="styled-scrollbar min-h-0 flex-1 overflow-y-auto py-1">
              {results.length === 0 ? (
                <p className="hud-label px-4 py-3">
                  {files.length === 0 ? 'Escaneando repositorio…' : 'Sin coincidencias'}
                </p>
              ) : (
                results.map((f, i) => {
                  const stat = gitByPath.get(f.path);
                  const dir = f.path.slice(0, f.path.length - f.name.length);
                  return (
                    <button
                      key={f.path}
                      data-idx={i}
                      className={`flex w-full cursor-pointer items-center gap-2.5 px-4 py-1.5 text-left font-mono text-[11px] transition-colors ${
                        i === sel ? 'bg-[var(--hover-accent)]' : 'hover:bg-[var(--hover-accent)]'
                      }`}
                      onMouseEnter={() => setSel(i)}
                      onClick={() => open(f.path)}
                      title={f.path}
                    >
                      <IconFile
                        className={`h-3.5 w-3.5 shrink-0 ${stat ? 'text-gold' : 'text-muted'}`}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {dir && <span className="text-muted">{dir}</span>}
                        <span className="text-[var(--text-primary)]">{f.name}</span>
                      </span>
                      {stat && (
                        <span className="shrink-0 text-[9px] font-semibold">
                          <span className="text-alert-green">+{stat.additions}</span>{' '}
                          <span className="text-alert-red">−{stat.deletions}</span>
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            <footer className="shrink-0 border-t border-[var(--border-primary)] px-4 py-1.5">
              <span className="hud-label">↑↓ navegar · Enter abrir · Esc cerrar</span>
            </footer>
          </div>
        </div>
      </div>
    </>
  );
}
