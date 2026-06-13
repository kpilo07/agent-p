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
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { apiClient as api } from '../../infrastructure/api/ApiClient';
import type { TreeNode } from '../../core/domain/project';
import { diffService } from '../../core/use-cases/DiffService';
import type { DiffRow } from '../../core/domain/diff';

const parseDiff = (diff: string) => diffService.parseDiff(diff);
import { selectFocusedProject, useStore, type FileStat } from '../../infrastructure/store/store';
import { DiffRows } from './DiffView';
import {
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconLogo,
  IconRefresh,
} from '../ui/icons';

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
      .filter(([, s]) => s.Status.includes('?') || s.Status === 'A')
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
      (stat?.Status.includes('?') ?? false) ||
      stat?.Status === 'A';
    const isDeleted = stat?.Status.includes('D') ?? false;

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
        <IconLogo className="h-4 w-4 shrink-0 text-gold" />
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

const nodeTypes: NodeTypes = { repo: RepoNode };

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

  const [tree, setTree] = useState<TreeNode | null>(null);
  const [reloadSeq, setReloadSeq] = useState(0);

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

  if (!focused) return null;

  const alertEntries = Object.entries(alerts ?? {});
  const alertNewCount = alertEntries.filter(([, v]) => v.op === 'create' || v.op === 'rename').length;
  const alertModCount = alertEntries.length - alertNewCount;
  const alertCount = alertEntries.length;

  const gitFiles = snap?.files ?? [];
  const newFileCount = gitFiles.filter((f) => f.Status.includes('?') || f.Status === 'A').length;
  const dirtyCount = gitFiles.length;

  const onNodeClick = (_: React.MouseEvent, node: MapNode) => {
    if (node.data.kind === 'dir') {
      useStore.getState().toggleDir(focused.id, node.data.path);
    } else if (node.data.kind === 'file') {
      hideHover();
      useStore.getState().setSelectedFile(node.data.path);
      useStore.getState().clearFileAlert(focused.id, node.data.path);
    }
  };

  const POP_W = 460; // ancho del popover, para decidir el lado de anclaje
  const POP_H = 320; // alto máximo, para no salirse por abajo

  const onNodeMouseEnter = (event: React.MouseEvent, node: MapNode) => {
    // Solo archivos con cambios sin commit tienen algo que enseñar.
    if (node.data.kind !== 'file' || !node.data.stat) return;
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

    const path = node.data.path;
    hoverPathRef.current = path;
    setHover({ path, stat: node.data.stat, x, y });

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
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={hideHover}
        onMoveStart={hideHover}
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
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="rgba(255, 255, 255, 0.09)"
        />
        <Controls showInteractive={false} position="top-right" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={minimapNodeColor}
          nodeStrokeWidth={2}
          maskColor="rgba(0, 0, 0, 0.65)"
        />

        {/* HUD: identidad + recarga */}
        <Panel position="top-left" className="flex items-center gap-3">
          <span className="hud-label rounded bg-[rgba(0,0,0,0.75)] px-2 py-1">Mapa táctico</span>
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
