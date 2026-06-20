// Estado global con Zustand.
//
// Solo orquesta estado de UI. Toda la lógica de negocio está en
// core/use-cases/ y toda la comunicación con el exterior en infrastructure/.
import { sileo } from 'sileo';
import { create } from 'zustand';

import type {
  ActivityEvent,
  Checkpoint,
  Commit,
  GitBranches,
  GitSnapshot,
  Project,
  TermInfo,
  Ticket,
  FileStat,
} from '../../core/domain/project';
import { AGENT_TERM_ID } from '../../core/domain/project';
import type { Toast, ToastLevel, WsStatus, ServerEvent } from '../../core/domain/events';
import { storageService } from '../storage/StorageService';
import { notify } from '../ui/notify';

/** Estado detectado de un agente (espejo del backend). */
export type AgentState = 'working' | 'idle' | 'waiting';

// Re-exportamos los tipos del dominio para que los componentes tengan un
// punto de importación estable (se puede cambiar la fuente sin tocar imports).
export type {
  Project,
  GitSnapshot,
  Commit,
  Checkpoint,
  GitBranches,
  TermInfo,
  FileStat,
  ActivityEvent,
  Ticket,
  Toast,
  ToastLevel,
  WsStatus,
  ServerEvent,
};
export { AGENT_TERM_ID };

// ── Sidebar de terminales/agentes ────────────────────────────────
// Overlay izquierdo con el agente y las consolas. Estado persistido en
// localStorage y compartido por el Sidebar (UI) y el NodeMap (inset del fitView).

export interface SidebarState {
  collapsed: boolean;
  /** Ancho en px cuando está expandido. */
  width: number;
}

const SIDEBAR_KEY = 'agent-p:sidebar:v2';

function defaultSidebarWidth(): number {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  return Math.min(820, Math.max(320, Math.round(vw * 0.3)));
}

function loadSidebar(): SidebarState {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<SidebarState>;
      return {
        collapsed: !!s.collapsed,
        width: typeof s.width === 'number' ? s.width : defaultSidebarWidth(),
      };
    }
  } catch {}
  return { collapsed: false, width: defaultSidebarWidth() };
}

// ── Configuración del Mapa Táctico ───────────────────────────────
// Persistida en localStorage y compartida por el StatusBar (controles) y el
// NodeMap (render). `pattern` = fondo del lienzo; `mode` = normal | dev.

export type BgPattern =
  | 'dots' | 'lines' | 'cross' | 'dashedgrid' | 'circuit' | 'diagonal' | 'zigzag' | 'none';
export type MapMode = 'normal' | 'dev';

export interface MapConfig {
  pattern: BgPattern;
  mode: MapMode;
}

const MAP_CONFIG_KEY = 'map-bg-config';

function loadMapConfig(): MapConfig {
  try {
    const raw = localStorage.getItem(MAP_CONFIG_KEY);
    if (raw) {
      const cfg = JSON.parse(raw) as Partial<MapConfig>;
      return { pattern: cfg.pattern ?? 'dots', mode: cfg.mode ?? 'normal' };
    }
  } catch {}
  return { pattern: 'dots', mode: 'normal' };
}

// ── Estado interno del store ─────────────────────────────────────

interface AppState {
  projects: Project[];
  focusedId: string | null;
  activeIds: string[];
  unread: Record<string, number>;
  git: Record<string, GitSnapshot>;
  activity: Record<string, ActivityEvent[]>;
  recentIds: string[];
  wsStatus: WsStatus;
  projectsModalOpen: boolean;
  diffModalOpen: boolean;
  commitHistoryOpen: boolean;
  checkpointsOpen: boolean;
  activityModalOpen: boolean;
  ticketsModalOpen: boolean;
  terminals: Record<string, TermInfo[]>;
  focusedTermId: string;
  /** Estado detectado de cada agente: projectId → termId → estado. */
  agentState: Record<string, Record<string, AgentState>>;
  /** Agentes que "necesitan atención" (settled sin que el usuario los viera). */
  agentAttention: Record<string, Record<string, boolean>>;
  sidebar: SidebarState;
  expandedDirs: Record<string, string[]>;
  fileAlerts: Record<string, Record<string, { stamp: number; op: string }>>;
  treeVersion: Record<string, number>;
  selectedFile: string | null;
  terminalModalOpen: boolean;
  searchOpen: boolean;
  contentSearchOpen: boolean;
  mapConfig: MapConfig;
  /** Señal para forzar la recarga del árbol del mapa (botón reload del StatusBar). */
  mapReloadSeq: number;

