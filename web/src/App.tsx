// Layout principal con dos Modos de Vista:
//  · 'console' — la terminal es el workspace, con el diff general en vivo
//    en el panel derecho (DiffPanel).
//  · 'map' — el workspace es el Mapa Táctico (mapa de nodos del repo con
//    React Flow); la consola pasa a ser una herramienta más de la toolbox
//    y se abre en una modal (TerminalModal).
// La suscripción WS a los eventos del proyecto enfocado se gestiona aquí,
// para que git_update/fs_change lleguen aunque la consola no esté montada.
import { useEffect } from 'react';

import { api } from './lib/api';
import { connect, subscribeProject, unsubscribeProject } from './lib/ws';
import { selectFocusedProject, useStore } from './store/store';
import { Toolbar } from './components/Toolbar';
import { ProjectsModal } from './components/ProjectsModal';
import { TerminalPanel } from './components/TerminalPanel';
import { TerminalModal } from './components/TerminalModal';
import { DiffModal } from './components/DiffModal';
import { DiffPanel } from './components/DiffPanel';
import { NodeMap } from './components/NodeMap';
import { FileViewerModal } from './components/FileViewerModal';
import { FileSearchModal } from './components/FileSearchModal';
import { Toasts } from './components/Toasts';
import { StatusBar } from './components/StatusBar';

export default function App() {
  const focused = useStore(selectFocusedProject);
  const diffOpen = useStore((s) => s.diffModalOpen);
  const projectsOpen = useStore((s) => s.projectsModalOpen);
  const terminalOpen = useStore((s) => s.terminalModalOpen);
  const viewMode = useStore((s) => s.viewMode);
  const selectedFile = useStore((s) => s.selectedFile);
  const searchOpen = useStore((s) => s.searchOpen);
  const wsOpen = useStore((s) => s.wsStatus === 'open');
  const snap = useStore((s) => (focused ? s.git[focused.id] : undefined));

  useEffect(() => {
    connect();
    api
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

  // Suscripción a los eventos del proyecto en foco. Se renueva en cada
  // reconexión del WS (la suscripción vive en la conexión).
  useEffect(() => {
    if (!focused?.id || !wsOpen) return;
    subscribeProject(focused.id);
    return () => unsubscribeProject(focused.id);
  }, [focused?.id, wsOpen]);

  // Atajo Ctrl/⌘+K: abre el buscador de archivos del proyecto en foco.
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

  // Carga el snapshot inicial al enfocar; las actualizaciones siguen por WS.
  useEffect(() => {
    if (!focused || snap) return;
    let cancelled = false;
    api
      .getDiff(focused.id)
      .then((s) => !cancelled && useStore.getState().setGit(focused.id, s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [focused?.id, snap === undefined]);

  const mapMode = viewMode === 'map' && focused !== null;

  return (
    <div className="relative flex h-full flex-col bg-[var(--bg-void)]">
      <main className="relative z-10 flex min-h-0 min-w-0 flex-1 gap-1.5 p-1.5">
        {mapMode ? (
          // Modo Mapa Táctico: el mapa de nodos ES el workspace.
          <div className="min-w-0 flex-1">
            <NodeMap />
          </div>
        ) : (
          // Modo Consola: terminal + diff general en vivo.
          <>
            <div className="min-w-0 flex-1">
              <TerminalPanel />
            </div>
            {focused && (
              <aside className="w-[clamp(300px,32vw,500px)] shrink-0">
                <DiffPanel />
              </aside>
            )}
          </>
        )}
      </main>

      <StatusBar />

      <Toolbar />
      {projectsOpen && <ProjectsModal />}
      {diffOpen && <DiffModal />}
      {mapMode && terminalOpen && <TerminalModal />}
      {searchOpen && focused && <FileSearchModal />}
      {selectedFile && <FileViewerModal />}
      <Toasts />
    </div>
  );
}
