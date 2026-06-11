// Panel de terminal de VISTA ÚNICA: muestra solo la terminal seleccionada
// (focusedTermId) del proyecto en foco. La selección se hace desde el grupo
// de consolas de la Toolbar; cada terminal mantiene su PTY vivo en el
// backend y su scrollback se repinta vía replay al montarse.
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { api } from '../lib/api';
import { attach, sendInput, sendResize, subscribeTerminal } from '../lib/ws';
import { AgentLogo } from './AgentLogo';
import { AGENT_TERM_ID, selectFocusedProject, useStore, type TermInfo } from '../store/store';

// Referencia ESTABLE para el selector: devolver `[]` literal en cada snapshot
// haría que Zustand viera estado nuevo en cada render (bucle infinito,
// React #185).
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

export function TerminalPanel() {
  const focused = useStore(selectFocusedProject);
  const focusedTermId = useStore((s) => s.focusedTermId);
  const terminals = useStore((s) =>
    focused ? (s.terminals[focused.id] ?? NO_TERMS) : NO_TERMS,
  );

  // Carga las terminales existentes al enfocar. La suscripción WS al
  // proyecto la gestiona App (subscribe/unsubscribe).
  useEffect(() => {
    if (!focused) return;
    api
      .listTerminals(focused.id)
      .then((terms) => useStore.getState().setTerminals(focused.id, terms))
      .catch(() => {});
  }, [focused?.id]);

  if (!focused) {
    return (
      <section className="glass-panel glass-panel--terminal gotham-enter relative h-full min-h-0 overflow-hidden">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <AgentLogo />
          <span className="hud-text text-[18px] font-bold text-gold">P agente</span>
          <span className="hud-label">Git Ops Command Center</span>
        </div>
      </section>
    );
  }

  // Si la terminal seleccionada ya no existe (shell cerrado), cae al agente.
  const termId =
    focusedTermId === AGENT_TERM_ID || terminals.some((t) => t.id === focusedTermId)
      ? focusedTermId
      : AGENT_TERM_ID;

  return (
    <section className="glass-panel glass-panel--terminal gotham-enter relative h-full min-h-0 overflow-hidden">
      <TerminalView key={`${focused.id}:${termId}`} projectId={focused.id} termId={termId} />
    </section>
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
