// Hook de presentación: timeline de actividad de un proyecto. Lee del store
// (que se actualiza en vivo vía WebSocket) y hace una carga inicial por REST.
import { useEffect } from 'react';

import { apiClient as api } from '../../infrastructure/api/ApiClient';
import { useStore } from '../../infrastructure/store/store';
import type { ActivityEvent } from '../../core/domain/project';

export function useActivity(projectId: string | null): ActivityEvent[] {
  const events = useStore((s) => (projectId ? (s.activity[projectId] ?? null) : null));

  useEffect(() => {
    if (!projectId || events !== null) return;
    let cancelled = false;
    api
      .getActivity(projectId)
      .then((evs) => !cancelled && useStore.getState().setActivity(projectId, evs))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, events !== null]);

  return events ?? [];
}

export function useActivityModal() {
  const activityModalOpen = useStore((s) => s.activityModalOpen);
  const setActivityModalOpen = useStore((s) => s.setActivityModalOpen);
  return { activityModalOpen, setActivityModalOpen } as const;
}
