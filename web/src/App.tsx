// Layout principal. El workspace es siempre el Mapa Táctico (mapa de nodos del
// repo con React Flow); sin proyecto en foco se muestra la pantalla de inicio
// (logo + accesos directos a proyectos recientes). La consola es una
// herramienta más de la toolbox y se abre en una modal (TerminalModal).
// La suscripción WS a los eventos del proyecto enfocado se gestiona aquí, para
// que git_update/fs_change lleguen aunque la consola no esté montada.
import { useEffect } from 'react';
import { Toaster } from 'sileo';

import { api } from './lib/api';
import { connect, subscribeProject, unsubscribeProject } from './lib/ws';
import { selectFocusedProject, useStore } from './store/store';
import { Toolbar } from './components/Toolbar';
import { ProjectsModal } from './components/ProjectsModal';
import { TerminalModal } from './components/TerminalModal';
import { DiffModal } from './components/DiffModal';
import { NodeMap } from './components/NodeMap';
import { Home } from './components/Home';
import { FileViewerModal } from './components/FileViewerModal';
import { FileSearchModal } from './components/FileSearchModal';
import { StatusBar } from './components/StatusBar';

// Referencias ESTABLES para el Toaster: pasarlas como literales inline daría un
// objeto nuevo en cada render y dispararía el bucle de actualización (React #185).
const TOASTER_OFFSET = { bottom: 40, right: 64 } as const;
const TOASTER_OPTIONS = { duration: 6000 } as const;

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
