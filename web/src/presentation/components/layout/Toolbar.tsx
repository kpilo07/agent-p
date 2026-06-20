// Barra de herramientas flotante: minimalista y transparente — solo iconos
// fantasma a la derecha, centrados verticalmente. Panel de proyectos y
// herramientas del proyecto en foco (búsqueda, review, historial, actividad,
// tickets). Las consolas y agentes viven ahora en el sidebar izquierdo.
import { useStore } from '../../../infrastructure/store/store';
import {
  IconActivity,
  IconFolder,
  IconGitBranch,
  IconGitCommit,
  IconSearch,
  IconTextSearch,
  IconTicket,
} from '../ui/icons';

const ghostBtn =
  'relative flex items-center justify-center rounded-lg p-2 text-muted transition-all duration-200 hover:bg-[var(--hover-accent)] hover:text-gold';

export function Toolbar() {
  const focusedId = useStore((s) => s.focusedId);
  const unread = useStore((s) => s.unread);
  const snap = useStore((s) => (s.focusedId ? s.git[s.focusedId] : undefined));

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const dirty = (snap?.files?.length ?? 0) > 0;

  return (
    <div className="fixed top-1/2 right-4 z-40 flex -translate-y-1/2 flex-col items-center gap-1 rounded-lg border border-[var(--border-primary)] bg-[rgba(0,0,0,0.8)] p-1.5">
      {/* Panel de proyectos (el alta vive dentro del panel) */}
      <button
        className={ghostBtn}
        onClick={() => useStore.getState().setProjectsModalOpen(true)}
        title="Projects panel · Ctrl+P"
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
            title="Search files · Ctrl+K"
          >
            <IconSearch className="h-4.5 w-4.5" />
          </button>

          {/* Búsqueda de contenido (git grep) en el repositorio */}
          <button
            className={ghostBtn}
            onClick={() => useStore.getState().setContentSearchOpen(true)}
            title="Search in files · Ctrl+Shift+F"
          >
            <IconTextSearch className="h-4.5 w-4.5" />
          </button>

          {/* Review de cambios (git diff) */}
          <button
            className={ghostBtn}
            onClick={() => useStore.getState().setDiffModalOpen(true)}
            title={
              dirty && snap
                ? `Review · ${snap.files?.length ?? 0} files, +${snap.additions} −${snap.deletions}`
                : 'Review changes'
            }
          >
            <IconGitBranch className="h-4.5 w-4.5" />
            {dirty && (
              <span className="notification-pulse notification-pulse--gold absolute top-0.5 right-0.5 h-2 w-2" />
            )}
          </button>

          {/* Historial de commits de la rama actual */}
          <button
            className={ghostBtn}
            onClick={() => useStore.getState().setCommitHistoryOpen(true)}
            title="Commit history"
          >
            <IconGitCommit className="h-4.5 w-4.5" />
          </button>

          {/* Timeline de actividad del proyecto */}
          <button
            className={ghostBtn}
            onClick={() => useStore.getState().setActivityModalOpen(true)}
            title="Project activity"
          >
            <IconActivity className="h-4.5 w-4.5" />
          </button>

          {/* Tickets: redactar una tarea y lanzarla al agente */}
          <button
            className={ghostBtn}
            onClick={() => useStore.getState().setTicketsModalOpen(true)}
            title="Tickets · Ctrl+I"
          >
            <IconTicket className="h-4.5 w-4.5" />
          </button>
        </>
      )}
    </div>
  );
}
