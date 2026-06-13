// Caso de uso: gestión de proyectos. Solo conoce los puertos (interfaces),
// nunca las implementaciones concretas de infraestructura.
// Patrón: Facade + Singleton
import type { IApiRepository } from '../domain/ports/IApiRepository';

type StoreActions = {
  focusProject: (id: string | null) => void;
  markActive: (id: string, active: boolean) => void;
  pushToast: (toast: { level: 'error'; title: string; message: string }) => void;
};

class ProjectService {
  private static instance: ProjectService | null = null;
  private api: IApiRepository | null = null;
  private store: StoreActions | null = null;

  private constructor() {}

  static getInstance(): ProjectService {
    if (!ProjectService.instance) {
      ProjectService.instance = new ProjectService();
    }
    return ProjectService.instance;
  }

  /** Inyecta el adaptador de API (puerto → implementación). */
  setApiRepository(api: IApiRepository): void {
    this.api = api;
  }

  /** Inyecta las acciones del store. */
  setStore(actions: StoreActions): void {
    this.store = actions;
  }

  /** Enfoca un proyecto y arranca su PTY + watcher si aún no corren. */
  async openProject(id: string): Promise<void> {
    this.store?.focusProject(id);
    try {
      await this.api!.startProject(id);
      this.store?.markActive(id, true);
    } catch (err) {
      this.store?.pushToast({
        level: 'error',
        title: 'Error al iniciar',
        message: (err as Error).message,
      });
    }
  }

  async stopProject(id: string): Promise<void> {
    await this.api!.stopProject(id);
  }
}

export const projectService = ProjectService.getInstance();
