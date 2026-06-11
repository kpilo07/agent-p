// Acción compartida (toolbar, panel de proyectos): enfoca un proyecto y
// arranca su PTY + watcher en el backend si aún no corren.
import { api } from './api';
import { useStore } from '../store/store';

export async function openProject(id: string): Promise<void> {
  useStore.getState().focusProject(id);
  try {
    await api.startProject(id); // idempotente
    useStore.getState().markActive(id, true);
  } catch (err) {
    useStore.getState().pushToast({
      level: 'error',
      title: 'Error al iniciar',
      message: (err as Error).message,
    });
  }
}