  setProjects: (projects: Project[]) => void;
  upsertProject: (project: Project) => void;
  removeProject: (id: string) => void;
  focusProject: (id: string | null) => void;
  markActive: (id: string, active: boolean) => void;
  setGit: (projectId: string, snap: GitSnapshot) => void;
  setActivity: (projectId: string, events: ActivityEvent[]) => void;
  setWsStatus: (status: WsStatus) => void;
  setProjectsModalOpen: (open: boolean) => void;
  setDiffModalOpen: (open: boolean) => void;
  setCommitHistoryOpen: (open: boolean) => void;
  setCheckpointsOpen: (open: boolean) => void;
  setActivityModalOpen: (open: boolean) => void;
  setTicketsModalOpen: (open: boolean) => void;
  setTerminals: (projectId: string, terms: TermInfo[]) => void;
  focusTerm: (termId: string) => void;
  clearAttention: (projectId: string, termId: string) => void;
  setSidebar: (partial: Partial<SidebarState>) => void;
  toggleDir: (projectId: string, path: string) => void;
  expandDirs: (projectId: string, paths: string[]) => void;
  clearFileAlert: (projectId: string, path: string) => void;
  setSelectedFile: (path: string | null) => void;
  setTerminalModalOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setContentSearchOpen: (open: boolean) => void;
  setMapConfig: (partial: Partial<MapConfig>) => void;
  reloadMap: () => void;
  pushToast: (toast: Toast) => void;
  handleServerEvent: (evt: ServerEvent) => void;
}

// ── Configuración de Sileo por nivel ─────────────────────────────

type SileoOpts = Parameters<typeof sileo.info>[0];
const SILEO_BY_LEVEL: Record<ToastLevel, (opts: SileoOpts) => string> = {
  error: (o) => sileo.error(o),
  session: (o) => sileo.warning(o),
  git: (o) => sileo.info(o),
  info: (o) => sileo.info(o),
};

const FILE_ALERT_TTL_MS = 15_000;

// Quita el aviso de atención de (projectId, termId). Devuelve el nuevo mapa o
// null si no había nada que limpiar (para evitar re-renders innecesarios).
function clearAtt(
  map: Record<string, Record<string, boolean>>,
  projectId: string,
  termId: string,
): Record<string, Record<string, boolean>> | null {
  if (!map[projectId]?.[termId]) return null;
  const { [termId]: _omit, ...rest } = map[projectId];
  return { ...map, [projectId]: rest };
}

// ── Store ─────────────────────────────────────────────────────────

