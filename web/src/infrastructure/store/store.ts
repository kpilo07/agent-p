// Estado global con Zustand.
//
// Solo orquesta estado de UI. Toda la lógica de negocio está en
// core/use-cases/ y toda la comunicación con el exterior en infrastructure/.
import { sileo } from 'sileo';
import { create } from 'zustand';

import type {
  ActivityEvent,
  Commit,
  GitSnapshot,
  PinnedTerm,
  Project,
  TermInfo,
  FileStat,
} from '../../core/domain/project';
import { AGENT_TERM_ID } from '../../core/domain/project';
import type { Toast, ToastLevel, WsStatus, ServerEvent } from '../../core/domain/events';
import { storageService } from '../storage/StorageService';

// Re-exportamos los tipos del dominio para que los componentes tengan un
// punto de importación estable (se puede cambiar la fuente sin tocar imports).
export type {
  Project,
  GitSnapshot,
  Commit,
  TermInfo,
  FileStat,
  ActivityEvent,
  PinnedTerm,
  Toast,
  ToastLevel,
  WsStatus,
  ServerEvent,
};
export { AGENT_TERM_ID };

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
  activityModalOpen: boolean;
  terminals: Record<string, TermInfo[]>;
  focusedTermId: string;
  pinnedTerms: Record<string, PinnedTerm[]>;
  pinnedFocus: { termId: string; seq: number } | null;
  expandedDirs: Record<string, string[]>;
  fileAlerts: Record<string, Record<string, { stamp: number; op: string }>>;
  treeVersion: Record<string, number>;
  selectedFile: string | null;
  terminalModalOpen: boolean;
  searchOpen: boolean;

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
  setActivityModalOpen: (open: boolean) => void;
  setTerminals: (projectId: string, terms: TermInfo[]) => void;
  focusTerm: (termId: string) => void;
  pinTerm: (projectId: string, termId: string) => void;
  unpinTerm: (projectId: string, termId: string) => void;
  updatePinned: (projectId: string, termId: string, patch: Partial<PinnedTerm>) => void;
  focusPinned: (termId: string) => void;
  toggleDir: (projectId: string, path: string) => void;
  clearFileAlert: (projectId: string, path: string) => void;
  setSelectedFile: (path: string | null) => void;
  setTerminalModalOpen: (open: boolean) => void;
  openTerminal: (termId: string) => void;
  setSearchOpen: (open: boolean) => void;
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
  activityModalOpen: false,
  terminals: {},
  focusedTermId: AGENT_TERM_ID,
  pinnedTerms: storageService.loadPinnedTerms(),
  pinnedFocus: null,
  expandedDirs: {},
  fileAlerts: {},
  treeVersion: {},
  selectedFile: null,
  terminalModalOpen: false,
  searchOpen: false,

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

  setActivityModalOpen: (activityModalOpen) => set({ activityModalOpen }),

  setTerminals: (projectId, terms) =>
    set((s) => ({ terminals: { ...s.terminals, [projectId]: terms } })),

  focusTerm: (focusedTermId) => set({ focusedTermId }),

  pinTerm: (projectId, termId) =>
    set((s) => {
      const list = s.pinnedTerms[projectId] ?? [];
      if (list.some((p) => p.termId === termId)) {
        // Ya anclada: solo la enfocamos.
        return { pinnedFocus: { termId, seq: (s.pinnedFocus?.seq ?? 0) + 1 } };
      }
      const n = list.length;
      const pin: PinnedTerm = { termId, x: 300 + n * 48, y: 24 + n * 48, w: 880, h: 520 };
      const pinnedTerms = { ...s.pinnedTerms, [projectId]: [...list, pin] };
      storageService.savePinnedTerms(pinnedTerms);
      return { pinnedTerms, pinnedFocus: { termId, seq: (s.pinnedFocus?.seq ?? 0) + 1 } };
    }),

  unpinTerm: (projectId, termId) =>
    set((s) => {
      const list = s.pinnedTerms[projectId];
      if (!list?.some((p) => p.termId === termId)) return s;
      const pinnedTerms = { ...s.pinnedTerms, [projectId]: list.filter((p) => p.termId !== termId) };
      storageService.savePinnedTerms(pinnedTerms);
      return { pinnedTerms };
    }),

  updatePinned: (projectId, termId, patch) =>
    set((s) => {
      const list = s.pinnedTerms[projectId];
      if (!list) return s;
      const next = list.map((p) => (p.termId === termId ? { ...p, ...patch } : p));
      const pinnedTerms = { ...s.pinnedTerms, [projectId]: next };
      storageService.savePinnedTerms(pinnedTerms);
      return { pinnedTerms };
    }),

  focusPinned: (termId) =>
    set((s) => ({ pinnedFocus: { termId, seq: (s.pinnedFocus?.seq ?? 0) + 1 } })),

  toggleDir: (projectId, path) =>
    set((s) => {
      const open = s.expandedDirs[projectId] ?? [];
      const next = open.includes(path) ? open.filter((p) => p !== path) : [...open, path];
      return { expandedDirs: { ...s.expandedDirs, [projectId]: next } };
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

  // Abre una consola: si está anclada al tablero, centra su nodo; si no, la
  // enfoca en el modal. Lógica de UI compartida por la Toolbar y los atajos.
  openTerminal: (termId) => {
    const s = get();
    const pid = s.focusedId;
    if (pid && s.pinnedTerms[pid]?.some((p) => p.termId === termId)) {
      get().focusPinned(termId);
      return;
    }
    set({ focusedTermId: termId, terminalModalOpen: true });
  },

  setSearchOpen: (searchOpen) => set({ searchOpen }),

  pushToast: ({ level, title, message, projectId }) => {
    const fn = SILEO_BY_LEVEL[level];
    const button = projectId
      ? { title: 'Ver', onClick: () => get().focusProject(projectId) }
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
          message: p.message ?? 'Evento en proyecto en segundo plano',
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
          // Si la sesión terminó, desanclar su nodo del tablero.
          let pinnedFix = {};
          if (!running) {
            const list = s.pinnedTerms[projectId];
            if (list?.some((p) => p.termId === termId)) {
              const pinnedTerms = {
                ...s.pinnedTerms,
                [projectId]: list.filter((p) => p.termId !== termId),
              };
              storageService.savePinnedTerms(pinnedTerms);
              pinnedFix = { pinnedTerms };
            }
          }
          return { terminals: { ...s.terminals, [projectId]: next }, ...focusFix, ...pinnedFix };
        });

        if (termId === AGENT_TERM_ID) {
          get().markActive(projectId, running);
          if (!running && isBackground) {
            set((s) => ({ unread: { ...s.unread, [projectId]: (s.unread[projectId] ?? 0) + 1 } }));
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
