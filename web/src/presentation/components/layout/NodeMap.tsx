// Mapa Táctico: el repositorio como mapa de nodos interactivo (React Flow).
// Zoom/pan libres, minimapa navegable, las carpetas se expanden/colapsan con
// clic y los archivos abren su contenido en el FileViewerModal.
//
// Actividad en vivo: el archivo recién modificado (fs_change vía fsnotify)
// parpadea ámbar/teal, TODA su cadena de carpetas ancestro pulsa con el
// mismo código de color y las aristas de esa ruta se animan con guiones en
// movimiento (animated edges de React Flow). La animación de la ruta
// PERSISTE mientras el archivo tenga cambios sin commit (snap.files de git)
// y se apaga sola cuando el commit limpia el working tree.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  NodeResizer,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { apiClient as api } from '../../../infrastructure/api/ApiClient';
import type { TreeNode } from '../../../core/domain/project';
import { diffService } from '../../../core/use-cases/DiffService';
import type { DiffRow } from '../../../core/domain/diff';

const parseDiff = (diff: string) => diffService.parseDiff(diff);
import {
  AGENT_TERM_ID,
  selectFocusedProject,
  useStore,
  type FileStat,
  type PinnedTerm,
} from '../../../infrastructure/store/store';
import { DiffRows } from '../shared/DiffView';
import { TerminalView } from '../shared/TerminalView';
import {
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconPinOff,
  IconSettings,
  IconRefresh,
  IconTerminal,
  IconTrash,
} from '../ui/icons';
import { AgentLogo } from '../ui/AgentLogo';

// ── Configuración de fondo del mapa ─────────────────────────────

type BgPattern = 'dots' | 'lines' | 'cross' | 'dashedgrid' | 'circuit' | 'diagonal' | 'zigzag' | 'none';

interface BgConfig {
  pattern: BgPattern;
}

const BG_STORAGE_KEY = 'map-bg-config';

const BG_PATTERNS: { id: BgPattern; label: string; icon: string }[] = [
  { id: 'dots',      label: 'Puntos',       icon: '·' },
  { id: 'lines',     label: 'Líneas',       icon: '≡' },
  { id: 'cross',     label: 'Cruz',         icon: '⊞' },
  { id: 'dashedgrid',label: 'Cuadrícula',   icon: '⬚' },
  { id: 'circuit',   label: 'Circuito',     icon: '⊙' },
  { id: 'diagonal',  label: 'Diagonal',     icon: '⤢' },
  { id: 'zigzag',    label: 'Zigzag',       icon: '∿' },
  { id: 'none',      label: 'Limpio',       icon: '□' },
];

const BG_VARIANT_MAP: Record<BgPattern, BackgroundVariant | null> = {
  dots:       BackgroundVariant.Dots,
  lines:      BackgroundVariant.Lines,
  cross:      BackgroundVariant.Cross,
  dashedgrid: null,
  circuit:    null,
  diagonal:   null,
  zigzag:     null,
  none:       null,
};

