// Cliente fino de la API REST del backend.
import type { GitSnapshot, Project, TermInfo } from '../store/store';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

export const api = {
  listProjects: () => request<Project[]>('/api/projects'),

  browse: (path?: string) =>
    request<FsListing>(`/api/fs${path ? `?path=${encodeURIComponent(path)}` : ''}`),

  createProject: (data: { name: string; path: string; cliCommand: string }) =>
    request<Project>('/api/projects', { method: 'POST', body: JSON.stringify(data) }),

  deleteProject: (id: string) =>
    request<void>(`/api/projects/${id}`, { method: 'DELETE' }),

  startProject: (id: string) =>
    request<Project>(`/api/projects/${id}/start`, { method: 'POST' }),

  stopProject: (id: string) =>
    request<Project>(`/api/projects/${id}/stop`, { method: 'POST' }),

  getDiff: (id: string) => request<GitSnapshot>(`/api/projects/${id}/diff`),

  listTerminals: (id: string) => request<TermInfo[]>(`/api/projects/${id}/terminals`),

  createTerminal: (id: string, title?: string) =>
    request<TermInfo>(`/api/projects/${id}/terminals`, {
      method: 'POST',
      body: JSON.stringify({ title: title ?? '' }),
    }),

  closeTerminal: (id: string, termId: string) =>
    request<void>(`/api/projects/${id}/terminals/${termId}`, { method: 'DELETE' }),
};