export const useStore = create<AppState>((set, get) => ({
  projects: [],
  focusedId: null,
  activeIds: [],
  unread: {},
  git: {},
  activity: {},
  recentIds: storageService.loadRecentIds(),
  wsStatus: 'connecting',
  projectsModalOpen: false,
  diffModalOpen: false,
  commitHistoryOpen: false,
  checkpointsOpen: false,
  activityModalOpen: false,
  ticketsModalOpen: false,
  terminals: {},
  focusedTermId: AGENT_TERM_ID,
  agentState: {},
  agentAttention: {},
  sidebar: loadSidebar(),
  expandedDirs: {},
  fileAlerts: {},
  treeVersion: {},
  selectedFile: null,
  terminalModalOpen: false,
  searchOpen: false,
  contentSearchOpen: false,
  mapConfig: loadMapConfig(),
  mapReloadSeq: 0,

  setProjects: (projects) =>
    set((s) => ({
      projects,
      activeIds: [
        ...new Set([
          ...s.activeIds.filter((id) => projects.some((p) => p.id === id)),
          ...projects.filter((p) => p.running).map((p) => p.id),
        ]),
      ],
    })),

  upsertProject: (project) =>
    set((s) => ({
      projects: s.projects.some((p) => p.id === project.id)
        ? s.projects.map((p) => (p.id === project.id ? project : p))
        : [...s.projects, project],
    })),

  removeProject: (id) =>
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      activeIds: s.activeIds.filter((a) => a !== id),
      focusedId: s.focusedId === id ? null : s.focusedId,
    })),

  focusProject: (id) =>
    set((s) => {
      if (!id) return { focusedId: id };
      const recentIds = storageService.addRecentId(id, s.recentIds);
      storageService.saveRecentIds(recentIds);
      return {
        focusedId: id,
        focusedTermId: AGENT_TERM_ID,
        activeIds: s.activeIds.includes(id) ? s.activeIds : [...s.activeIds, id],
        unread: { ...s.unread, [id]: 0 },
        recentIds,
      };
    }),

  markActive: (id, active) =>
    set((s) => ({
      activeIds: active
        ? [...new Set([...s.activeIds, id])]
        : s.activeIds.filter((a) => a !== id),
      projects: s.projects.map((p) => (p.id === id ? { ...p, running: active } : p)),
    })),

  setGit: (projectId, snap) => set((s) => ({ git: { ...s.git, [projectId]: snap } })),

  setActivity: (projectId, events) =>
    set((s) => ({ activity: { ...s.activity, [projectId]: events } })),

  setWsStatus: (wsStatus) => set({ wsStatus }),

  setProjectsModalOpen: (projectsModalOpen) => set({ projectsModalOpen }),

  setDiffModalOpen: (diffModalOpen) => set({ diffModalOpen }),

  setCommitHistoryOpen: (commitHistoryOpen) => set({ commitHistoryOpen }),
  setCheckpointsOpen: (checkpointsOpen) => set({ checkpointsOpen }),

  setActivityModalOpen: (activityModalOpen) => set({ activityModalOpen }),

  setTicketsModalOpen: (ticketsModalOpen) => set({ ticketsModalOpen }),

  setTerminals: (projectId, terms) =>
    set((s) => ({ terminals: { ...s.terminals, [projectId]: terms } })),

  // Enfocar una terminal la marca como "vista": limpia su aviso de atención.
  focusTerm: (focusedTermId) =>
    set((s) => {
      const pid = s.focusedId;
      const fix = pid ? clearAtt(s.agentAttention, pid, focusedTermId) : null;
      return fix ? { focusedTermId, agentAttention: fix } : { focusedTermId };
    }),

  clearAttention: (projectId, termId) =>
    set((s) => {
      const fix = clearAtt(s.agentAttention, projectId, termId);
      return fix ? { agentAttention: fix } : s;
    }),

  setSidebar: (partial) =>
    set((s) => {
      const next = { ...s.sidebar, ...partial };
      try {
        localStorage.setItem(SIDEBAR_KEY, JSON.stringify(next));
      } catch {}
      return { sidebar: next };
    }),

  toggleDir: (projectId, path) =>
    set((s) => {
      const open = s.expandedDirs[projectId] ?? [];
      const next = open.includes(path) ? open.filter((p) => p !== path) : [...open, path];
      return { expandedDirs: { ...s.expandedDirs, [projectId]: next } };
    }),

  // Asegura que un conjunto de carpetas quede expandido (unión, sin colapsar).
  // Lo usa el modo "dev" para abrir la ruta hasta cada archivo modificado.
  expandDirs: (projectId, paths) =>
    set((s) => {
      const open = s.expandedDirs[projectId] ?? [];
      const missing = paths.filter((p) => !open.includes(p));
      if (missing.length === 0) return s;
      return { expandedDirs: { ...s.expandedDirs, [projectId]: [...open, ...missing] } };
    }),

  clearFileAlert: (projectId, path) =>
    set((s) => {
      const alerts = s.fileAlerts[projectId];
      if (!alerts?.[path]) return s;
      const { [path]: _, ...rest } = alerts;
      return { fileAlerts: { ...s.fileAlerts, [projectId]: rest } };
    }),

  setSelectedFile: (selectedFile) => set({ selectedFile }),

  setTerminalModalOpen: (terminalModalOpen) => set({ terminalModalOpen }),

  setSearchOpen: (searchOpen) => set({ searchOpen }),

  setContentSearchOpen: (contentSearchOpen) => set({ contentSearchOpen }),

  setMapConfig: (partial) =>
    set((s) => {
      const next = { ...s.mapConfig, ...partial };
      try {
        localStorage.setItem(MAP_CONFIG_KEY, JSON.stringify(next));
      } catch {}
      return { mapConfig: next };
    }),

  reloadMap: () => set((s) => ({ mapReloadSeq: s.mapReloadSeq + 1 })),

  pushToast: ({ level, title, message, projectId }) => {
    const fn = SILEO_BY_LEVEL[level];
    const button = projectId
      ? { title: 'View', onClick: () => get().focusProject(projectId) }
      : undefined;
    fn({ title, description: message, button });
  },

  handleServerEvent: (evt) => {
    const { focusedId, projects } = get();
    const projectId = evt.projectId;
    const project = projects.find((p) => p.id === projectId);
    const isBackground = projectId !== undefined && projectId !== focusedId;

    switch (evt.type) {
      case 'git_update': {
        if (!projectId) return;
        const snap = evt.payload as GitSnapshot;
        get().setGit(projectId, snap);
        if (isBackground && !snap.initial) {
          set((s) => ({ unread: { ...s.unread, [projectId]: (s.unread[projectId] ?? 0) + 1 } }));
        }
        break;
      }

      case 'fs_change': {
        if (!projectId) return;
        const { path, op } = evt.payload as { path: string; op: string };
        const stamp = Date.now();
        set((s) => ({
          fileAlerts: {
            ...s.fileAlerts,
            [projectId]: { ...s.fileAlerts[projectId], [path]: { stamp, op } },
          },
        }));
        setTimeout(() => {
          if (get().fileAlerts[projectId]?.[path]?.stamp === stamp) {
            get().clearFileAlert(projectId, path);
          }
        }, FILE_ALERT_TTL_MS);
        if (op !== 'write') {
          set((s) => ({
            treeVersion: {
              ...s.treeVersion,
              [projectId]: (s.treeVersion[projectId] ?? 0) + 1,
            },
          }));
        }
        break;
      }

      case 'activity': {
        if (!projectId) return;
        const ev = evt.payload as ActivityEvent;
        set((s) => {
          const prev = s.activity[projectId] ?? [];
          if (prev.some((e) => e.id === ev.id)) return s;
          return { activity: { ...s.activity, [projectId]: [ev, ...prev].slice(0, 200) } };
        });
        break;
      }

      case 'notification': {
        const p = (evt.payload ?? {}) as {
          level?: ToastLevel;
          project?: string;
          message?: string;
        };
        if (!isBackground) return;
        get().pushToast({
          projectId,
          level: p.level ?? 'info',
          title: p.project ?? project?.name ?? 'agent-p',
          message: p.message ?? 'Event in background project',
        });
        break;
      }

      case 'session_state': {
        if (!projectId) return;
        const termId = evt.termId ?? AGENT_TERM_ID;
        const { running, title } = evt.payload as { running: boolean; title?: string };

        set((s) => {
          const terms = s.terminals[projectId] ?? [];
          const next = running
            ? terms.some((t) => t.id === termId)
              ? terms.map((t) => (t.id === termId ? { ...t, running } : t))
              : [...terms, { id: termId, title: title ?? termId, running }]
            : terms.filter((t) => t.id !== termId);
          const focusFix =
            !running && s.focusedId === projectId && s.focusedTermId === termId
              ? { focusedTermId: AGENT_TERM_ID }
              : {};
          // Al terminar una sesión, olvidamos su estado y aviso de atención.
          let stateFix = {};
          if (!running) {
            const att = clearAtt(s.agentAttention, projectId, termId);
            const st = s.agentState[projectId];
            if (st?.[termId] !== undefined) {
              const { [termId]: _o, ...restSt } = st;
              stateFix = { agentState: { ...s.agentState, [projectId]: restSt } };
            }
            if (att) stateFix = { ...stateFix, agentAttention: att };
          }
          return { terminals: { ...s.terminals, [projectId]: next }, ...focusFix, ...stateFix };
        });

        if (termId === AGENT_TERM_ID) {
          get().markActive(projectId, running);
          if (!running && isBackground) {
            set((s) => ({ unread: { ...s.unread, [projectId]: (s.unread[projectId] ?? 0) + 1 } }));
          }
        }
        break;
      }

      case 'agent_state': {
        if (!projectId) return;
        const termId = evt.termId ?? AGENT_TERM_ID;
        const { state } = evt.payload as { state: AgentState };
        const s = get();
        const prev = s.agentState[projectId]?.[termId];
        // "Settled": pasó de trabajar a inactivo/esperando → es tu turno.
        const settled = prev === 'working' && (state === 'idle' || state === 'waiting');
        const watching =
          s.focusedId === projectId &&
          s.focusedTermId === termId &&
          !s.sidebar.collapsed &&
          typeof document !== 'undefined' &&
          !document.hidden;
        const needAtt = settled && !watching;

        set((st) => {
          const agentState = {
            ...st.agentState,
            [projectId]: { ...st.agentState[projectId], [termId]: state },
          };
          if (!needAtt) return { agentState };
          return {
            agentState,
            agentAttention: {
              ...st.agentAttention,
              [projectId]: { ...st.agentAttention[projectId], [termId]: true },
            },
          };
        });

        if (needAtt) {
          const name = project?.name ?? 'agent-p';
          const msg =
            state === 'waiting' ? 'El agente espera tu confirmación' : 'El agente terminó su turno';
          if (isBackground) {
            set((st) => ({ unread: { ...st.unread, [projectId]: (st.unread[projectId] ?? 0) + 1 } }));
            get().pushToast({ projectId, level: 'session', title: name, message: msg });
          }
          if (isBackground || (typeof document !== 'undefined' && document.hidden)) {
            notify(`${name} · necesita atención`, msg);
          }
        }
        break;
      }
    }
  },
}));

// ── Selectores ────────────────────────────────────────────────────

export const selectFocusedProject = (s: AppState) =>
  s.projects.find((p) => p.id === s.focusedId) ?? null;

export function pickRecentProjects(projects: Project[], recentIds: string[]): Project[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const recent = recentIds.map((id) => byId.get(id)).filter((p): p is Project => !!p);
  const seen = new Set(recent.map((p) => p.id));
  const rest = [...projects].reverse().filter((p) => !seen.has(p.id));
  return [...recent, ...rest].slice(0, 3);
}