function loadBgConfig(): BgConfig {
  try {
    const raw = localStorage.getItem(BG_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as BgConfig;
  } catch {}
  return { pattern: 'dots' };
}

function saveBgConfig(cfg: BgConfig) {
  try { localStorage.setItem(BG_STORAGE_KEY, JSON.stringify(cfg)); } catch {}
}

// ── Datos de cada nodo del mapa ─────────────────────────────────

interface MapNodeData extends Record<string, unknown> {
  name: string;
  path: string;
  kind: 'root' | 'dir' | 'file';
  expanded?: boolean;
  childCount?: number;
  /** Archivo con fs_change reciente. */
  alert?: boolean;
  /** Operación del fs_change: 'write' | 'create' | 'remove' | 'rename'. */
  alertOp?: string;
  /** Archivo nuevo: untracked (??), staged (A) o recién creado (create). */
  isNew?: boolean;
  /** Archivo eliminado en git (D). */
  isDeleted?: boolean;
  /** Carpeta con actividad de MODIFICACIÓN en su subárbol. */
  activity?: boolean;
  /** Carpeta con actividad de CREACIÓN en su subárbol. */
  activityNew?: boolean;
  stat?: FileStat;
}

type MapNode = Node<MapNodeData>;

// ── Layout: árbol "tidy" horizontal ─────────────────────────────
// Las hojas ocupan filas consecutivas; cada padre se centra verticalmente
// sobre sus hijos visibles. x crece con la profundidad.

const COL_W = 250;
const ROW_H = 46;

const ROOT_ID = '__root';

/** Rutas "calientes": cada path activo y toda su cadena de ancestros. */
function hotPaths(paths: Iterable<string>): Set<string> {
  const hot = new Set<string>();
  for (let p of paths) {
    while (p !== '') {
      hot.add(p);
      const i = p.lastIndexOf('/');
      p = i >= 0 ? p.slice(0, i) : '';
    }
  }
  return hot;
}

function buildGraph(
  tree: TreeNode,
  projectName: string,
  expanded: string[],
  alerts: Record<string, { stamp: number; op: string }>,
  gitByPath: Map<string, FileStat>,
): { nodes: MapNode[]; edges: Edge[] } {
  const nodes: MapNode[] = [];
  const edges: Edge[] = [];

  // Rutas "calientes" totales (modificadas + nuevas) → animan aristas y dirs.
  const hot = hotPaths([...Object.keys(alerts), ...gitByPath.keys()]);

  // Rutas de archivos NUEVOS: creados (op=create) o untracked/staged en git.
  const newFilePaths = new Set<string>([
    ...Object.entries(alerts)
      .filter(([, v]) => v.op === 'create' || v.op === 'rename')
      .map(([p]) => p),
    ...[...gitByPath.entries()]
      .filter(([, s]) => s.status?.includes('?') || s.status === 'A')
      .map(([p]) => p),
  ]);
  // Cadena de ancestros de archivos nuevos → pulso verde en dirs.
  const hotNew = hotPaths(newFilePaths);

  let row = 0;

  const place = (n: TreeNode, depth: number, parentId: string | null): number => {
    const isRoot = n.path === '';
    const id = isRoot ? ROOT_ID : n.path;
    const isOpen = isRoot || (n.dir && expanded.includes(n.path));
    const children = n.dir && isOpen ? (n.children ?? []) : [];

    let y: number;
    if (children.length === 0) {
      y = row++;
    } else {
      const childYs = children.map((c) => place(c, depth + 1, id));
      y = (childYs[0] + childYs[childYs.length - 1]) / 2;
    }

    const alertEntry = alerts[n.path];
    const alertOp = alertEntry?.op ?? 'write';
    const stat = gitByPath.get(n.path);
    const isNew =
      alertOp === 'create' ||
      alertOp === 'rename' ||
      (stat?.status?.includes('?') ?? false) ||
      stat?.status === 'A';
    const isDeleted = stat?.status?.includes('D') ?? false;

    nodes.push({
      id,
      type: 'repo',
      position: { x: depth * COL_W, y: y * ROW_H },
      draggable: false,
      connectable: false,
      data: {
        name: isRoot ? projectName : n.name,
        path: n.path,
        kind: isRoot ? 'root' : n.dir ? 'dir' : 'file',
        expanded: isOpen,
        childCount: n.children?.length ?? 0,
        alert: !n.dir && alertEntry !== undefined,
        alertOp,
        isNew: !n.dir && isNew,
        isDeleted: !n.dir && isDeleted,
        // Dirs: pulso verde si hay nuevos en el subárbol, naranja si solo modificados.
        activity: isRoot ? hot.size > 0 : n.dir && hot.has(n.path) && !hotNew.has(n.path),
        activityNew: isRoot ? newFilePaths.size > 0 : n.dir && hotNew.has(n.path),
        stat,
      },
    });

    if (parentId) {
      const isHot = hot.has(n.path);
      const isHotNew = hotNew.has(n.path);
      edges.push({
        id: `${parentId}→${id}`,
        source: parentId,
        target: id,
        type: 'smoothstep',
        animated: isHot,
        style: isHotNew
          ? { stroke: 'var(--alert-green)', strokeWidth: 1.6, strokeOpacity: 0.9 }
          : isHot
            ? { stroke: 'var(--alert-orange)', strokeWidth: 1.6, strokeOpacity: 0.9 }
            : { stroke: 'var(--gold-dim)', strokeOpacity: 0.45 },
      });
    }
    return y;
  };

  place(tree, 0, null);
  return { nodes, edges };
}

// ── Nodo custom ─────────────────────────────────────────────────

function RepoNode({ data }: NodeProps<MapNode>) {
  // Determinar clase de animación del nodo
  const fileAnimCls = data.alert
    ? data.isNew
      ? 'animate-file-new'
      : 'animate-file-blink'
    : '';

  const nodeCls = [
    'map-node',
    data.kind === 'root'
      ? 'map-node--root'
      : data.kind === 'dir'
        ? 'map-node--dir'
        : 'map-node--file',
    // Lomo lateral: verde=nuevo, rojo=borrado, gold=modificado
    data.isNew && data.stat ? 'map-node--new' : '',
    data.isDeleted ? 'map-node--deleted' : '',
    !data.isNew && !data.isDeleted && data.stat ? 'map-node--mod' : '',
    // Pulso de borde: verde para nuevos, naranja para modificados
    data.activityNew ? 'map-node--activity--new' : data.activity || data.alert ? 'map-node--activity' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={nodeCls}>
      <Handle type="target" position={Position.Left} className="map-handle" />

      {data.kind === 'root' ? (
        <AgentLogo size={18} className="shrink-0" />
      ) : data.kind === 'dir' ? (
        <>
          {data.expanded ? (
            <IconChevronDown className="h-3 w-3 shrink-0 text-muted" />
          ) : (
            <IconChevronRight className="h-3 w-3 shrink-0 text-muted" />
          )}
          {data.expanded ? (
            <IconFolderOpen className="h-3.5 w-3.5 shrink-0 text-gold" />
          ) : (
            <IconFolder className="h-3.5 w-3.5 shrink-0 text-gold-dim" />
          )}
        </>
      ) : (
        <IconFile
          className={`h-3.5 w-3.5 shrink-0 ${
            fileAnimCls
              ? fileAnimCls
              : data.isNew && data.stat
                ? 'text-alert-green'
                : data.stat
                  ? 'text-gold'
                  : 'text-muted'
          }`}
        />
      )}

      <span className={`min-w-0 truncate ${fileAnimCls}`}>{data.name}</span>

      {data.kind !== 'file' && !data.expanded && (data.childCount ?? 0) > 0 && (
        <span className="map-node__badge">{data.childCount}</span>
      )}

      {data.stat && !data.isDeleted && (
        <span className="ml-auto shrink-0 text-[9px] font-semibold">
          <span className="text-alert-green">+{data.stat.additions}</span>{' '}
          <span className="text-alert-red">−{data.stat.deletions}</span>
        </span>
      )}
      {data.isDeleted && (
        <span className="ml-auto shrink-0 text-[9px] font-semibold text-alert-red">borrado</span>
      )}

      {data.kind !== 'file' && (
        <Handle type="source" position={Position.Right} className="map-handle" />
      )}
    </div>
  );
}

// ── Nodo terminal anclado ───────────────────────────────────────

interface TermNodeData extends Record<string, unknown> {
  projectId: string;
  termId: string;
  title: string;
}

type TermNode = Node<TermNodeData>;

function TerminalNode({ data }: NodeProps<TermNode>) {
  const { projectId, termId, title } = data;
  const isAgent = termId === AGENT_TERM_ID;

  const popOut = () => {
    useStore.getState().unpinTerm(projectId, termId);
    useStore.getState().focusTerm(termId);
    useStore.getState().setTerminalModalOpen(true);
  };

  const closeShell = async () => {
    try {
      await api.closeTerminal(projectId, termId);
    } catch (err) {
      useStore.getState().pushToast({ level: 'error', title: 'Terminal', message: (err as Error).message });
    }
  };

  return (
    <div className="map-term-node">
      <NodeResizer
        minWidth={360}
        minHeight={220}
        maxWidth={1200}
        maxHeight={820}
        isVisible
        lineClassName="map-term-node__resize-line"
        handleClassName="map-term-node__resize-handle"
      />
      <Handle type="target" position={Position.Left} className="map-handle" />

      {/* Cabecera: zona de arrastre (sin nodrag) + botones (con nodrag) */}
      <div className="map-term-node__header">
        <IconTerminal className="h-3.5 w-3.5 shrink-0 text-gold" />
        <span className="hud-label shrink-0">{isAgent ? 'Agente' : 'Shell'}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-secondary">{title}</span>
        <button
          className="nodrag map-term-node__btn"
          onClick={popOut}
          title="Devolver a ventana (desanclar)"
        >
          <IconPinOff className="h-3.5 w-3.5" />
        </button>
        {!isAgent && (
          <button
            className="nodrag map-term-node__btn map-term-node__btn--danger"
            onClick={closeShell}
            title="Cerrar este shell"
          >
            <IconTrash className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Cuerpo: nodrag (selección de texto) + nowheel (scroll del xterm) */}
      <div className="nodrag nowheel map-term-node__body">
        <TerminalView projectId={projectId} termId={termId} fontSize={11} />
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { repo: RepoNode, terminal: TerminalNode };

// Centra la cámara sobre una terminal anclada cuando cambia la señal de foco.
// Debe vivir DENTRO de <ReactFlow> para acceder a su instancia.
function PinnedFocuser({ projectId }: { projectId: string }) {
  const rf = useReactFlow();
  const focus = useStore((s) => s.pinnedFocus);
  const pinned = useStore((s) => s.pinnedTerms[projectId]);

  useEffect(() => {
    if (!focus) return;
    const p = pinned?.find((x) => x.termId === focus.termId);
    if (!p) return;
    rf.setCenter(p.x + p.w / 2, p.y + p.h / 2, { zoom: 1, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.seq]);

  return null;
}

// AutoFitter mantiene el mapa encuadrado cuando la ESTRUCTURA del árbol cambia
// (se añaden/quitan nodos por fs_change). Sin esto, como React Flow solo encuadra
// al inicio, un cambio reordena las coordenadas y el viewport queda apuntando a
// una zona vacía → el mapa "desaparece". Respeta la navegación manual: si el
// usuario ya hizo zoom/pan, no reencuadra (userMovedRef). Debe vivir DENTRO de
// <ReactFlow> para acceder a su instancia.
function AutoFitter({
  structureKey,
  userMovedRef,
}: {
  structureKey: string;
  userMovedRef: React.RefObject<boolean>;
}) {
  const rf = useReactFlow();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      // El primer encuadre lo hace la prop fitView; aquí solo reaccionamos a cambios.
      first.current = false;
      return;
    }
    if (userMovedRef.current) return; // el usuario tomó el control de la cámara
    const t = setTimeout(() => rf.fitView({ padding: 0.15, duration: 400 }), 250);
    return () => clearTimeout(t);
  }, [structureKey, rf, userMovedRef]);

  return null;
}

// El minimapa refleja el estado de cada nodo:
// verde = nuevo, ámbar = modificado, gris = sin cambios.
function minimapNodeColor(n: Node): string {
  const d = n.data as MapNodeData;
  if (d.isNew && (d.alert || d.activityNew || d.stat)) return 'rgba(69, 212, 131, 0.85)';
  if (d.activityNew) return 'rgba(69, 212, 131, 0.6)';
  if (d.alert || d.activity) return 'rgba(245, 166, 35, 0.85)';
  if (d.isDeleted) return 'rgba(248, 81, 73, 0.7)';
  if (d.kind === 'file') return 'rgba(107, 107, 107, 0.45)';
  return 'rgba(237, 237, 237, 0.5)';
}

// ── Mapa ────────────────────────────────────────────────────────

export function NodeMap() {
  const focused = useStore(selectFocusedProject);
  const version = useStore((s) => (focused ? (s.treeVersion[focused.id] ?? 0) : 0));
  const alerts = useStore((s) => (focused ? s.fileAlerts[focused.id] : undefined));
  const expanded = useStore((s) => (focused ? s.expandedDirs[focused.id] : undefined));
  const snap = useStore((s) => (focused ? s.git[focused.id] : undefined));
  const pinned = useStore((s) => (focused ? s.pinnedTerms[focused.id] : undefined));
  const terminals = useStore((s) => (focused ? s.terminals[focused.id] : undefined));

  const [tree, setTree] = useState<TreeNode | null>(null);
  const [reloadSeq, setReloadSeq] = useState(0);
  // ¿El usuario tomó el control de la cámara (zoom/pan manual)? Si no, el mapa
  // se reencuadra solo cuando cambia la estructura, para no perderlo de vista.
  const userMovedRef = useRef(false);
  const [bgCfg, setBgCfg] = useState<BgConfig>(loadBgConfig);
  const [bgMenuOpen, setBgMenuOpen] = useState(false);
  const bgMenuRef = useRef<HTMLDivElement>(null);

  const bgVariant = BG_VARIANT_MAP[bgCfg.pattern];

  const updateBg = (partial: Partial<BgConfig>) => {
    const next = { ...bgCfg, ...partial };
    setBgCfg(next);
    saveBgConfig(next);
  };

  // Cierra el menú si el usuario hace clic fuera.
  useEffect(() => {
    if (!bgMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (bgMenuRef.current && !bgMenuRef.current.contains(e.target as HTMLElement)) {
        setBgMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bgMenuOpen]);

  // ── Popover de cambios al hacer hover sobre un archivo modificado ──
  // Se ancla en coordenadas de pantalla (fuera del transform del zoom) y
  // muestra SOLO las líneas añadidas/eliminadas del diff de ese archivo.
  const sectionRef = useRef<HTMLElement>(null);
  const [hover, setHover] = useState<{ path: string; stat: FileStat; x: number; y: number } | null>(
    null,
  );
  const [hoverRows, setHoverRows] = useState<DiffRow[] | null>(null);
  const hoverPathRef = useRef<string | null>(null);
  const diffCache = useRef(new Map<string, DiffRow[]>());

  // Cada git_update puede cambiar cualquier diff: la caché se invalida.
  useEffect(() => {
    diffCache.current.clear();
  }, [snap?.updatedAt]);

  const hideHover = () => {
    hoverPathRef.current = null;
    setHover(null);
    setHoverRows(null);
  };

  // Al cambiar de proyecto o al recargar manualmente el árbol, devolvemos el
  // control de encuadre al mapa (recentrar).
  useEffect(() => {
    userMovedRef.current = false;
  }, [focused?.id, reloadSeq]);

  useEffect(() => {
    if (!focused) return;
    let cancelled = false;
    api
      .getTree(focused.id)
      .then((t) => !cancelled && setTree(t))
      .catch((err) =>
        useStore.getState().pushToast({
          level: 'error',
          title: 'Mapa táctico',
          message: (err as Error).message,
        }),
      );
    return () => {
      cancelled = true;
    };
  }, [focused?.id, version, reloadSeq]);

  const { nodes, edges } = useMemo(() => {
    if (!tree || !focused) return { nodes: [], edges: [] };
    const gitByPath = new Map((snap?.files ?? []).map((f) => [f.path, f]));
    return buildGraph(tree, focused.name, expanded ?? [], alerts ?? {}, gitByPath);
  }, [tree, focused?.id, focused?.name, expanded, alerts, snap?.files]);

  // Firma de la ESTRUCTURA (conjunto de ids de nodos): cambia al añadirse/
  // quitarse archivos o expandir/colapsar carpetas, pero NO ante meros cambios
  // de contenido (git_update). Dispara el reencuadre automático.
  const structureKey = useMemo(() => {
    let h = nodes.length;
    for (const n of nodes) {
      for (let i = 0; i < n.id.length; i++) h = (h * 31 + n.id.charCodeAt(i)) | 0;
    }
    return String(h);
  }, [nodes]);

  // Nodos de las terminales ancladas (independientes del árbol del repo).
  const termNodes = useMemo<TermNode[]>(() => {
    if (!focused || !pinned?.length) return [];
    const titleFor = (termId: string) =>
      termId === AGENT_TERM_ID
        ? focused.cliCommand || 'Agente'
        : (terminals?.find((t) => t.id === termId)?.title ?? termId);
    return pinned.map((p: PinnedTerm) => ({
      id: `term:${p.termId}`,
      type: 'terminal',
      position: { x: p.x, y: p.y },
      width: p.w,
      height: p.h,
      style: { width: p.w, height: p.h },
      draggable: true,
      selectable: true,
      data: { projectId: focused.id, termId: p.termId, title: titleFor(p.termId) },
    }));
  }, [focused?.id, focused?.cliCommand, pinned, terminals]);

  // Aplica al store los cambios de posición/tamaño de los nodos terminal
  // (los nodos del árbol son fijos y se ignoran).
  const onNodesChange = (changes: NodeChange[]) => {
    if (!focused) return;
    for (const c of changes) {
      if (c.type === 'position' && c.position && c.id.startsWith('term:')) {
        useStore.getState().updatePinned(focused.id, c.id.slice(5), {
          x: c.position.x,
          y: c.position.y,
        });
      } else if (c.type === 'dimensions' && c.dimensions && c.id.startsWith('term:')) {
        useStore.getState().updatePinned(focused.id, c.id.slice(5), {
          w: c.dimensions.width,
          h: c.dimensions.height,
        });
      }
    }
  };

  // Pan/zoom MANUAL del usuario (event != null): a partir de ahí dejamos de
  // reencuadrar solos. Los movimientos programáticos (fitView) traen event=null.
  const handleMoveStart = (event: MouseEvent | TouchEvent | null) => {
    if (event) userMovedRef.current = true;
    hideHover();
  };

  if (!focused) return null;

  const alertEntries = Object.entries(alerts ?? {});
  const alertNewCount = alertEntries.filter(([, v]) => v.op === 'create' || v.op === 'rename').length;
  const alertModCount = alertEntries.length - alertNewCount;
  const alertCount = alertEntries.length;

  const gitFiles = snap?.files ?? [];
  const newFileCount = gitFiles.filter((f) => f.status?.includes('?') || f.status === 'A').length;
  const dirtyCount = gitFiles.length;

  const onNodeClick = (_: React.MouseEvent, node: Node) => {
    if (node.type !== 'repo') return;
    const d = node.data as MapNodeData;
    if (d.kind === 'dir') {
      useStore.getState().toggleDir(focused.id, d.path);
    } else if (d.kind === 'file') {
      hideHover();
      useStore.getState().setSelectedFile(d.path);
      useStore.getState().clearFileAlert(focused.id, d.path);
    }
  };

  const POP_W = 460; // ancho del popover, para decidir el lado de anclaje
  const POP_H = 320; // alto máximo, para no salirse por abajo

  const onNodeMouseEnter = (event: React.MouseEvent, node: Node) => {
    if (node.type !== 'repo') return;
    const d = node.data as MapNodeData;
    // Solo archivos con cambios sin commit tienen algo que enseñar.
    if (d.kind !== 'file' || !d.stat) return;
    const host = sectionRef.current;
    const el = event.currentTarget as HTMLElement | null;
    if (!host || !el?.getBoundingClientRect) return;

    const hostRect = host.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    // A la derecha del nodo; si no cabe, a la izquierda. Clamp vertical.
    let x = rect.right - hostRect.left + 10;
    if (x + POP_W > hostRect.width - 8) {
      x = Math.max(8, rect.left - hostRect.left - POP_W - 10);
    }
    const y = Math.min(Math.max(8, rect.top - hostRect.top), Math.max(8, hostRect.height - POP_H - 8));

    const path = d.path;
    hoverPathRef.current = path;
    setHover({ path, stat: d.stat, x, y });

    const cached = diffCache.current.get(path);
    if (cached) {
      setHoverRows(cached);
      return;
    }
    setHoverRows(null);
    api
      .getFileDiff(focused.id, path)
      .then((d) => {
        // Solo los cambios: fuera las líneas de contexto.
        const rows = parseDiff(d.diff)
          .flatMap((f) => f.rows)
          .filter((r) => r.kind !== 'ctx');
        diffCache.current.set(path, rows);
        if (hoverPathRef.current === path) setHoverRows(rows);
      })
      .catch(() => {});
  };

  return (
    <section
      ref={sectionRef}
      className="glass-panel glass-panel--terminal gotham-enter relative h-full min-h-0 overflow-hidden"
    >
      {/* Fondo cuadrícula degradada: dashed lines con fade radial desde el centro */}
      {bgCfg.pattern === 'dashedgrid' && <div className="map-bg-dashed-grid" />}
      {/* Fondo circuito: retícula con nodos en intersecciones, visible en el lado derecho */}
      {bgCfg.pattern === 'circuit' && <div className="map-bg-circuit" />}
      {/* Fondo diagonal: cruz en X sobre cuadrícula de 40px */}
      {bgCfg.pattern === 'diagonal' && <div className="map-bg-diagonal" />}
      {/* Fondo zigzag: capas de líneas en múltiples ángulos */}
      {bgCfg.pattern === 'zigzag' && <div className="map-bg-zigzag" />}

      <ReactFlow
        nodes={[...nodes, ...termNodes]}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={hideHover}
        onMoveStart={handleMoveStart}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.1}
        maxZoom={2.5}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        onlyRenderVisibleElements
        style={{ background: 'transparent' }}
      >
        <PinnedFocuser projectId={focused.id} />
        <AutoFitter structureKey={structureKey} userMovedRef={userMovedRef} />
        {bgVariant !== null && (
          <Background
            variant={bgVariant}
            gap={bgCfg.pattern === 'cross' ? 32 : 24}
            size={bgCfg.pattern === 'dots' ? 1 : bgCfg.pattern === 'cross' ? 10 : undefined}
            color="rgba(255,255,255,0.09)"
          />
        )}
        <Controls showInteractive={false} position="top-right" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={minimapNodeColor}
          nodeStrokeWidth={2}
          maskColor="rgba(0, 0, 0, 0.65)"
        />

        {/* HUD: menú de fondo + nombre del proyecto + recarga */}
        <Panel position="top-left" className="flex items-center gap-2">
          {/* Botón-menú que reemplaza la etiqueta "Mapa táctico" */}
          <div ref={bgMenuRef} className="relative">
            <button
              className={`map-bg-trigger ${bgMenuOpen ? 'map-bg-trigger--open' : ''}`}
              onClick={() => setBgMenuOpen((v) => !v)}
              title="Cambiar fondo del mapa"
            >
              <IconSettings className="h-3.5 w-3.5" />
              <span>Configuración</span>
            </button>

            {bgMenuOpen && (
              <div className="map-bg-menu">
                <p className="map-bg-menu__section">Fondo</p>
                <div className="map-bg-menu__grid">
                  {BG_PATTERNS.map((p) => (
                    <button
                      key={p.id}
                      className={`map-bg-option ${bgCfg.pattern === p.id ? 'map-bg-option--active' : ''}`}
                      onClick={() => updateBg({ pattern: p.id })}
                      title={p.label}
                    >
                      <span className="map-bg-option__icon">{p.icon}</span>
                      <span>{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <span className="hud-value rounded bg-[rgba(0,0,0,0.75)] px-2 py-1">{focused.name}</span>
          <button
            className="btn-tactical btn-tactical--cyan flex items-center justify-center p-1.5"
            onClick={() => setReloadSeq((n) => n + 1)}
            title="Recargar árbol"
          >
            <IconRefresh className="h-3.5 w-3.5" />
          </button>
        </Panel>

        {/* HUD: estado del watcher */}
        <Panel position="bottom-left">
          <span className="hud-label flex items-center gap-2 rounded bg-[rgba(0,0,0,0.75)] px-2 py-1">
            {alertCount > 0 ? (
              <>
                {alertNewCount > 0 && (
                  <>
                    <span className="notification-pulse notification-pulse--green" />
                    {alertNewCount} nuevo(s)
                  </>
                )}
                {alertNewCount > 0 && alertModCount > 0 && (
                  <span className="text-[var(--border-active)]">·</span>
                )}
                {alertModCount > 0 && (
                  <>
                    <span className="notification-pulse notification-pulse--gold" />
                    {alertModCount} cambiando
                  </>
                )}
              </>
            ) : dirtyCount > 0 ? (
              <>
                {newFileCount > 0 && (
                  <>
                    <span className="notification-pulse notification-pulse--green" />
                    {newFileCount} nuevo(s)
                  </>
                )}
                {newFileCount > 0 && dirtyCount - newFileCount > 0 && (
                  <span className="text-[var(--border-active)]">·</span>
                )}
                {dirtyCount - newFileCount > 0 && (
                  <>
                    <span className="notification-pulse notification-pulse--gold" />
                    {dirtyCount - newFileCount} modificado(s)
                  </>
                )}
                {newFileCount === 0 && dirtyCount - newFileCount === 0 && (
                  <>
                    <span className="notification-pulse notification-pulse--gold" />
                    {dirtyCount} sin commit
                  </>
                )}
              </>
            ) : (
              <>
                <span className="notification-pulse notification-pulse--green" />
                Working tree limpio · vigilando en vivo
              </>
            )}
          </span>
        </Panel>
      </ReactFlow>

      {/* Popover de cambios: hover sobre un archivo modificado. Clic abre
          el visor completo, así que aquí no hace falta interacción. */}
      {hover && (
        <div
          className="map-popover pointer-events-none absolute z-20 flex flex-col overflow-hidden rounded-md border border-[var(--border-active)] bg-[var(--bg-secondary)]"
          style={{ left: hover.x, top: hover.y, width: POP_W, maxHeight: POP_H }}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-primary)] px-3 py-1.5">
            <span className="hud-value truncate">{hover.path}</span>
            <span className="shrink-0 font-mono text-[10px] font-semibold">
              <span className="text-alert-green">+{hover.stat.additions}</span>{' '}
              <span className="text-alert-red">−{hover.stat.deletions}</span>
            </span>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden bg-[var(--bg-primary)]">
            {hoverRows === null ? (
              <p className="hud-label px-3 py-2">Cargando cambios…</p>
            ) : hoverRows.length === 0 ? (
              <p className="hud-label px-3 py-2">
                Sin diff textual (binario o pendiente de git add)
              </p>
            ) : (
              <DiffRows rows={hoverRows.slice(0, 40)} />
            )}
          </div>
          {hoverRows !== null && hoverRows.length > 40 && (
            <footer className="shrink-0 border-t border-[var(--border-primary)] px-3 py-1">
              <span className="hud-label">
                +{hoverRows.length - 40} líneas más · clic para abrir el archivo
              </span>
            </footer>
          )}
        </div>
      )}
    </section>
  );
}
