// Pantalla de inicio (sin proyecto en foco): el logo de AGENT-P y, debajo,
// accesos directos a los proyectos abiertos recientemente. Si no hay ninguno,
// invita a abrir el panel de proyectos.
import { useMemo } from 'react';

import { projectService } from '../../../core/use-cases/ProjectService';
import { pickRecentProjects, useStore } from '../../../infrastructure/store/store';
import { IconFolder, IconGitBranch } from '../ui/icons';
import { AgentLogo } from '../ui/AgentLogo';

export function Home() {
  // Nos suscribimos a las entradas ESTABLES y derivamos con useMemo: un
  // selector que devolviera un array nuevo en cada render dispararía el bucle
  // de actualización de Zustand (React #185).
  const projects = useStore((s) => s.projects);
  const recentIds = useStore((s) => s.recentIds);
  const activeIds = useStore((s) => s.activeIds);
  const recent = useMemo(() => pickRecentProjects(projects, recentIds), [projects, recentIds]);
  const hasProjects = projects.length > 0;

  return (
    <section className="glass-panel glass-panel--terminal gotham-enter relative h-full min-h-0 overflow-hidden">
      <div className="styled-scrollbar absolute inset-0 flex flex-col items-center justify-center gap-6 overflow-y-auto p-6">
        <div className="flex flex-col items-center gap-1">
          <AgentLogo />
          <span className="hud-text text-[18px] font-bold text-gold">P agent</span>
          <span className="hud-label">Git Ops Command Center</span>
        </div>

        {recent.length > 0 ? (
          <div className="flex w-full max-w-[560px] flex-col gap-2">
            <span className="hud-label px-1">Recent</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {recent.map((p) => {
                const active = activeIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    className="group flex cursor-pointer flex-col gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 text-left transition-all hover:border-[var(--border-active)] hover:bg-[var(--hover-accent)]"
                    onClick={() => projectService.openProject(p.id)}
                    title={p.path}
                  >
                    <span className="flex items-center gap-2">
                      <IconFolder className="h-4 w-4 shrink-0 text-muted group-hover:text-gold" />
                      <span className="hud-value min-w-0 flex-1 truncate">{p.name}</span>
                      {active && (
                        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-alert-green" />
                      )}
                    </span>
                    <span className="hud-label flex items-center gap-1.5 truncate">
                      <IconGitBranch className="h-3 w-3 shrink-0" />
                      <span className="truncate">{p.path}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <button
            className="hud-label flex items-center gap-2 rounded-lg border border-[var(--border-primary)] px-4 py-2 transition-colors hover:border-[var(--border-active)] hover:text-gold"
            onClick={() => useStore.getState().setProjectsModalOpen(true)}
          >
            <IconFolder className="h-4 w-4" />
            {hasProjects ? 'Open a project' : 'Register your first project'}
          </button>
        )}
      </div>
    </section>
  );
}
