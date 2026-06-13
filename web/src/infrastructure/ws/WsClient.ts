// ADAPTADOR de salida: implementa IRealtimeClient usando WebSocket nativo.
// Patrón: Singleton + Observer (terminal listeners)
import type { IRealtimeClient, TerminalListener } from '../../core/domain/ports/IRealtimeClient';
import type { ServerEvent } from '../../core/domain/events';
import { AGENT_TERM_ID } from '../../core/domain/project';

class WsClient implements IRealtimeClient {
  private static instance: WsClient | null = null;

  private socket: WebSocket | null = null;
  private retryDelay = 500;
  private queue: string[] = [];
  private listeners = new Map<string, Set<TerminalListener>>();
  private eventHandler: ((evt: ServerEvent) => void) | null = null;
  private statusHandler: ((status: 'connecting' | 'open' | 'closed') => void) | null = null;

  private constructor() {}

  static getInstance(): WsClient {
    if (!WsClient.instance) {
      WsClient.instance = new WsClient();
    }
    return WsClient.instance;
  }

  onServerEvent(handler: (evt: ServerEvent) => void): void {
    this.eventHandler = handler;
  }

  onStatusChange(handler: (status: 'connecting' | 'open' | 'closed') => void): void {
    this.statusHandler = handler;
  }

  connect(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    this.statusHandler?.('connecting');
    this.socket = new WebSocket(this.wsURL());

    this.socket.onopen = () => {
      this.retryDelay = 500;
      this.statusHandler?.('open');
      for (const msg of this.queue.splice(0)) this.socket?.send(msg);
    };

    this.socket.onmessage = (e) => {
      const evt = JSON.parse(e.data) as ServerEvent;
      if ((evt.type === 'output' || evt.type === 'replay') && evt.projectId) {
        const bytes = this.base64ToBytes(evt.payload as string);
        const key = this.streamKey(evt.projectId, evt.termId ?? AGENT_TERM_ID);
        this.listeners.get(key)?.forEach((fn) => fn(bytes, evt.type === 'replay'));
        return;
      }
      this.eventHandler?.(evt);
    };

    this.socket.onclose = () => {
      this.statusHandler?.('closed');
      this.socket = null;
      setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 10_000);
    };

    this.socket.onerror = () => this.socket?.close();
  }

  private send(msg: Record<string, unknown>): void {
    const raw = JSON.stringify(msg);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(raw);
    } else {
      this.queue.push(raw);
    }
  }

  subscribeProject(projectId: string): void {
    this.send({ type: 'subscribe', projectId });
  }

  unsubscribeProject(projectId: string): void {
    this.send({ type: 'unsubscribe', projectId });
  }

  attach(projectId: string, termId: string = AGENT_TERM_ID): void {
    this.send({ type: 'attach', projectId, termId });
  }

  detach(projectId: string): void {
    this.send({ type: 'detach', projectId });
  }

  sendInput(projectId: string, termId: string, data: string): void {
    this.send({ type: 'input', projectId, termId, data });
  }

  sendResize(projectId: string, termId: string, cols: number, rows: number): void {
    this.send({ type: 'resize', projectId, termId, cols, rows });
  }

  subscribeTerminal(projectId: string, termId: string, fn: TerminalListener): () => void {
    const key = this.streamKey(projectId, termId);
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (set!.size === 0) this.listeners.delete(key);
    };
  }

  private streamKey(projectId: string, termId: string): string {
    return `${projectId}\0${termId}`;
  }

  private wsURL(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  private base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
}

export const wsClient = WsClient.getInstance();
