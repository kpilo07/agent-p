// Layout principal: la terminal ocupa casi todo el viewport (padding mínimo),
// con la toolbar flotante a la derecha y una barra de estado abajo con la
// información global (foco, activos, notificaciones, enlace WS).
import { useEffect } from 'react';

import { api } from './lib/api';
import { connect } from './lib/ws';
import { selectFocusedProject, useStore } from './store/store';
import { Toolbar } from './components/Toolbar';
import { ProjectsModal } from './components/ProjectsModal';
import { TerminalPanel } from './components/TerminalPanel';
import { DiffModal } from './components/DiffModal';
import { Toasts } from './components/Toasts';
import { StatusBar } from './components/StatusBar';
import { ParticleBackground } from './components/ParticleBackground';

export default function App() {
  const focused = useStore(selectFocusedProject);
  const diffOpen = useStore((s) => s.diffModalOpen);
  const projectsOpen = useStore((s) => s.projectsModalOpen);
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
      <ParticleBackground />

      <main className="relative z-10 flex min-h-0 min-w-0 flex-1 p-1.5">
        <div className="min-w-0 flex-1">
          <TerminalPanel />
        </div>
      </main>

      <StatusBar />

      <Toolbar />
      {projectsOpen && <ProjectsModal />}
      {diffOpen && <DiffModal />}
      <Toasts />
    </div>
  );
}
