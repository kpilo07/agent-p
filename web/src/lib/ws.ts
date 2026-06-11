// Conexión WebSocket única hacia el Hub del backend, con reconexión
// automática. Los eventos de estado van al store de Zustand; los bytes de
// terminal (output/replay) van por listeners directos a xterm para no
// provocar renders de React a cada chunk.
//
// Cada proyecto puede tener varias terminales (agente + shells extra): los
// streams se etiquetan con projectId + termId.
import { useStore, AGENT_TERM_ID, type ServerEvent } from '../store/store';

export type TerminalListener = (data: Uint8Array, isReplay: boolean) => void;

const listeners = new Map<string, Set<TerminalListener>>();
let socket: WebSocket | null = null;
let retryDelay = 500;
let queue: string[] = [];

const streamKey = (projectId: string, termId: string) => `${projectId}\0${termId}`;

function wsURL(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function connect(): void {
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  useStore.getState().setWsStatus('connecting');

  socket = new WebSocket(wsURL());

  socket.onopen = () => {
    retryDelay = 500;
    // Las tiles del mosaico se re-attachan solas al ver wsStatus = 'open'.
    useStore.getState().setWsStatus('open');
    for (const msg of queue.splice(0)) socket?.send(msg);
  };

  socket.onmessage = (e) => {
    const evt = JSON.parse(e.data) as ServerEvent;
    if ((evt.type === 'output' || evt.type === 'replay') && evt.projectId) {
      const bytes = base64ToBytes(evt.payload as string);
      const key = streamKey(evt.projectId, evt.termId ?? AGENT_TERM_ID);
      listeners.get(key)?.forEach((fn) => fn(bytes, evt.type === 'replay'));
      return;
    }
    useStore.getState().handleServerEvent(evt);
  };

  socket.onclose = () => {
    useStore.getState().setWsStatus('closed');
    socket = null;
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 10_000);
  };

  socket.onerror = () => socket?.close();
}

function send(msg: Record<string, unknown>): void {
  const raw = JSON.stringify(msg);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(raw);
  } else {
    queue.push(raw); // se vacía al reconectar
  }
}

// ── Comandos hacia el backend ───────────────────────────────────

export const attach = (projectId: string, termId: string = AGENT_TERM_ID) =>
  send({ type: 'attach', projectId, termId });
export const detach = (projectId: string) => send({ type: 'detach', projectId });
export const sendInput = (projectId: string, termId: string, data: string) =>
  send({ type: 'input', projectId, termId, data });
export const sendResize = (projectId: string, termId: string, cols: number, rows: number) =>
  send({ type: 'resize', projectId, termId, cols, rows });

// ── Stream de terminal (bypass de React) ────────────────────────

export function subscribeTerminal(
  projectId: string,
  termId: string,
  fn: TerminalListener,
): () => void {
  const key = streamKey(projectId, termId);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(key);
  };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
