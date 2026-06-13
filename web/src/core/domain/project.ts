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

/** ID de la terminal principal (la del agente de IA). */
export const AGENT_TERM_ID = 'agent';

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

export interface FileContent {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
  binary: boolean;
}
