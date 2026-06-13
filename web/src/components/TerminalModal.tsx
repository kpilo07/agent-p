// Consola como herramienta: cada terminal vive en su modal. Se abre desde el
// grupo de consolas de la Toolbar y muestra ÚNICAMENTE la terminal
// seleccionada (focusedTermId); el PTY sigue vivo en el backend y el
// scrollback se repinta vía replay al abrir.
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { api } from '../lib/api';
import { attach, sendInput, sendResize, subscribeTerminal } from '../lib/ws';
import {
  AGENT_TERM_ID,
  selectFocusedProject,
  useStore,
  type TermInfo,
} from '../store/store';
import { ModalShell } from './ModalShell';
import { IconClose, IconTerminal, IconTrash } from './icons';

const NO_TERMS: TermInfo[] = [];

const XTERM_THEME = {
  background: 'rgba(0, 0, 0, 0)', // translúcido: el panel pone el tinte
  foreground: '#ededed',
  cursor: '#ededed',
  cursorAccent: '#000000',
  selectionBackground: 'rgba(255, 255, 255, 0.22)',
  black: '#111111',
  brightBlack: '#6b6b6b',
  red: '#ff5f57',
  green: '#45d483',
  yellow: '#f5a623',
  blue: '#4e9eff',
  magenta: '#c084fc',
  cyan: '#50e3c2',
  white: '#ededed',
  brightWhite: '#ffffff',
};

export function TerminalModal() {
  const focused = useStore(selectFocusedProject);
  const focusedTermId = useStore((s) => s.focusedTermId);
  const terminals = useStore((s) =>
    focused ? (s.terminals[focused.id] ?? NO_TERMS) : NO_TERMS,
  );

  if (!focused) return null;

  // Si el shell seleccionado se cerró, cae a la consola del agente.
  const termId =
    focusedTermId === AGENT_TERM_ID || terminals.some((t) => t.id === focusedTermId)
      ? focusedTermId
      : AGENT_TERM_ID;
  const isAgent = termId === AGENT_TERM_ID;
  const title = isAgent
    ? focused.cliCommand || 'Agente'
    : (terminals.find((t) => t.id === termId)?.title ?? termId);

  const closeShell = async () => {
    try {
      await api.closeTerminal(focused.id, termId);
      // El session_state del backend lo quita del grupo y devuelve el foco
      // al agente (focusFix del store).
    } catch (err) {
      useStore.getState().pushToast({
        level: 'error',
        title: 'Terminal',
        message: (err as Error).message,
      });
    }
  };

  return (
    <ModalShell z="z-[850]" onClose={() => useStore.getState().setTerminalModalOpen(false)}>
      {(requestClose) => (
        <div className="glass-panel flex h-[86vh] w-[1100px] max-w-[96vw] flex-col overflow-hidden">
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border-secondary)] px-5 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <IconTerminal className="h-4 w-4 shrink-0 text-gold" />
              <span className="hud-label shrink-0">{isAgent ? 'Agente' : 'Shell'}</span>
              <span className="hud-value truncate">{title}</span>
              <span className="hud-label truncate">· {focused.name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!isAgent && (
                <button
                  className="btn-tactical btn-tactical--danger flex items-center justify-center p-1.5"
                  onClick={closeShell}
                  title="Cerrar este shell"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                className="btn-tactical flex items-center justify-center p-1.5"
                onClick={requestClose}
                title="Cerrar ventana"
              >
                <IconClose />
              </button>
            </div>
          </header>
          <div className="relative min-h-0 flex-1">
            <TerminalView key={`${focused.id}:${termId}`} projectId={focused.id} termId={termId} />
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ── Una instancia de xterm conectada a su stream (projectId, termId) ──

export function TerminalView({ projectId, termId }: { projectId: string; termId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const wsOpen = useStore((s) => s.wsStatus === 'open');

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
      fontSize: 13,
      theme: XTERM_THEME,
      allowTransparency: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current!);
    fit.fit();

    term.onData((data) => sendInput(projectId, termId, data));
    term.onResize(({ cols, rows }) => sendResize(projectId, termId, cols, rows));

    const unsubscribe = subscribeTerminal(projectId, termId, (bytes, isReplay) => {
      if (isReplay) term.reset();
      term.write(bytes);
    });

    sendResize(projectId, termId, term.cols, term.rows);

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(hostRef.current!);

    return () => {
      observer.disconnect();
      unsubscribe();
      term.dispose();
    };
  }, [projectId, termId]);

  // Attach al montar y re-attach tras cada reconexión del WS (el backend
  // responde con el replay del scrollback de ESTA terminal).
  useEffect(() => {
    attach(projectId, termId);
  }, [projectId, termId, wsOpen]);

  return <div ref={hostRef} className="terminal-host absolute inset-0" />;
}
