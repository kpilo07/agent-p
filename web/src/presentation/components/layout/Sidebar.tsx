// Sidebar izquierdo en overlay sobre el Mapa Táctico (el tablero se desliza por
// debajo). Aloja el agente del proyecto y las consolas/agentes adicionales:
// cada uno ocupa un panel apilado verticalmente, con divisores arrastrables para
// repartir el alto. Desde la cabecera se añade una terminal o un nuevo agente.
//
// Las terminales viven en el backend (PTY); cada panel monta un TerminalView que
// hace attach + replay, así que colapsar/expandir el sidebar no pierde la sesión.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { apiClient as api } from '../../../infrastructure/api/ApiClient';
import { wsClient } from '../../../infrastructure/ws/WsClient';
import {
  AGENT_TERM_ID,
  selectFocusedProject,
  useStore,
  type TermInfo,
} from '../../../infrastructure/store/store';
import { createAndOpenTerminal } from '../../hooks/useTerminals';
import { TerminalView } from '../shared/TerminalView';
import { AgentLogo } from '../ui/AgentLogo';
import {
  IconChevronsLeft,
  IconChevronsRight,
  IconClose,
  IconLayers,
  IconMaximize,
  IconPlus,
  IconStop,
  IconTerminal,
} from '../ui/icons';

const NO_TERMS: TermInfo[] = [];
const MIN_W = 240;
const MIN_WEIGHT = 0.18;

// Ordena las consolas: el agente principal siempre primero, el resto por llegada.
function orderPanes(terms: TermInfo[]): TermInfo[] {
  const agent = terms.filter((t) => t.id === AGENT_TERM_ID);
  const rest = terms.filter((t) => t.id !== AGENT_TERM_ID);
  return [...agent, ...rest];
}

