// ADAPTADOR de salida: implementa IApiRepository usando fetch.
// Patrón: Singleton + Repository
import type { IApiRepository } from '../../core/domain/ports/IApiRepository';
import type {
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

  private constructor() {}

  static getInstance(): ApiClient {
    if (!ApiClient.instance) {
      ApiClient.instance = new ApiClient();
    }
    return ApiClient.instance;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
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

  getDiff(id: string): Promise<GitSnapshot> {
    return this.request(`/api/projects/${id}/diff`);
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
