// Layout principal. Orquesta el estado global y conecta los adaptadores
// de infraestructura con la capa de presentación.
import { useEffect, useState } from 'react';
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
import { ActivityModal } from './components/shared/ActivityModal';
import { FileViewerModal } from './components/shared/FileViewerModal';
import { FileSearchModal } from './components/shared/FileSearchModal';
import { AuthScreen } from './components/auth/AuthScreen';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';

const TOASTER_OFFSET = { bottom: 40, right: 64 } as const;
const TOASTER_OPTIONS = { duration: 6000, fill: '#000000' } as const;

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

type AuthState = 'loading' | 'setup' | 'login' | 'ready';

// AuthGate decide qué mostrar al cargar: pantalla de setup, de login, o la app.
// Es el export por defecto; MainApp solo se monta cuando hay sesión válida.
export default function App() {
  const [auth, setAuth] = useState<AuthState>('loading');

  const refreshStatus = () => {
    apiClient
      .authStatus()
      .then((s) => setAuth(s.authenticated ? 'ready' : s.needsSetup ? 'setup' : 'login'))
      .catch(() => setAuth('login'));
  };

  useEffect(refreshStatus, []);

  // Si una llamada protegida devuelve 401 (sesión caducada), rebota a login.
  useEffect(() => {
    apiClient.onUnauthorized(() => setAuth('login'));
  }, []);

  if (auth === 'loading') {
    return <div className="h-full w-full bg-[var(--bg-void)]" />;
  }
  if (auth === 'setup' || auth === 'login') {
    return <AuthScreen mode={auth} onAuthenticated={refreshStatus} />;
  }
  return <MainApp />;
}

function MainApp() {
  const focused = useStore(selectFocusedProject);
  const diffOpen = useStore((s) => s.diffModalOpen);
  const activityOpen = useStore((s) => s.activityModalOpen);
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

  useGlobalShortcuts();

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
        <div className="min-w-0 flex-1">
          {focused ? (
            <ErrorBoundary key={focused.id} resetKey={focused.id} label="El mapa de nodos no se pudo renderizar">
              <NodeMap />
            </ErrorBoundary>
          ) : (
            <Home />
          )}
        </div>
      </main>

      <StatusBar />

      <Toolbar />
      {projectsOpen && <ProjectsModal />}
      {diffOpen && <DiffModal />}
      {activityOpen && focused && <ActivityModal />}
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
