// PUERTO de salida: contrato que el núcleo necesita para persistencia local.
// La implementación concreta vive en infrastructure/storage/StorageService.ts.
import type { PinnedTerm } from '../project';

export interface IStorage {
  loadRecentIds(): string[];
  saveRecentIds(ids: string[]): void;
  addRecentId(id: string, current: string[]): string[];
  loadPinnedTerms(): Record<string, PinnedTerm[]>;
  savePinnedTerms(map: Record<string, PinnedTerm[]>): void;
}
