// Hook de presentación: conecta la UI con el estado de terminales del store.
import { apiClient as api } from '../../infrastructure/api/ApiClient';
import { useStore, AGENT_TERM_ID } from '../../infrastructure/store/store';
import type { TermInfo } from '../../core/domain/project';

// createAndOpenTerminal crea una consola (shell o agente) en el proyecto en
// foco. El backend la añade al grupo vía session_state; aquí la enfocamos en el
// sidebar (asegurando que esté expandido). Compartida por el Sidebar y el atajo.
export async function createAndOpenTerminal(kind: 'shell' | 'agent' = 'shell'): Promise<void> {
  const { focusedId } = useStore.getState();
  if (!focusedId) return;
  try {
    const t = await api.createTerminal(focusedId, { kind });
    useStore.getState().focusTerm(t.id);
    useStore.getState().setSidebar({ collapsed: false });
  } catch (err) {
    useStore.getState().pushToast({
      level: 'error',
      title: kind === 'agent' ? 'Agent' : 'Terminal',
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
