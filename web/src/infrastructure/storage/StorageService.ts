// ADAPTADOR de salida: implementa IStorage usando localStorage.
// Patrón: Singleton
import type { IStorage } from '../../core/domain/ports/IStorage';
import type { PinnedTerm } from '../../core/domain/project';

const RECENT_KEY = 'agent-p:recent';
const RECENT_MAX = 8;
const PINNED_KEY = 'agent-p:pinned-terms';

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

  loadPinnedTerms(): Record<string, PinnedTerm[]> {
    try {
      const raw = JSON.parse(localStorage.getItem(PINNED_KEY) ?? '{}');
      if (!raw || typeof raw !== 'object') return {};
      const map = raw as Record<string, PinnedTerm[]>;
      // Migración: anclajes con el tamaño antiguo y pequeño (380×240) se
      // reescalan al nuevo tamaño por defecto para que tengan un ancho
      // similar al del modal de terminal.
      for (const list of Object.values(map)) {
        for (const p of list ?? []) {
          if (p.w <= 380) p.w = 880;
          if (p.h <= 240) p.h = 520;
        }
      }
      return map;
    } catch {
      return {};
    }
  }

  savePinnedTerms(map: Record<string, PinnedTerm[]>): void {
    try {
      localStorage.setItem(PINNED_KEY, JSON.stringify(map));
    } catch {
      // localStorage no disponible (modo privado, SSR, etc.)
    }
  }
}

export const storageService = StorageService.getInstance();
