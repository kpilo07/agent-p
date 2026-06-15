// Búsqueda de contenido (find in files): busca dentro del código del repo con
// git grep (vía /grep), con debounce. Los resultados se agrupan por archivo;
// ↑/↓ + Enter o clic abren el archivo en el FileViewerModal. Se invoca con
// Ctrl/⌘+Shift+F o desde el toolbar.
import { useEffect, useRef, useState } from 'react';

import { apiClient as api } from '../../../infrastructure/api/ApiClient';
import type { GrepMatch } from '../../../core/domain/project';
import { selectFocusedProject, useStore } from '../../../infrastructure/store/store';
import { BlendySeed, useBlendyModal } from '../ui/Blendy';
import { IconFile, IconTextSearch } from '../ui/icons';

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

export function ContentSearchModal() {
  const focused = useStore(selectFocusedProject);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<GrepMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { id, closing, requestClose } = useBlendyModal(() =>
    useStore.getState().setContentSearchOpen(false),
  );
  const close = requestClose;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Búsqueda con debounce: solo a partir de MIN_QUERY caracteres.
  useEffect(() => {
    if (!focused) return;
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setMatches([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      api
        .grep(focused.id, q)
        .then((m) => {
          setMatches(m);
          setSearched(true);
          setSel(0);
        })
        .catch((err) =>
          useStore.getState().pushToast({
            level: 'error',
            title: 'Search',
            message: (err as Error).message,
          }),
        )
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, focused?.id]);

  const openMatch = (path: string) => {
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
      setSel((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && matches[sel]) {
      openMatch(matches[sel].path);
    }
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
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
          <div className="flex h-fit max-h-[70vh] w-[620px] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-[var(--border-active)] bg-[var(--bg-secondary)]">
            <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border-primary)] px-4 py-3">
              <IconTextSearch className="h-4 w-4 shrink-0 text-muted" />
              <input
                ref={inputRef}
                className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                placeholder={`Search in ${focused.name} contents…`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <span className="hud-label shrink-0">{matches.length} match(es)</span>
            </div>

            <div ref={listRef} className="styled-scrollbar min-h-0 flex-1 overflow-y-auto py-1">
              {loading ? (
                <p className="hud-label px-4 py-3">Searching…</p>
              ) : query.trim().length < MIN_QUERY ? (
                <p className="hud-label px-4 py-3">Type at least {MIN_QUERY} characters</p>
              ) : matches.length === 0 ? (
                <p className="hud-label px-4 py-3">{searched ? 'No matches' : '…'}</p>
              ) : (
                matches.map((m, i) => {
                  const prev = matches[i - 1];
                  const showPath = !prev || prev.path !== m.path;
                  return (
                    <div key={`${m.path}:${m.line}:${i}`}>
                      {showPath && (
                        <div className="flex items-center gap-2 px-4 pb-0.5 pt-2 font-mono text-[10px] text-muted">
                          <IconFile className="h-3 w-3 shrink-0" />
                          <span className="min-w-0 truncate">{m.path}</span>
                        </div>
                      )}
                      <button
                        data-idx={i}
                        className={`flex w-full cursor-pointer items-center gap-3 px-4 py-1 text-left font-mono text-[11px] transition-colors ${
                          i === sel ? 'bg-[var(--hover-accent)]' : 'hover:bg-[var(--hover-accent)]'
                        }`}
                        onMouseEnter={() => setSel(i)}
                        onClick={() => openMatch(m.path)}
                        title={`${m.path}:${m.line}`}
                      >
                        <span className="w-10 shrink-0 text-right text-muted">{m.line}</span>
                        <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{m.text}</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <footer className="shrink-0 border-t border-[var(--border-primary)] px-4 py-1.5">
              <span className="hud-label">↑↓ navigate · Enter open · Esc close</span>
            </footer>
          </div>
        </div>
      </div>
    </>
  );
}
