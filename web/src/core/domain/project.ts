// Entidades puras del dominio. Sin dependencias de infraestructura.

export interface Project {
  id: string;
  name: string;
  path: string;
  cliCommand: string;
  running: boolean;
}

export interface Session {
  id: number;
  projectId: string;
  status: string;
  startedAt: string;
  endedAt?: string;
}

export interface FileStat {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface GitSnapshot {
  branch: string;
  diff: string;
  files: FileStat[] | null;
  additions: number;
  deletions: number;
  initial: boolean;
  updatedAt: string;
}

export interface TermInfo {
  id: string;
  title: string;
  running: boolean;
}

/** Tipo de evento del timeline de actividad (espejo de domain.Activity* en Go). */
export type ActivityKind =
  | 'session_start'
  | 'session_end'
  | 'git_change'
  | 'branch_switch'
  | 'commit'
  | 'stash'
  | 'discard'
  | 'interrupt';

/** Entrada del timeline de actividad de un proyecto. */
export interface ActivityEvent {
  id: number;
  projectId: string;
  kind: ActivityKind;
  message: string;
  branch?: string;
  additions?: number;
  deletions?: number;
  files?: number;
  createdAt: string;
}

/** ID de la terminal principal (la del agente de IA). */
export const AGENT_TERM_ID = 'agent';

/** Terminal anclada como nodo en el Mapa Táctico (posición/tamaño en coords de flow). */
export interface PinnedTerm {
  termId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Tipos para el explorador de archivos ─────────────────────────

export interface FsEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

export interface FsListing {
  path: string;
  parent?: string;
  isGitRepo: boolean;
  entries: FsEntry[];
}

/** Nodo del árbol del repositorio (Mapa Táctico). */
export interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  children?: TreeNode[];
}

export interface FileDiff {
  path: string;
  diff: string;
}

/** Commit del historial de la rama actual (espejo de domain.Commit en Go). */
export interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  additions: number;
  deletions: number;
  files: FileStat[] | null;
}

/** Diff textual completo de un commit, pedido bajo demanda. */
export interface CommitDiff {
  hash: string;
  diff: string;
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
  binary: boolean;
}
