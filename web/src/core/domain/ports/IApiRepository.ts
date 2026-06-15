// PUERTO de salida: contrato que el núcleo necesita del adaptador HTTP.
// La implementación concreta vive en infrastructure/api/ApiClient.ts.
import type {
  ActivityEvent,
  Commit,
  CommitDiff,
  FileContent,
  FileDiff,
  FsListing,
  GitSnapshot,
  Project,
  TermInfo,
  TreeNode,
} from '../project';

export interface AuthStatus {
  needsSetup: boolean;
  authenticated: boolean;
}

export interface IApiRepository {
  // Autenticación
  authStatus(): Promise<AuthStatus>;
  authSetup(username: string, password: string): Promise<void>;
  authLogin(username: string, password: string): Promise<void>;
  authLogout(): Promise<void>;

  // Proyectos
  listProjects(): Promise<Project[]>;
  createProject(data: { name: string; path: string; cliCommand: string }): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  startProject(id: string): Promise<Project>;
  stopProject(id: string): Promise<Project>;
  interruptAgent(id: string): Promise<void>;

  // Git
  getDiff(id: string): Promise<GitSnapshot>;
  getFileDiff(id: string, path: string): Promise<FileDiff>;
  getCommits(id: string, limit?: number): Promise<Commit[]>;
  getCommitDiff(id: string, hash: string): Promise<CommitDiff>;
  gitCommit(id: string, message: string): Promise<void>;
  gitStash(id: string): Promise<void>;
  gitDiscard(id: string, path?: string): Promise<void>;

  // Timeline de actividad
  getActivity(id: string, limit?: number): Promise<ActivityEvent[]>;

  // Árbol de archivos
  getTree(id: string): Promise<TreeNode>;
  getFile(id: string, path: string): Promise<FileContent>;
  rawFileURL(id: string, path: string): string;

  // Terminales
  listTerminals(id: string): Promise<TermInfo[]>;
  createTerminal(id: string, title?: string): Promise<TermInfo>;
  closeTerminal(id: string, termId: string): Promise<void>;

  // Explorador de filesystem
  browse(path?: string): Promise<FsListing>;
}
