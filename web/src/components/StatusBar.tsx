// Barra de estado inferior (estilo editor): identidad, proyecto en foco,
// proyectos activos, notificaciones pendientes y estado del enlace WebSocket.
import { selectFocusedProject, useStore } from '../store/store';
import { IconBell, IconLogo } from './icons';

const WS_STATUS_STYLE = {
  open: { cls: 'notification-pulse--green', label: 'LINK ACTIVO' },
  connecting: { cls: 'notification-pulse--gold', label: 'CONECTANDO' },
  closed: { cls: '', label: 'SIN CONEXIÓN' },
} as const;

export function StatusBar() {
  const wsStatus = useStore((s) => s.wsStatus);
  const focused = useStore(selectFocusedProject);
  const activeCount = useStore((s) => s.activeIds.length);
  const unread = useStore((s) => s.unread);

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const status = WS_STATUS_STYLE[wsStatus];

  return (
    <footer className="gotham-status-bar relative z-10">
      <div className="flex min-w-0 items-center gap-4">
        <span className="flex shrink-0 items-center gap-1.5 text-gold">
          <IconLogo className="h-3.5 w-3.5" />
          <span className="hud-text text-[10px] font-semibold">P-AGENT</span>
        </span>
        {focused && (
          <span className="hud-label flex min-w-0 items-center gap-1.5">
            FOCO <span className="hud-value truncate">{focused.name}</span>
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <span className="hud-label">
          ACTIVOS <span className="hud-value">{activeCount}</span>
        </span>

        {/* Notificaciones pendientes: clic → panel de proyectos */}
        <button
          className={`flex items-center gap-1.5 transition-colors ${
            totalUnread > 0 ? 'text-gold' : 'text-muted'
          } hover:text-gold`}
          onClick={() => useStore.getState().setProjectsModalOpen(true)}
          title={totalUnread > 0 ? `${totalUnread} eventos sin leer` : 'Sin notificaciones'}
        >
          <IconBell className="h-3.5 w-3.5" />
          <span className="hud-value">{totalUnread}</span>
        </button>

        <span className="flex items-center gap-2">
          <span className={`notification-pulse ${status.cls}`} />
          <span className="hud-label">{status.label}</span>
        </span>
      </div>
    </footer>
  );
}
