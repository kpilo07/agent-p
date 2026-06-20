// Tipos de eventos del sistema. Espejo del protocolo WebSocket del backend.

export type ToastLevel = 'git' | 'session' | 'info' | 'error';

/** Notificación a mostrar con Sileo. */
export interface Toast {
  projectId?: string;
  level: ToastLevel;
  title: string;
  message: string;
}

export type WsStatus = 'connecting' | 'open' | 'closed';

/** Eventos del servidor (espejo de internal/adapters/hub en Go). */
export interface ServerEvent {
  type:
    | 'output'
    | 'replay'
    | 'git_update'
    | 'fs_change'
    | 'notification'
    | 'session_state'
    | 'activity'
    | 'agent_state';
  projectId?: string;
  termId?: string;
  payload?: unknown;
}
