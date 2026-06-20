// Layout principal. Orquesta el estado global y conecta los adaptadores
// de infraestructura con la capa de presentación.
import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'sileo';

import { apiClient } from '../infrastructure/api/ApiClient';
import { wsClient } from '../infrastructure/ws/WsClient';
import { projectService } from '../core/use-cases/ProjectService';
import { selectFocusedProject, useStore } from '../infrastructure/store/store';
// Estáticos: ligeros y presentes en la primera pintura (login / Home).
import { Toolbar } from './components/layout/Toolbar';
import { Home } from './components/layout/Home';
import { StatusBar } from './components/layout/StatusBar';
import { AuthScreen } from './components/auth/AuthScreen';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { AppLoader } from './components/ui/AppLoader';
import { ModalLoader } from './components/ui/ModalLoader';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';

// Diferidos (code-splitting): componentes pesados o que no se necesitan en el
// arranque. Cada uno arrastra su librería grande a su propio chunk async, fuera
// del bundle inicial:
//   · NodeMap        → @xyflow/react
//   · Sidebar        → xterm (vía TerminalView)
//   · FileViewerModal→ marked + highlight.js
//   · DiffModal      → highlight.js
//   · TerminalModal  → xterm
// Los named exports se adaptan a default export para React.lazy.
const NodeMap = lazy(() => import('./components/layout/NodeMap').then((m) => ({ default: m.NodeMap })));
const Sidebar = lazy(() => import('./components/layout/Sidebar').then((m) => ({ default: m.Sidebar })));
const ProjectsModal = lazy(() =>
  import('./components/shared/ProjectsModal').then((m) => ({ default: m.ProjectsModal })),
);
const TerminalModal = lazy(() =>
  import('./components/shared/TerminalModal').then((m) => ({ default: m.TerminalModal })),
);
const DiffModal = lazy(() => import('./components/shared/DiffModal').then((m) => ({ default: m.DiffModal })));
const CommitHistoryModal = lazy(() =>
  import('./components/shared/CommitHistoryModal').then((m) => ({ default: m.CommitHistoryModal })),
);
const ActivityModal = lazy(() =>
  import('./components/shared/ActivityModal').then((m) => ({ default: m.ActivityModal })),
);
const TicketModal = lazy(() =>
  import('./components/shared/TicketModal').then((m) => ({ default: m.TicketModal })),
);
const FileViewerModal = lazy(() =>
  import('./components/shared/FileViewerModal').then((m) => ({ default: m.FileViewerModal })),
);
const FileSearchModal = lazy(() =>
  import('./components/shared/FileSearchModal').then((m) => ({ default: m.FileSearchModal })),
);
const ContentSearchModal = lazy(() =>
  import('./components/shared/ContentSearchModal').then((m) => ({ default: m.ContentSearchModal })),
);

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
    return <AppLoader label="Verifying session…" />;
  }
  if (auth === 'setup' || auth === 'login') {
    return <AuthScreen mode={auth} onAuthenticated={refreshStatus} />;
  }
  return <MainApp />;
}

// Sincroniza el proyecto enfocado con la URL (/p/:id) en ambos sentidos, para
// que la recarga y los enlaces profundos conserven la vista. El store sigue
// siendo la fuente de verdad; esto solo refleja focusedId ↔ ruta. No pinta nada.
function RouteSync() {
  const navigate = useNavigate();
  const location = useLocation();
  const focusedId = useStore((s) => s.focusedId);
  // Foco huérfano: el id de la URL no existe entre los proyectos ya cargados
  // (proyecto borrado o enlace obsoleto). length > 0 evita limpiar en plena carga.
  const orphan = useStore(
    (s) =>
      !!s.focusedId && s.projects.length > 0 && !s.projects.some((p) => p.id === s.focusedId),
  );

  const pathId = location.pathname.startsWith('/p/')
    ? decodeURIComponent(location.pathname.slice(3))
    : null;

  // URL → store (carga inicial, recarga, back/forward del navegador).
  useEffect(() => {
    if (pathId !== useStore.getState().focusedId) {
      useStore.getState().focusProject(pathId);
    }
  }, [pathId]);

  // store → URL (clic en proyecto, acción "View", cerrar proyecto…).
  useEffect(() => {
    const target = focusedId ? `/p/${encodeURIComponent(focusedId)}` : '/';
    if (location.pathname !== target) navigate(target);
  }, [focusedId, location.pathname, navigate]);

  useEffect(() => {
    if (orphan) useStore.getState().focusProject(null);
  }, [orphan]);

  return null;
}

function MainApp() {
  const focused = useStore(selectFocusedProject);
  const diffOpen = useStore((s) => s.diffModalOpen);
  const commitHistoryOpen = useStore((s) => s.commitHistoryOpen);
  const activityOpen = useStore((s) => s.activityModalOpen);
  const ticketsOpen = useStore((s) => s.ticketsModalOpen);
  const projectsOpen = useStore((s) => s.projectsModalOpen);
  const terminalOpen = useStore((s) => s.terminalModalOpen);
  const selectedFile = useStore((s) => s.selectedFile);
  const searchOpen = useStore((s) => s.searchOpen);
  const contentSearchOpen = useStore((s) => s.contentSearchOpen);
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
          message: `Could not load projects: ${(err as Error).message}`,
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
      <RouteSync />
      <main className="relative z-10 flex min-h-0 min-w-0 flex-1">
        <div className="min-w-0 flex-1">
          {focused ? (
            <ErrorBoundary key={focused.id} resetKey={focused.id} label="The node map could not be rendered">
              <Suspense fallback={<div className="glass-panel glass-panel--terminal h-full" />}>
                <NodeMap />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <Home />
          )}
        </div>
        {/* Sidebar de terminales/agentes: overlay izquierdo sobre el tablero. */}
        {focused && (
          <Suspense fallback={null}>
            <Sidebar />
          </Suspense>
        )}
      </main>

      <StatusBar />

      <Toolbar />
      {/* Los modales se cargan bajo demanda; el fallback nulo evita parpadeo. */}
      <Suspense fallback={null}>
        {projectsOpen && <ProjectsModal />}
        {diffOpen && <DiffModal />}
        {commitHistoryOpen && focused && <CommitHistoryModal />}
        {activityOpen && focused && <ActivityModal />}
        {ticketsOpen && focused && <TicketModal />}
        {terminalOpen && focused && <TerminalModal />}
        {searchOpen && focused && <FileSearchModal />}
        {contentSearchOpen && focused && <ContentSearchModal />}
      </Suspense>
      {/* Visor de archivo en su propio límite: arrastra marked + highlight.js,
          así que mostramos un loader inmediato mientras baja el chunk (clave en
          red lenta) sin afectar al resto de modales ya abiertos. */}
      <Suspense fallback={<ModalLoader />}>
        {selectedFile && <FileViewerModal />}
      </Suspense>
      <Toaster
        position="bottom-right"
        theme="dark"
        offset={TOASTER_OFFSET}
        options={TOASTER_OPTIONS}
      />
    </div>
  );
}
