// ADAPTADOR de salida: implementa IApiRepository usando fetch.
// Patrón: Singleton + Repository
import type { AuthStatus, IApiRepository } from '../../core/domain/ports/IApiRepository';
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
} from '../../core/domain/project';

class ApiClient implements IApiRepository {
  private static instance: ApiClient | null = null;

  // Handler invocado ante un 401 (sesión ausente o caducada). La capa de
  // presentación lo usa para volver a la pantalla de login.
  private unauthorizedHandler: (() => void) | null = null;

  private constructor() {}

  static getInstance(): ApiClient {
    if (!ApiClient.instance) {
      ApiClient.instance = new ApiClient();
    }
    return ApiClient.instance;
  }

  onUnauthorized(handler: () => void): void {
    this.unauthorizedHandler = handler;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    if (!res.ok) {
      // El endpoint de status nunca debe disparar el rebote a login.
      if (res.status === 401 && path !== '/api/auth/status') {
        this.unauthorizedHandler?.();
      }
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  authStatus(): Promise<AuthStatus> {
    return this.request('/api/auth/status');
  }

  authSetup(username: string, password: string): Promise<void> {
    return this.request('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  authLogin(username: string, password: string): Promise<void> {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  authLogout(): Promise<void> {
    return this.request('/api/auth/logout', { method: 'POST' });
  }

  listProjects(): Promise<Project[]> {
    return this.request('/api/projects');
  }

  createProject(data: { name: string; path: string; cliCommand: string }): Promise<Project> {
    return this.request('/api/projects', { method: 'POST', body: JSON.stringify(data) });
  }

  deleteProject(id: string): Promise<void> {
    return this.request(`/api/projects/${id}`, { method: 'DELETE' });
  }

  startProject(id: string): Promise<Project> {
    return this.request(`/api/projects/${id}/start`, { method: 'POST' });
  }

  stopProject(id: string): Promise<Project> {
    return this.request(`/api/projects/${id}/stop`, { method: 'POST' });
  }

  interruptAgent(id: string): Promise<void> {
    return this.request(`/api/projects/${id}/interrupt`, { method: 'POST' });
  }

  getDiff(id: string): Promise<GitSnapshot> {
    return this.request(`/api/projects/${id}/diff`);
  }

  getCommits(id: string, limit?: number): Promise<Commit[]> {
    return this.request(`/api/projects/${id}/commits${limit ? `?limit=${limit}` : ''}`);
  }

  getCommitDiff(id: string, hash: string): Promise<CommitDiff> {
    return this.request(`/api/projects/${id}/commit?hash=${encodeURIComponent(hash)}`);
  }

  gitCommit(id: string, message: string): Promise<void> {
    return this.request(`/api/projects/${id}/git/commit`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  gitStash(id: string): Promise<void> {
    return this.request(`/api/projects/${id}/git/stash`, { method: 'POST' });
  }

  gitDiscard(id: string, path?: string): Promise<void> {
    return this.request(`/api/projects/${id}/git/discard`, {
      method: 'POST',
      body: JSON.stringify({ path: path ?? '' }),
    });
  }

  getActivity(id: string, limit?: number): Promise<ActivityEvent[]> {
    return this.request(`/api/projects/${id}/activity${limit ? `?limit=${limit}` : ''}`);
  }

  getFileDiff(id: string, path: string): Promise<FileDiff> {
    return this.request(`/api/projects/${id}/file-diff?path=${encodeURIComponent(path)}`);
  }

  getTree(id: string): Promise<TreeNode> {
    return this.request(`/api/projects/${id}/tree`);
  }

  getFile(id: string, path: string): Promise<FileContent> {
    return this.request(`/api/projects/${id}/file?path=${encodeURIComponent(path)}`);
  }

  rawFileURL(id: string, path: string): string {
    return `/api/projects/${id}/raw?path=${encodeURIComponent(path)}`;
  }

  listTerminals(id: string): Promise<TermInfo[]> {
    return this.request(`/api/projects/${id}/terminals`);
  }

  createTerminal(id: string, title?: string): Promise<TermInfo> {
    return this.request(`/api/projects/${id}/terminals`, {
      method: 'POST',
      body: JSON.stringify({ title: title ?? '' }),
    });
  }

  closeTerminal(id: string, termId: string): Promise<void> {
    return this.request(`/api/projects/${id}/terminals/${termId}`, { method: 'DELETE' });
  }

  browse(path?: string): Promise<FsListing> {
    return this.request(`/api/fs${path ? `?path=${encodeURIComponent(path)}` : ''}`);
  }
}

export const apiClient = ApiClient.getInstance();
