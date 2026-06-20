// ADAPTADOR de salida: implementa IStorage usando localStorage.
// Patrón: Singleton
import type { IStorage } from '../../core/domain/ports/IStorage';

const RECENT_KEY = 'agent-p:recent';
const RECENT_MAX = 8;

class StorageService implements IStorage {
  private static instance: StorageService | null = null;

  private constructor() {}

  static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  loadRecentIds(): string[] {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  saveRecentIds(ids: string[]): void {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, RECENT_MAX)));
    } catch {
      // localStorage no disponible (modo privado, SSR, etc.)
    }
  }

  addRecentId(id: string, current: string[]): string[] {
    return [id, ...current.filter((r) => r !== id)].slice(0, RECENT_MAX);
  }
}

export const storageService = StorageService.getInstance();
