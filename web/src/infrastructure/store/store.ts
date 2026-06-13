// Estado global con Zustand.
//
// Solo orquesta estado de UI. Toda la lógica de negocio está en
// core/use-cases/ y toda la comunicación con el exterior en infrastructure/.
import { sileo } from 'sileo';
import { create } from 'zustand';

import type { GitSnapshot, Project, TermInfo, FileStat } from '../../core/domain/project';
import { AGENT_TERM_ID } from '../../core/domain/project';
import type { Toast, ToastLevel, WsStatus, ServerEvent } from '../../core/domain/events';
import { storageService } from '../storage/StorageService';

// Re-exportamos los tipos del dominio para que los componentes tengan un
// punto de importación estable (se puede cambiar la fuente sin tocar imports).
export type { Project, GitSnapshot, TermInfo, FileStat, Toast, ToastLevel, WsStatus, ServerEvent };
export { AGENT_TERM_ID };

// ── Estado interno del store ─────────────────────────────────────

interface AppState {
  projects: Project[];
  focusedId: string | null;
  activeIds: string[];
  unread: Record<string, number>;
  git: Record<string, GitSnapshot>;
  recentIds: string[];
  wsStatus: WsStatus;
  projectsModalOpen: boolean;
  diffModalOpen: boolean;
  terminals: Record<string, TermInfo[]>;
  focusedTermId: string;
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
  setWsStatus: (status: WsStatus) => void;
  setProjectsModalOpen: (open: boolean) => void;
  setDiffModalOpen: (open: boolean) => void;
  setTerminals: (projectId: string, terms: TermInfo[]) => void;
  focusTerm: (termId: string) => void;
  toggleDir: (projectId: string, path: string) => void;
  clearFileAlert: (projectId: string, path: string) => void;
  setSelectedFile: (path: string | null) => void;
  setTerminalModalOpen: (open: boolean) => void;
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
  recentIds: storageService.loadRecentIds(),
  wsStatus: 'connecting',
  projectsModalOpen: false,
  diffModalOpen: false,
  terminals: {},
  focusedTermId: AGENT_TERM_ID,
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

  setWsStatus: (wsStatus) => set({ wsStatus }),

  setProjectsModalOpen: (projectsModalOpen) => set({ projectsModalOpen }),

  setDiffModalOpen: (diffModalOpen) => set({ diffModalOpen }),

  setTerminals: (projectId, terms) =>
    set((s) => ({ terminals: { ...s.terminals, [projectId]: terms } })),

  focusTerm: (focusedTermId) => set({ focusedTermId }),

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
          return { terminals: { ...s.terminals, [projectId]: next }, ...focusFix };
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
