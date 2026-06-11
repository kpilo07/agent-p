// Panel de terminales en MOSAICO: todas las terminales del proyecto en foco
// (agente + shells extra) se renderizan a la par en un grid. Cada tile tiene
// su propia instancia de xterm conectada a su stream (projectId, termId).
//
// El fondo es translúcido (allowTransparency) para dejar ver el fondo de
// partículas a través del glass panel.
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { api } from '../lib/api';
import { attach, detach, sendInput, sendResize, subscribeTerminal } from '../lib/ws';
import { AgentLogo } from './AgentLogo';
import { AGENT_TERM_ID, selectFocusedProject, useStore, type TermInfo } from '../store/store';
import { IconClose } from './icons';

// Referencia ESTABLE para el selector: devolver `[]` literal en cada snapshot
// haría que Zustand viera estado nuevo en cada render (bucle infinito,
// React #185).
const NO_TERMS: TermInfo[] = [];

const XTERM_THEME = {
  background: 'rgba(0, 0, 0, 0)', // translúcido: el panel pone el tinte
  foreground: '#e8e6e0',
  cursor: '#d4af37',
  cursorAccent: '#04040a',
  selectionBackground: 'rgba(212, 175, 55, 0.25)',
  black: '#121628',
  brightBlack: '#5c5a54',
  red: '#ff3d3d',
  green: '#00e676',
  yellow: '#d4af37',
  blue: '#448aff',
  magenta: '#e040fb',
  cyan: '#00e5ff',
  white: '#e8e6e0',
  brightWhite: '#f5f0e0',
};

export function TerminalPanel() {
  const focused = useStore(selectFocusedProject);
  const terminals = useStore((s) =>
    focused ? (s.terminals[focused.id] ?? NO_TERMS) : NO_TERMS,
  );

  // Carga las terminales existentes al enfocar y des-suscribe del proyecto
  // anterior al cambiar.
  useEffect(() => {
    if (!focused) return;
    api
      .listTerminals(focused.id)
      .then((terms) => useStore.getState().setTerminals(focused.id, terms))
      .catch(() => {});
    return () => detach(focused.id);
  }, [focused?.id]);

  // La tile del agente existe siempre que hay foco; las extra vienen del store.
  const tiles = focused
    ? [
        { id: AGENT_TERM_ID, title: focused.cliCommand || 'Agente' },
        ...terminals.filter((t) => t.id !== AGENT_TERM_ID),
      ]
    : [];

  // Mosaico: 1 → columna única, 2-4 → 2 columnas, 5+ → 3 columnas.
  const cols = tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : 3;
  const remainder = tiles.length % cols;

  return (
    <section className="glass-panel glass-panel--terminal gotham-enter relative h-full min-h-0 overflow-hidden">
      {focused ? (
        <div
          className="grid h-full gap-1 p-1"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {tiles.map((t, i) => (
            <TerminalTile
              key={`${focused.id}:${t.id}`}
              projectId={focused.id}
              termId={t.id}
              title={t.title}
              closable={t.id !== AGENT_TERM_ID}
              style={
                // La última tile de una fila incompleta ocupa el resto.
                i === tiles.length - 1 && remainder !== 0
                  ? { gridColumn: `span ${cols - remainder + 1}` }
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <AgentLogo />
          <span className="hud-text text-[18px] font-bold text-gold">P agente</span>
          <span className="hud-label">Git Ops Command Center</span>
        </div>
      )}
    </section>
  );
}

// ── Tile: una instancia de xterm por terminal ───────────────────

function TerminalTile({
  projectId,
  termId,
  title,
  closable,
  style,
}: {
  projectId: string;
  termId: string;
  title: string;
  closable: boolean;
  style?: React.CSSProperties;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const wsOpen = useStore((s) => s.wsStatus === 'open');

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      // Geist Mono: la única de la familia Geist con métricas monoespaciadas
      // reales; Geist Pixel rompería la rejilla de xterm.
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

  const close = async () => {
    try {
      await api.closeTerminal(projectId, termId);
      // El session_state del backend retira la tile del mosaico.
    } catch (err) {
      useStore.getState().pushToast({
        level: 'error',
        title: 'Terminal',
        message: (err as Error).message,
      });
    }
  };

  return (
    <div
      className="group relative min-h-0 min-w-0 overflow-hidden rounded-lg border border-[var(--border-secondary)] transition-colors focus-within:border-[var(--border-active)]"
      style={style}
    >
      <div ref={hostRef} className="terminal-host absolute inset-0" />
      {/* Identificación y cierre: solo visibles al pasar el ratón */}
      <div className="pointer-events-none absolute top-1 right-1.5 z-10 flex items-center gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <span className="hud-label rounded bg-[rgba(6,7,14,0.8)] px-1.5 py-0.5">{title}</span>
        {closable && (
          <button
            className="pointer-events-auto rounded bg-[rgba(6,7,14,0.8)] p-0.5 text-muted hover:text-alert-red"
            onClick={close}
            title="Cerrar terminal"
          >
            <IconClose className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
