// Hook de presentación: conecta la UI con el estado de terminales del store.
import { apiClient as api } from '../../infrastructure/api/ApiClient';
import { useStore, AGENT_TERM_ID } from '../../infrastructure/store/store';
import type { TermInfo } from '../../core/domain/project';

// createAndOpenTerminal crea una consola en el proyecto en foco y la abre. El
// backend la añade al grupo vía session_state; aquí la enfocamos de inmediato.
// Compartida por la Toolbar (botón +) y por el atajo de teclado.
export async function createAndOpenTerminal(): Promise<void> {
  const { focusedId } = useStore.getState();
  if (!focusedId) return;
  try {
    const t = await api.createTerminal(focusedId);
    useStore.getState().openTerminal(t.id);
  } catch (err) {
    useStore.getState().pushToast({
      level: 'error',
      title: 'Terminal',
      message: (err as Error).message,
    });
  }
}

export function useTerminals(projectId: string | null): TermInfo[] {
  return useStore((s) => (projectId ? (s.terminals[projectId] ?? []) : []));
}

export function useFocusedTerminal() {
  const focusedTermId = useStore((s) => s.focusedTermId);
  const focusTerm = useStore((s) => s.focusTerm);
  return { focusedTermId, focusTerm, AGENT_TERM_ID } as const;
}

export function useTerminalModal() {
  const terminalModalOpen = useStore((s) => s.terminalModalOpen);
  const setTerminalModalOpen = useStore((s) => s.setTerminalModalOpen);
  return { terminalModalOpen, setTerminalModalOpen } as const;
}
