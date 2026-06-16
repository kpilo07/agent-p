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
  GitBranches,
  GitSnapshot,
  GrepMatch,
  Project,
  TermInfo,
  Ticket,
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

  getBranches(id: string): Promise<GitBranches> {
    return this.request(`/api/projects/${id}/branches`);
  }

  gitCheckout(id: string, branch: string, create?: boolean): Promise<void> {
    return this.request(`/api/projects/${id}/git/checkout`, {
      method: 'POST',
      body: JSON.stringify({ branch, create: create ?? false }),
    });
  }

  grep(id: string, query: string): Promise<GrepMatch[]> {
    return this.request(`/api/projects/${id}/grep?q=${encodeURIComponent(query)}`);
  }

  gitFetch(id: string): Promise<void> {
    return this.request(`/api/projects/${id}/git/fetch`, { method: 'POST' });
  }

  gitPush(id: string): Promise<void> {
    return this.request(`/api/projects/${id}/git/push`, { method: 'POST' });
  }

  gitPull(id: string): Promise<void> {
    return this.request(`/api/projects/${id}/git/pull`, { method: 'POST' });
  }

  gitCommit(id: string, message: string, files?: string[]): Promise<void> {
    return this.request(`/api/projects/${id}/git/commit`, {
      method: 'POST',
      body: JSON.stringify({ message, files: files ?? [] }),
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

  listTickets(id: string): Promise<Ticket[]> {
    return this.request(`/api/projects/${id}/tickets`);
  }

  createTicket(id: string, data: { title: string; body: string; files: string[] }): Promise<Ticket> {
    return this.request(`/api/projects/${id}/tickets`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  launchTicket(ticketId: number): Promise<Ticket> {
    return this.request(`/api/tickets/${ticketId}/launch`, { method: 'POST' });
  }

  closeTicket(ticketId: number): Promise<Ticket> {
    return this.request(`/api/tickets/${ticketId}/close`, { method: 'POST' });
  }

  deleteTicket(ticketId: number): Promise<void> {
    return this.request(`/api/tickets/${ticketId}`, { method: 'DELETE' });
  }

  ticketCommits(ticketId: number): Promise<Commit[]> {
    return this.request(`/api/tickets/${ticketId}/commits`);
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
