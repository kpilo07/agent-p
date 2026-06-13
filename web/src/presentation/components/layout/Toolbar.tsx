// Barra de herramientas flotante: minimalista y transparente — solo iconos
// fantasma a la derecha, centrados verticalmente. Panel de proyectos,
// herramientas del proyecto en foco (review/nueva terminal) y el grupo de
// consolas abiertas (agente + shells). El cambio de proyecto vive en el menú
// de la StatusBar (esquina inferior derecha).
import { apiClient as api } from '../../infrastructure/api/ApiClient';
import { AGENT_TERM_ID, useStore, type TermInfo } from '../../infrastructure/store/store';
import { IconFolder, IconGitBranch, IconPlus, IconSearch, IconTerminal } from '../ui/icons';

const ghostBtn =
  'relative flex items-center justify-center rounded-lg p-2 text-muted transition-all duration-200 hover:bg-[var(--hover-accent)] hover:text-gold';

// Referencia estable para el selector (evita re-renders en bucle).
const NO_TERMS: TermInfo[] = [];

export function Toolbar() {
  const focusedId = useStore((s) => s.focusedId);
  const unread = useStore((s) => s.unread);
  const focusedTermId = useStore((s) => s.focusedTermId);
  const snap = useStore((s) => (s.focusedId ? s.git[s.focusedId] : undefined));
  const terminals = useStore((s) =>
    s.focusedId ? (s.terminals[s.focusedId] ?? NO_TERMS) : NO_TERMS,
  );

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const dirty = (snap?.files?.length ?? 0) > 0;

  // Clic en una consola del grupo: pasa a ser LA terminal visible en su modal.
  const openTerm = (termId: string) => {
    useStore.getState().focusTerm(termId);
    useStore.getState().setTerminalModalOpen(true);
  };

  const newTerminal = async () => {
    if (!focusedId) return;
    try {
      // El session_state del backend la añade al grupo; aquí la enfocamos
      // para que aparezca de inmediato.
      const t = await api.createTerminal(focusedId);
      openTerm(t.id);
    } catch (err) {
      useStore.getState().pushToast({
        level: 'error',
        title: 'Terminal',
        message: (err as Error).message,
      });
    }
  };

  return (
    <div className="fixed top-1/2 right-4 z-40 flex -translate-y-1/2 flex-col items-center gap-1 rounded-lg border border-[var(--border-primary)] bg-[rgba(0,0,0,0.8)] p-1.5">
      {/* Panel de proyectos (el alta vive dentro del panel) */}
      <button
        className={ghostBtn}
        onClick={() => useStore.getState().setProjectsModalOpen(true)}
        title="Panel de proyectos"
      >
        <IconFolder className="h-4.5 w-4.5" />
        {totalUnread > 0 && (
          <span className="notification-pulse notification-pulse--count absolute -top-0.5 -right-0.5">
            {totalUnread > 9 ? '9+' : totalUnread}
          </span>
        )}
      </button>

      {focusedId && (
        <>
          {/* Buscador de archivos del repositorio (Ctrl/⌘+K) */}
          <button
            className={ghostBtn}
            onClick={() => useStore.getState().setSearchOpen(true)}
            title="Buscar archivos · Ctrl+K"
          >
            <IconSearch className="h-4.5 w-4.5" />
          </button>

          {/* Review de cambios (git diff) */}
          <button
            className={ghostBtn}
            onClick={() => useStore.getState().setDiffModalOpen(true)}
            title={
              dirty && snap
                ? `Review · ${snap.files?.length ?? 0} archivos, +${snap.additions} −${snap.deletions}`
                : 'Review de cambios'
            }
          >
            <IconGitBranch className="h-4.5 w-4.5" />
            {dirty && (
              <span className="notification-pulse notification-pulse--gold absolute top-0.5 right-0.5 h-2 w-2" />
            )}
          </button>

          {/* Nueva consola en el grupo */}
          <button className={ghostBtn} onClick={newTerminal} title="Nueva terminal">
            <IconPlus className="h-4.5 w-4.5" />
          </button>

          {/* Consolas abiertas, agrupadas */}
          {terminals.length > 0 && (
            <>
              <span className="my-1 h-px w-4 bg-[var(--border-primary)]" />
              {terminals.map((t, i) => (
                <button
                  key={t.id}
                  className={`${ghostBtn} ${
                    t.id === focusedTermId ? 'bg-[var(--hover-accent)] !text-gold' : ''
                  }`}
                  onClick={() => openTerm(t.id)}
                  title={t.id === AGENT_TERM_ID ? `Agente · ${t.title}` : t.title}
                >
                  <IconTerminal className="h-4.5 w-4.5" />
                  <span className="absolute right-0.5 -bottom-0.5 font-mono text-[8px] font-bold text-secondary">
                    {t.id === AGENT_TERM_ID ? 'A' : i}
                  </span>
                </button>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
