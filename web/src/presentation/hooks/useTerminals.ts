// Hook de presentación: conecta la UI con el estado de terminales del store.
import { useStore, AGENT_TERM_ID } from '../../infrastructure/store/store';
import type { TermInfo } from '../../core/domain/project';

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
