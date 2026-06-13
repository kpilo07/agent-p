// Hook de presentación: conecta la UI con el estado git del store.
import { useStore } from '../../infrastructure/store/store';
import type { GitSnapshot } from '../../core/domain/project';

export function useGit(projectId: string | null): GitSnapshot | null {
  return useStore((s) => (projectId ? (s.git[projectId] ?? null) : null));
}

export function useDiffModal() {
  const diffModalOpen = useStore((s) => s.diffModalOpen);
  const setDiffModalOpen = useStore((s) => s.setDiffModalOpen);
  return { diffModalOpen, setDiffModalOpen } as const;
}
