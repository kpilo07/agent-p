// Hook de presentación: conecta la UI con el store de proyectos.
// Los componentes usan este hook en lugar de acceder al store directamente.
import { useStore, pickRecentProjects, selectFocusedProject } from '../../infrastructure/store/store';
import { projectService } from '../../core/use-cases/ProjectService';
import type { Project } from '../../core/domain/project';

export function useProjects() {
  const projects = useStore((s) => s.projects);
  const focusedId = useStore((s) => s.focusedId);
  const focusedProject = useStore(selectFocusedProject);
  const activeIds = useStore((s) => s.activeIds);
  const recentIds = useStore((s) => s.recentIds);
  const unread = useStore((s) => s.unread);
  const setProjectsModalOpen = useStore((s) => s.setProjectsModalOpen);
  const projectsModalOpen = useStore((s) => s.projectsModalOpen);

  const recentProjects = pickRecentProjects(projects, recentIds);

  const openProject = (id: string) => projectService.openProject(id);

  const isActive = (id: string) => activeIds.includes(id);
  const unreadCount = (id: string) => unread[id] ?? 0;

  return {
    projects,
    focusedId,
    focusedProject,
    activeIds,
    recentIds,
    recentProjects,
    projectsModalOpen,
    openProject,
    isActive,
    unreadCount,
    setProjectsModalOpen,
  } as const;
}

export function useProject(id: string): Project | undefined {
  return useStore((s) => s.projects.find((p) => p.id === id));
}
