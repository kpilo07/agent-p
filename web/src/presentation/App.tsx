// Layout principal. Orquesta el estado global y conecta los adaptadores
// de infraestructura con la capa de presentación.
import { useEffect } from 'react';
import { Toaster } from 'sileo';

import { apiClient } from '../infrastructure/api/ApiClient';
import { wsClient } from '../infrastructure/ws/WsClient';
import { projectService } from '../core/use-cases/ProjectService';
import { selectFocusedProject, useStore } from '../infrastructure/store/store';
import { Toolbar } from './components/layout/Toolbar';
import { NodeMap } from './components/layout/NodeMap';
import { Home } from './components/layout/Home';
import { StatusBar } from './components/layout/StatusBar';
import { ProjectsModal } from './components/shared/ProjectsModal';
import { TerminalModal } from './components/shared/TerminalModal';
import { DiffModal } from './components/shared/DiffModal';
import { FileViewerModal } from './components/shared/FileViewerModal';
import { FileSearchModal } from './components/shared/FileSearchModal';

const TOASTER_OFFSET = { bottom: 40, right: 64 } as const;
const TOASTER_OPTIONS = { duration: 6000 } as const;

// Cablear WsClient (IRealtimeClient) con el store — se ejecuta una sola vez al cargar el módulo.
wsClient.onServerEvent((evt) => useStore.getState().handleServerEvent(evt));
wsClient.onStatusChange((status) => useStore.getState().setWsStatus(status));

// Cablear ProjectService (use-case) con el store e inyectar el repositorio de API.
projectService.setApiRepository(apiClient);
projectService.setStore({
  focusProject: (id) => useStore.getState().focusProject(id),
  markActive: (id, active) => useStore.getState().markActive(id, active),
  pushToast: (toast) => useStore.getState().pushToast(toast),
});

export default function App() {
  const focused = useStore(selectFocusedProject);
  const diffOpen = useStore((s) => s.diffModalOpen);
  const projectsOpen = useStore((s) => s.projectsModalOpen);
  const terminalOpen = useStore((s) => s.terminalModalOpen);
  const selectedFile = useStore((s) => s.selectedFile);
  const searchOpen = useStore((s) => s.searchOpen);
  const wsOpen = useStore((s) => s.wsStatus === 'open');
  const snap = useStore((s) => (focused ? s.git[focused.id] : undefined));

  useEffect(() => {
    wsClient.connect();
    apiClient
      .listProjects()
      .then((projects) => useStore.getState().setProjects(projects))
      .catch((err) =>
        useStore.getState().pushToast({
          level: 'error',
          title: 'agent-p',
          message: `No se pudieron cargar los proyectos: ${(err as Error).message}`,
        }),
      );
  }, []);

  useEffect(() => {
    if (!focused?.id || !wsOpen) return;
    wsClient.subscribeProject(focused.id);
    return () => wsClient.unsubscribeProject(focused.id);
  }, [focused?.id, wsOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (useStore.getState().focusedId) useStore.getState().setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!focused || snap) return;
    let cancelled = false;
    apiClient
      .getDiff(focused.id)
      .then((s) => !cancelled && useStore.getState().setGit(focused.id, s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [focused?.id, snap === undefined]);

  return (
    <div className="relative flex h-full flex-col bg-[var(--bg-void)]">
      <main className="relative z-10 flex min-h-0 min-w-0 flex-1 gap-1.5 p-1.5">
        <div className="min-w-0 flex-1">{focused ? <NodeMap /> : <Home />}</div>
      </main>

      <StatusBar />

      <Toolbar />
      {projectsOpen && <ProjectsModal />}
      {diffOpen && <DiffModal />}
      {terminalOpen && focused && <TerminalModal />}
      {searchOpen && focused && <FileSearchModal />}
      {selectedFile && <FileViewerModal />}
      <Toaster
        position="bottom-right"
        theme="dark"
        offset={TOASTER_OFFSET}
        options={TOASTER_OPTIONS}
      />
    </div>
  );
}
