// PUERTO de salida: contrato que el núcleo necesita del adaptador WebSocket.
// La implementación concreta vive en infrastructure/ws/WsClient.ts.
import type { ServerEvent } from '../events';

export type TerminalListener = (data: Uint8Array, isReplay: boolean) => void;

export interface IRealtimeClient {
  // Ciclo de vida
  connect(): void;

  // Callbacks (inyectados desde infrastructure/store o App)
  onServerEvent(handler: (evt: ServerEvent) => void): void;
  onStatusChange(handler: (status: 'connecting' | 'open' | 'closed') => void): void;

  // Suscripciones al proyecto
  subscribeProject(projectId: string): void;
  unsubscribeProject(projectId: string): void;

  // Terminal (comandos)
  attach(projectId: string, termId?: string): void;
  detach(projectId: string): void;
  sendInput(projectId: string, termId: string, data: string): void;
  sendResize(projectId: string, termId: string, cols: number, rows: number): void;

  // Observer: stream de bytes hacia xterm (bypass React)
  subscribeTerminal(projectId: string, termId: string, fn: TerminalListener): () => void;
}
