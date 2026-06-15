// Consola como herramienta: cada terminal vive en su modal. Se abre desde el
// grupo de consolas de la Toolbar y muestra ÚNICAMENTE la terminal
// seleccionada (focusedTermId); el PTY sigue vivo en el backend y el
// scrollback se repinta vía replay al abrir.
//
// Desde aquí se puede ANCLAR la terminal al Mapa Táctico (vive como nodo en el
// tablero en vez de en el modal). El render de la terminal (TerminalView) está
// desacoplado de la sesión, así que anclar = montar el mismo (projectId, termId)
// en otro contenedor sin perder nada.
import { useEffect } from 'react';

import { apiClient as api } from '../../../infrastructure/api/ApiClient';
import {
  AGENT_TERM_ID,
  selectFocusedProject,
  useStore,
  type PinnedTerm,
  type TermInfo,
} from '../../../infrastructure/store/store';
import { ModalShell } from '../ui/ModalShell';
import { TerminalView } from './TerminalView';
import { IconClose, IconPin, IconTerminal, IconTrash } from '../ui/icons';

const NO_TERMS: TermInfo[] = [];
const NO_PINS: PinnedTerm[] = [];

export function TerminalModal() {
  const focused = useStore(selectFocusedProject);
  const focusedTermId = useStore((s) => s.focusedTermId);
  const terminals = useStore((s) =>
    focused ? (s.terminals[focused.id] ?? NO_TERMS) : NO_TERMS,
  );
  const pinned = useStore((s) => (focused ? (s.pinnedTerms[focused.id] ?? NO_PINS) : NO_PINS));

  // El modal muestra SIEMPRE la terminal enfocada. No caemos al agente cuando la
  // enfocada aún no está en la lista: una terminal recién creada se enfoca antes
  // de que llegue su session_state por WS, y caer al agente la duplicaría (se vería
  // el agente en el modal y, si está anclado, también en el tablero). El backend
  // hace replay en cuanto el PTY está listo; y el cierre de un shell ya redirige el
  // foco al agente en el store (focusFix), así que aquí no hace falta ese fallback.
  const termId = focusedTermId;

  // Invariante: una terminal vive en UN solo sitio. Si la enfocada está anclada al
  // tablero, no la duplicamos en el modal — lo cerramos y dejamos su nodo.
  const isPinnedHere = pinned.some((p) => p.termId === termId);
  useEffect(() => {
    if (isPinnedHere) useStore.getState().setTerminalModalOpen(false);
  }, [isPinnedHere]);

  if (!focused || isPinnedHere) return null;

  const isAgent = termId === AGENT_TERM_ID;
  const title = isAgent
    ? focused.cliCommand || 'Agent'
    : (terminals.find((t) => t.id === termId)?.title ?? termId);

  const pinToBoard = () => {
    useStore.getState().pinTerm(focused.id, termId);
    useStore.getState().setTerminalModalOpen(false);
  };

  const closeShell = async () => {
    try {
      await api.closeTerminal(focused.id, termId);
      // El session_state del backend lo quita del grupo y devuelve el foco
      // al agente (focusFix del store).
    } catch (err) {
      useStore.getState().pushToast({
        level: 'error',
        title: 'Terminal',
        message: (err as Error).message,
      });
    }
  };

  return (
    <ModalShell z="z-[850]" onClose={() => useStore.getState().setTerminalModalOpen(false)}>
      {(requestClose) => (
        <div className="glass-panel flex h-[86vh] w-[1100px] max-w-[96vw] flex-col overflow-hidden">
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border-secondary)] px-5 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <IconTerminal className="h-4 w-4 shrink-0 text-gold" />
              <span className="hud-label shrink-0">{isAgent ? 'Agent' : 'Shell'}</span>
              <span className="hud-value truncate">{title}</span>
              <span className="hud-label truncate">· {focused.name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                className="btn-tactical btn-tactical--cyan flex items-center justify-center p-1.5"
                onClick={pinToBoard}
                title="Pin to board (Tactical Map)"
              >
                <IconPin className="h-3.5 w-3.5" />
              </button>
              {!isAgent && (
                <button
                  className="btn-tactical btn-tactical--danger flex items-center justify-center p-1.5"
                  onClick={closeShell}
                  title="Close this shell"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                className="btn-tactical flex items-center justify-center p-1.5"
                onClick={requestClose}
                title="Close window"
              >
                <IconClose />
              </button>
            </div>
          </header>
          <div className="relative min-h-0 flex-1">
            <TerminalView key={`${focused.id}:${termId}`} projectId={focused.id} termId={termId} />
          </div>
        </div>
      )}
    </ModalShell>
  );
}
