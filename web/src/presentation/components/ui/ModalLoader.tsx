// Fallback de Suspense para los modales diferidos (code-splitting). Aparece al
// INSTANTE mientras se descarga el chunk del modal — que puede arrastrar libs
// pesadas (marked, highlight.js, xterm) — para que en red lenta el usuario vea
// respuesta inmediata en lugar de un retardo sin feedback antes de que abra.
//
// No depende de ModalShell/Blendy ni de ninguna lib pesada: vive en el bundle
// inicial, que es justo lo que un fallback debe garantizar.
import { AgentLogo } from './AgentLogo';

export function ModalLoader() {
  return (
    <div className="modal-backdrop-in fixed inset-0 z-[900] flex items-center justify-center bg-black/70 p-6">
      <div className="glass-panel flex flex-col items-center justify-center gap-4 px-12 py-9">
        <div className="animate-osiris-pulse">
          <AgentLogo size={56} />
        </div>
        <div className="app-loader__bar">
          <span />
        </div>
        <span className="hud-label">Cargando…</span>
      </div>
    </div>
  );
}
