// PUERTO de salida: contrato que el núcleo necesita para persistencia local.
// La implementación concreta vive en infrastructure/storage/StorageService.ts.
export interface IStorage {
  loadRecentIds(): string[];
  saveRecentIds(ids: string[]): void;
  addRecentId(id: string, current: string[]): string[];
}
