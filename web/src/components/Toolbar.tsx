// Barra de herramientas flotante: minimalista y transparente — solo iconos
// fantasma a la derecha, centrados verticalmente. Panel de proyectos, review
// de cambios, nueva terminal y salto rápido entre proyectos activos.
import { api } from '../lib/api';
import { openProject } from '../lib/projects';
import { useStore } from '../store/store';
import { IconFolder, IconGitBranch, IconTerminal } from './icons';

const ghostBtn =
  'relative flex items-center justify-center rounded-lg p-2 text-muted transition-all duration-200 hover:bg-[var(--hover-accent)] hover:text-gold';

export function Toolbar() {
  const projects = useStore((s) => s.projects);
  const focusedId = useStore((s) => s.focusedId);
  const activeIds = useStore((s) => s.activeIds);
  const unread = useStore((s) => s.unread);
  const snap = useStore((s) => (s.focusedId ? s.git[s.focusedId] : undefined));

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const activeProjects = projects.filter((p) => activeIds.includes(p.id));
  const dirty = (snap?.files?.length ?? 0) > 0;

  const newTerminal = async () => {
    if (!focusedId) return;
    try {
      // El session_state del backend añade la tile al mosaico.
      await api.createTerminal(focusedId);
    } catch (err) {
      useStore.getState().pushToast({
        level: 'error',
        title: 'Terminal',
        message: (err as Error).message,
      });
    }
  };

  return (
    <div className="fixed top-1/2 right-4 z-40 flex -translate-y-1/2 flex-col items-center gap-1 rounded-xl border border-[var(--border-secondary)] bg-[rgba(8,10,20,0.45)] p-1.5 backdrop-blur-md">
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

          {/* Nueva terminal en el mosaico */}
          <button className={ghostBtn} onClick={newTerminal} title="Nueva terminal">
            <IconTerminal className="h-4.5 w-4.5" />
          </button>
        </>
      )}

      {/* Acceso rápido a los proyectos activos */}
      {activeProjects.length > 0 && (
        <>
          <span className="my-1 h-px w-4 bg-[var(--border-secondary)]" />
          {activeProjects.map((p) => {
            const isFocused = p.id === focusedId;
            const pending = unread[p.id] ?? 0;
            return (
              <button
                key={p.id}
                onClick={() => openProject(p.id)}
                title={`${p.name}${pending ? ` · ${pending} eventos` : ''}`}
                className={`relative flex h-8 w-8 items-center justify-center rounded-lg font-mono text-[12px] font-bold transition-all duration-200 ${
                  isFocused
                    ? 'bg-[var(--hover-accent)] text-gold'
                    : 'text-muted hover:bg-[var(--hover-accent)] hover:text-[var(--text-primary)]'
                }`}
              >
                {p.name.charAt(0).toUpperCase()}
                <span className="absolute right-0.5 bottom-0.5 inline-block h-1.5 w-1.5 rounded-full bg-alert-green shadow-[0_0_4px_rgba(0,230,118,0.6)]" />
                {pending > 0 && !isFocused && (
                  <span className="notification-pulse notification-pulse--count absolute -top-1 -right-1">
                    {pending > 9 ? '9+' : pending}
                  </span>
                )}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
