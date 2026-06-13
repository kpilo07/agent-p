// Explorador de carpetas del servidor para registrar proyectos.
// Navega el árbol de directorios y solo permite SELECCIONAR carpetas que
// sean repositorios git (el backend lo vuelve a validar al crear).
import { useEffect, useState } from 'react';
import { apiClient as api } from '../../infrastructure/api/ApiClient';
import type { FsListing } from '../../core/domain/project';
import { useStore } from '../../infrastructure/store/store';
import { ModalShell } from '../ui/ModalShell';
import { IconArrowUpDir, IconClose, IconFolder, IconGitBranch } from '../ui/icons';

interface Props {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function DirBrowser({ initialPath, onSelect, onClose }: Props) {
  const [listing, setListing] = useState<FsListing | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (path?: string) => {
    setLoading(true);
    try {
      setListing(await api.browse(path));
    } catch (err) {
      if (path) {
        // Path inválido (p.ej. tecleado a mano): cae al home del usuario.
        return load(undefined);
      }
      useStore.getState().pushToast({
        level: 'error',
        title: 'Explorador',
        message: (err as Error).message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(initialPath || undefined);
  }, []);

  return (
    <ModalShell z="z-[900]" onClose={onClose}>
      {(requestClose) => (
        <div className="glass-panel flex max-h-[70vh] w-[520px] max-w-[92vw] flex-col overflow-hidden">
          <header className="flex items-center justify-between gap-3 border-b border-[var(--border-secondary)] px-4 py-3">
            <span className="hud-label shrink-0">Explorar carpetas</span>
            <span className="hud-value min-w-0 flex-1 truncate text-right" title={listing?.path}>
              {listing?.path ?? '…'}
            </span>
            <button
              className="btn-tactical flex items-center justify-center p-1.5"
              onClick={requestClose}
            >
              <IconClose />
            </button>
          </header>

          <div className="styled-scrollbar min-h-48 flex-1 overflow-y-auto p-2">
            {listing?.parent && (
              <button
                className="mb-1 flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-left font-mono text-[11px] text-secondary transition-all hover:border-[var(--border-secondary)] hover:bg-[var(--hover-accent)]"
                onClick={() => load(listing.parent)}
              >
                <IconArrowUpDir className="h-4 w-4 text-muted" /> ..
              </button>
            )}

            {loading && <p className="hud-label px-3 py-4">Cargando…</p>}

            {!loading && listing?.entries.length === 0 && (
              <p className="hud-label px-3 py-4">Sin subcarpetas visibles</p>
            )}

            {!loading &&
              listing?.entries.map((entry) => (
                <div
                  key={entry.path}
                  className="group mb-1 flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2 transition-all hover:border-[var(--border-secondary)] hover:bg-[var(--hover-accent)]"
                >
                  <button
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                    onClick={() => load(entry.path)}
                    title={`Entrar en ${entry.name}`}
                  >
                    <IconFolder
                      className={`h-4 w-4 ${entry.isGitRepo ? 'text-gold' : 'text-muted'}`}
                    />
                    <span className="truncate font-mono text-[11px] text-[var(--text-primary)]">
                      {entry.name}
                    </span>
                    {entry.isGitRepo && (
                      <span className="gotham-tag gotham-tag--medium">
                        <IconGitBranch className="h-3 w-3" /> git
                      </span>
                    )}
                  </button>
                  {entry.isGitRepo && (
                    <button
                      className="btn-tactical btn-tactical--cyan shrink-0 px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => onSelect(entry.path)}
                    >
                      Seleccionar
                    </button>
                  )}
                </div>
              ))}
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-[var(--border-secondary)] px-4 py-3">
            <span className="hud-label">
              {listing?.isGitRepo ? (
                <span className="flex items-center gap-2">
                  <span className="notification-pulse notification-pulse--green" />
                  Repositorio git válido
                </span>
              ) : (
                'Solo se pueden registrar repositorios git'
              )}
            </span>
            <button
              className="btn-tactical shrink-0"
              disabled={!listing?.isGitRepo}
              onClick={() => listing && onSelect(listing.path)}
            >
              Usar esta carpeta
            </button>
          </footer>
        </div>
      )}
    </ModalShell>
  );
}
