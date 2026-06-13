// Estado global con Zustand.
//
// Maneja: lista de proyectos, proyecto en foco, proyectos activos en segundo
// plano, snapshots de git diff por proyecto y el sistema de notificaciones en
// tiempo real (toasts + badges de no-leídos).
//
// La salida cruda de las terminales NO pasa por este store (sería demasiado
// "caliente" para React): viaja por un canal de listeners en lib/ws.ts
// directamente hacia la instancia de xterm.
import { sileo } from 'sileo';
import { create } from 'zustand';

// ── Tipos ────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  path: string;
  cliCommand: string;
  running: boolean;
}

export interface FileStat {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface GitSnapshot {
  diff: string;
  files: FileStat[] | null;
  additions: number;
  deletions: number;
  initial: boolean;
  updatedAt: string;
}

export type ToastLevel = 'git' | 'session' | 'info' | 'error';

/** Notificación a mostrar con Sileo. Si trae projectId, ofrece "Ver" para
 *  enfocar el proyecto que la originó (eventos en segundo plano). */
export interface Toast {
  projectId?: string;
  level: ToastLevel;
  title: string;
  message: string;
}

export type WsStatus = 'connecting' | 'open' | 'closed';

/** ID de la terminal principal (la del agente de IA). */
export const AGENT_TERM_ID = 'agent';

export interface TermInfo {
  id: string;
  title: string;
  running: boolean;
}

// Eventos del servidor (espejo de internal/hub en Go).
export interface ServerEvent {
  type: 'output' | 'replay' | 'git_update' | 'fs_change' | 'notification' | 'session_state';
  projectId?: string;
  termId?: string;
  payload?: unknown;
}

interface AppState {
  projects: Project[];
  /** Proyecto mostrado en la pantalla principal. */
  focusedId: string | null;
  /** Proyectos abiertos (con PTY/watcher corriendo), incluidos los de fondo. */
  activeIds: string[];
  /** Badge de eventos sin leer por proyecto en segundo plano. */
  unread: Record<string, number>;
  /** Último snapshot de git por proyecto. */
  git: Record<string, GitSnapshot>;
  /** IDs de proyectos por orden de uso reciente (el más reciente primero). */
  recentIds: string[];
  wsStatus: WsStatus;
  /** Modal del panel de proyectos (grid de carpetas). */
  projectsModalOpen: boolean;
  /** Modal del visor de git diff. */
  diffModalOpen: boolean;
  /** Terminales abiertas por proyecto (agente + shells extra). */
  terminals: Record<string, TermInfo[]>;
  /** Terminal en foco dentro del proyecto enfocado. */
  focusedTermId: string;

  // ── Mapa Táctico ──
  /** Carpetas expandidas del explorador, por proyecto (paths relativos). */
  expandedDirs: Record<string, string[]>;
  /** Alertas de archivos recién modificados (fs_change): path → timestamp. */
  fileAlerts: Record<string, Record<string, number>>;
  /** Contador que fuerza la recarga del árbol cuando cambia la estructura. */
  treeVersion: Record<string, number>;
  /** Archivo seleccionado para el visor (null = cerrado). */
  selectedFile: string | null;
  /** Modal de la consola (Modo Mapa: la terminal es una herramienta más). */
  terminalModalOpen: boolean;
  /** Buscador de archivos (command palette). */
  searchOpen: boolean;

  // ── Acciones ──
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
  /** Muestra una notificación (Sileo). */
  pushToast: (toast: Toast) => void;
  /** Reductor central de eventos WebSocket del backend. */
  handleServerEvent: (evt: ServerEvent) => void;
}

// ── Store ────────────────────────────────────────────────────────

// Cada nivel de notificación se pinta con la variante de Sileo acorde.
type SileoOpts = Parameters<typeof sileo.info>[0];
const SILEO_BY_LEVEL: Record<ToastLevel, (opts: SileoOpts) => string> = {
  error: (o) => sileo.error(o),
  session: (o) => sileo.warning(o),
  git: (o) => sileo.info(o),
  info: (o) => sileo.info(o),
};

// Tras este tiempo sin nuevos cambios, el parpadeo del archivo se apaga solo.
const FILE_ALERT_TTL_MS = 15_000;

// Proyectos abiertos recientemente (para los accesos directos de la pantalla
// de inicio). Se recuerda entre sesiones y se ordena del más reciente al más
// antiguo.
const RECENT_KEY = 'agent-p:recent';
const RECENT_MAX = 8;

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export const useStore = create<AppState>((set, get) => ({
  projects: [],
  focusedId: null,
  activeIds: [],
  unread: {},
  git: {},
  recentIds: loadRecent(),
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

  // Enfocar un proyecto lo activa, limpia su badge, vuelve a la terminal del
  // agente y lo sube al principio de los recientes (persistido).
  focusProject: (id) =>
    set((s) => {
      if (!id) return { focusedId: id };
      const recentIds = [id, ...s.recentIds.filter((r) => r !== id)].slice(0, RECENT_MAX);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(recentIds));
      } catch {
        /* almacenamiento no disponible: la recencia se queda en memoria */
      }
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
    // Los eventos de un proyecto en segundo plano ofrecen saltar a él.
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
        // El badge del proyecto en fondo se alimenta aquí; el toast llega por
        // el evento global 'notification' que emite el backend.
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
            [projectId]: { ...s.fileAlerts[projectId], [path]: stamp },
          },
        }));
        // El parpadeo expira solo si nadie abre el archivo; un cambio más
        // reciente (stamp distinto) reinicia el plazo.
        setTimeout(() => {
          if (get().fileAlerts[projectId]?.[path] === stamp) {
            get().clearFileAlert(projectId, path);
          }
        }, FILE_ALERT_TTL_MS);
        // Crear/borrar/renombrar altera la estructura: el árbol se recarga.
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
        // Solo alertamos de lo que NO está delante del usuario.
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

        // Mantiene la lista de pestañas de terminal del proyecto.
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

        // El estado "activo" del proyecto lo marca su terminal de agente.
        if (termId === AGENT_TERM_ID) {
          get().markActive(projectId, running);
          if (!running && isBackground) {
            set((s) => ({ unread: { ...s.unread, [projectId]: (s.unread[projectId] ?? 0) + 1 } }));
          }
        }
        break;
      }

      // 'output' y 'replay' se despachan a xterm desde lib/ws.ts, no aquí.
    }
  },
}));

// Selectores de conveniencia.
export const selectFocusedProject = (s: AppState) =>
  s.projects.find((p) => p.id === s.focusedId) ?? null;

// pickRecentProjects: hasta 3 proyectos para los accesos directos de inicio.
// Primero los de uso reciente (en orden); si faltan, se rellena con los demás
// proyectos del más nuevo al más viejo (la lista llega ordenada por antigüedad).
// Helper puro (no es un selector de Zustand): el llamador lo memoiza sobre
// `projects`/`recentIds` para no romper la igualdad por referencia.
export function pickRecentProjects(projects: Project[], recentIds: string[]): Project[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const recent = recentIds.map((id) => byId.get(id)).filter((p): p is Project => !!p);
  const seen = new Set(recent.map((p) => p.id));
  const rest = [...projects].reverse().filter((p) => !seen.has(p.id));
  return [...recent, ...rest].slice(0, 3);
}
