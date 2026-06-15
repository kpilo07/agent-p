// Panel de proyectos en modal: grid de tarjetas con forma de carpeta.
// La primera celda es el botón de "nuevo proyecto"; el resto, los proyectos
// registrados con sus indicadores (sesión activa, eventos sin leer).
import { useState } from 'react';
import { projectService } from '../../../core/use-cases/ProjectService';
import { useStore } from '../../../infrastructure/store/store';
import { AddProjectModal } from './AddProjectModal';
import { ModalShell } from '../ui/ModalShell';
import { IconClose, IconPlus } from '../ui/icons';

export function ProjectsModal() {
  const projects = useStore((s) => s.projects);
  const focusedId = useStore((s) => s.focusedId);
  const activeIds = useStore((s) => s.activeIds);
  const unread = useStore((s) => s.unread);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <ModalShell
        z="z-[800]"
        escapeDisabled={adding}
        onClose={() => useStore.getState().setProjectsModalOpen(false)}
      >
        {(requestClose) => (
          <div className="glass-panel flex max-h-[78vh] min-h-[440px] w-[880px] max-w-[94vw] min-w-[560px] flex-col overflow-hidden">
            <header className="flex items-center justify-between border-b border-[var(--border-secondary)] px-5 py-3">
              <div className="flex items-center gap-3">
                <span className="hud-label">Projects</span>
                <span className="hud-value">{projects.length}</span>
              </div>
              <button
                className="btn-tactical flex items-center justify-center p-1.5"
                onClick={requestClose}
              >
                <IconClose />
              </button>
            </header>

            <div className="styled-scrollbar grid min-h-0 flex-1 grid-cols-2 content-start gap-x-4 gap-y-6 overflow-y-auto p-6 pt-7 md:grid-cols-3 lg:grid-cols-4">
              {/* Botón de alta: siempre la primera carpeta del grid */}
              <button className="folder-card folder-card--add" onClick={() => setAdding(true)}>
                <IconPlus className="h-6 w-6" />
                <span className="hud-label mt-1">New project</span>
              </button>

              {projects.map((p) => {
                const isFocused = p.id === focusedId;
                const isActive = activeIds.includes(p.id);
                const pending = unread[p.id] ?? 0;
                return (
                  <button
                    key={p.id}
                    className={`folder-card ${isFocused ? 'folder-card--focused' : ''}`}
                    onClick={() => {
                      projectService.openProject(p.id);
                      requestClose();
                    }}
                    title={p.path}
                  >
                    {/* Indicadores en la esquina superior */}
                    <span className="absolute top-2.5 right-2.5 flex items-center gap-2">
                      {pending > 0 && !isFocused && (
                        <span className="notification-pulse notification-pulse--count">
                          {pending > 9 ? '9+' : pending}
                        </span>
                      )}
                      <span
                        className={
                          isActive
                            ? 'notification-pulse notification-pulse--green'
                            : 'inline-block h-[9px] w-[9px] rounded-full bg-[var(--bg-tertiary)]'
                        }
                        title={isActive ? 'Active session' : 'Inactive'}
                      />
                    </span>

                    <span
                      className={`block truncate font-mono text-[12px] font-semibold tracking-wide ${
                        isFocused ? 'text-gold' : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {p.name}
                    </span>
                    <span className="block truncate text-[9px] text-muted">{p.path}</span>
                    {p.cliCommand && (
                      <span className="gotham-tag gotham-tag--info mt-1.5 self-start">
                        {p.cliCommand}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </ModalShell>

      {/* Hermana de la shell (no hija): un ancestro con transform rompería su fixed */}
      {adding && <AddProjectModal onClose={() => setAdding(false)} />}
    </>
  );
}