export function Sidebar() {
  const focused = useStore(selectFocusedProject);
  const terminals = useStore((s) => (focused ? (s.terminals[focused.id] ?? NO_TERMS) : NO_TERMS));
  const focusedTermId = useStore((s) => s.focusedTermId);
  const modalOpen = useStore((s) => s.terminalModalOpen);
  const sidebar = useStore((s) => s.sidebar);

  const panes = orderPanes(terminals);
  const panesKey = panes.map((p) => p.id).join('|');

  // Pesos (flex-grow) por panel, indexados por termId. Los nuevos entran con
  // peso 1; los que desaparecen se descartan.
  const [weights, setWeights] = useState<Record<string, number>>({});
  useEffect(() => {
    setWeights((prev) => {
      const next: Record<string, number> = {};
      for (const p of panes) next[p.id] = prev[p.id] ?? 1;
      const same =
        Object.keys(next).length === Object.keys(prev).length &&
        Object.keys(next).every((k) => prev[k] === next[k]);
      return same ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panesKey]);

  const listRef = useRef<HTMLDivElement>(null);

  if (!focused) return null;

  // ── Colapsado: riel fino con el botón de expandir y accesos rápidos ──
  if (sidebar.collapsed) {
    return (
      <aside className="sidebar-rail">
        <button
          className="sidebar-icon-btn"
          onClick={() => useStore.getState().setSidebar({ collapsed: false })}
          title="Expand terminals"
        >
          <IconChevronsRight className="h-4 w-4" />
        </button>
        <span className="my-1 h-px w-5 bg-[var(--border-primary)]" />
        <button
          className="sidebar-icon-btn"
          onClick={() => void createAndOpenTerminal('agent')}
          title="New agent"
        >
          <AgentLogo size={16} />
        </button>
        <button
          className="sidebar-icon-btn"
          onClick={() => void createAndOpenTerminal('shell')}
          title="New terminal"
        >
          <IconTerminal className="h-4 w-4" />
        </button>
        {panes.length > 0 && <span className="sidebar-rail__count">{panes.length}</span>}
      </aside>
    );
  }

  // ── Arrastre del divisor entre el panel i y el i+1 ──
  const startDividerDrag = (i: number, e: ReactPointerEvent) => {
    e.preventDefault();
    const ids = panes.map((p) => p.id);
    const a = ids[i];
    const b = ids[i + 1];
    if (!a || !b) return;
    const h = listRef.current?.clientHeight ?? 1;
    const totalW = ids.reduce((sum, id) => sum + (weights[id] ?? 1), 0);
    const startY = e.clientY;
    const wA = weights[a] ?? 1;
    const wB = weights[b] ?? 1;
    const pair = wA + wB;

    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      const deltaW = (dy / h) * totalW;
      let newA = wA + deltaW;
      newA = Math.max(MIN_WEIGHT, Math.min(pair - MIN_WEIGHT, newA));
      const newB = pair - newA;
      setWeights((prev) => ({ ...prev, [a]: newA, [b]: newB }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'row-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ── Arrastre del borde derecho para cambiar el ancho ──
  const startWidthDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    const max = Math.round(window.innerWidth * 0.6);
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(MIN_W, Math.min(max, ev.clientX));
      useStore.getState().setSidebar({ width: w });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <aside className="sidebar" style={{ width: sidebar.width }}>
      <header className="sidebar__header">
        <IconLayers className="h-3.5 w-3.5 shrink-0 text-gold" />
        <span className="hud-label min-w-0 flex-1 truncate">Terminals</span>
        <button
          className="sidebar-icon-btn"
          onClick={() => void createAndOpenTerminal('agent')}
          title="New agent"
        >
          <AgentLogo size={15} />
        </button>
        <button
          className="sidebar-icon-btn"
          onClick={() => void createAndOpenTerminal('shell')}
          title="New terminal"
        >
          <IconPlus className="h-4 w-4" />
        </button>
        <button
          className="sidebar-icon-btn"
          onClick={() => useStore.getState().setSidebar({ collapsed: true })}
          title="Collapse"
        >
          <IconChevronsLeft className="h-4 w-4" />
        </button>
      </header>

      <div ref={listRef} className="sidebar__list">
        {panes.length === 0 ? (
          <div className="sidebar__empty">
            <AgentLogo size={36} className="opacity-50" />
            <span className="hud-label">Starting agent…</span>
            <span className="text-[10px] text-muted">
              Use + to add a terminal or agent
            </span>
          </div>
        ) : (
          panes.map((t, i) => (
            <div
              key={t.id}
              className="sidebar-pane"
              style={{ flexGrow: weights[t.id] ?? 1, flexBasis: 0 }}
            >
              <TermPane
                projectId={focused.id}
                term={t}
                cliCommand={focused.cliCommand}
                active={t.id === focusedTermId}
                maximized={modalOpen && t.id === focusedTermId}
              />
              {i < panes.length - 1 && (
                <div
                  className="sidebar-divider"
                  onPointerDown={(e) => startDividerDrag(i, e)}
                  title="Drag to resize"
                />
              )}
            </div>
          ))
        )}
      </div>

      {/* Borde derecho: arrastrar para cambiar el ancho */}
      <div className="sidebar__resize" onPointerDown={startWidthDrag} title="Drag to resize" />
    </aside>
  );
}

function TermPane({
  projectId,
  term,
  cliCommand,
  active,
  maximized,
}: {
  projectId: string;
  term: TermInfo;
  cliCommand?: string;
  active: boolean;
  /** La consola está abierta en el modal: aquí mostramos un placeholder para no
   *  tener dos vistas del mismo PTY peleando por el resize. */
  maximized: boolean;
}) {
  const isMainAgent = term.id === AGENT_TERM_ID;
  const title = isMainAgent ? cliCommand || 'Agent' : term.title;

  const focus = () => useStore.getState().focusTerm(term.id);

  const maximize = () => {
    useStore.getState().focusTerm(term.id);
    useStore.getState().setTerminalModalOpen(true);
  };

  // Ctrl-C: el agente principal vía API (registra actividad); el resto por input.
  const interrupt = () => {
    if (isMainAgent) {
      api.interruptAgent(projectId).catch((err) =>
        useStore.getState().pushToast({ level: 'error', title: 'Interrupt', message: (err as Error).message }),
      );
    } else {
      wsClient.sendInput(projectId, term.id, '\x03');
    }
  };

  const close = () => {
    api.closeTerminal(projectId, term.id).catch((err) =>
      useStore.getState().pushToast({ level: 'error', title: 'Terminal', message: (err as Error).message }),
    );
  };

  return (
    <div className={`sidebar-pane__inner ${active ? 'sidebar-pane__inner--active' : ''}`}>
      <header className="sidebar-pane__header" onClick={focus}>
        {isMainAgent ? (
          <AgentLogo size={14} className="shrink-0" />
        ) : (
          <IconTerminal className="h-3.5 w-3.5 shrink-0 text-gold-dim" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-secondary">{title}</span>
        <button className="sidebar-pane__btn" onClick={(e) => { e.stopPropagation(); interrupt(); }} title="Interrupt · Ctrl-C">
          <IconStop className="h-3 w-3" />
        </button>
        <button className="sidebar-pane__btn" onClick={(e) => { e.stopPropagation(); maximize(); }} title="Maximize">
          <IconMaximize className="h-3 w-3" />
        </button>
        {!isMainAgent && (
          <button
            className="sidebar-pane__btn sidebar-pane__btn--danger"
            onClick={(e) => { e.stopPropagation(); close(); }}
            title="Close"
          >
            <IconClose className="h-3 w-3" />
          </button>
        )}
      </header>
      <div className="sidebar-pane__body" onMouseDown={focus}>
        {maximized ? (
          <button
            className="sidebar-pane__maximized"
            onClick={() => useStore.getState().setTerminalModalOpen(false)}
            title="Restore from maximized"
          >
            <IconMaximize className="h-4 w-4" />
            <span className="hud-label">Maximized · click to restore</span>
          </button>
        ) : (
          <TerminalView key={`${projectId}:${term.id}`} projectId={projectId} termId={term.id} fontSize={12} />
        )}
      </div>
    </div>
  );
}
