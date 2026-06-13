// Una instancia de xterm conectada a su stream (projectId, termId). El PTY vive
// en el backend; al montar se hace attach y el backend repinta el scrollback vía
// replay. Por eso este componente puede montarse en cualquier sitio (modal o nodo
// del Mapa Táctico) sin perder la sesión.
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { wsClient } from '../../../infrastructure/ws/WsClient';
import { useStore } from '../../../infrastructure/store/store';

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

export function TerminalView({
  projectId,
  termId,
  fontSize = 13,
}: {
  projectId: string;
  termId: string;
  /** Tamaño de fuente del xterm. Más pequeño al anclar en el Mapa Táctico
      para que la terminal no se vea desproporcionada frente al árbol. */
  fontSize?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const wsOpen = useStore((s) => s.wsStatus === 'open');

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
      fontSize,
      theme: XTERM_THEME,
      allowTransparency: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current!);
    fit.fit();

    term.onData((data) => wsClient.sendInput(projectId, termId, data));
    term.onResize(({ cols, rows }) => wsClient.sendResize(projectId, termId, cols, rows));

    const unsubscribe = wsClient.subscribeTerminal(projectId, termId, (bytes, isReplay) => {
      if (isReplay) term.reset();
      term.write(bytes);
    });

    wsClient.sendResize(projectId, termId, term.cols, term.rows);

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(hostRef.current!);

    return () => {
      observer.disconnect();
      unsubscribe();
      term.dispose();
    };
  }, [projectId, termId, fontSize]);

  // Attach al montar y re-attach tras cada reconexión del WS (el backend
  // responde con el replay del scrollback de ESTA terminal).
  useEffect(() => {
    wsClient.attach(projectId, termId);
  }, [projectId, termId, wsOpen]);

  return <div ref={hostRef} className="terminal-host absolute inset-0" />;
}
