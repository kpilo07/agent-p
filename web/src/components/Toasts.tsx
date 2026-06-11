// Alertas flotantes para eventos de proyectos en segundo plano.
// Click en un toast → enfoca el proyecto que lo generó.
import { useStore, type Toast } from '../store/store';
import { IconClose } from './icons';

const LEVEL_STYLE: Record<Toast['level'], { tag: string; label: string }> = {
  git: { tag: 'gotham-tag--medium', label: 'GIT' },
  session: { tag: 'gotham-tag--info', label: 'SESIÓN' },
  info: { tag: 'gotham-tag--info', label: 'INFO' },
  error: { tag: 'gotham-tag--critical', label: 'ERROR' },
};

export function Toasts() {
  const toasts = useStore((s) => s.toasts);

  return (
    <div className="pointer-events-none fixed right-16 bottom-10 z-[1000] flex w-80 flex-col gap-2">
      {toasts.map((toast) => {
        const style = LEVEL_STYLE[toast.level];
        return (
          <button
            key={toast.id}
            className="glass-panel toast-enter pointer-events-auto flex w-full cursor-pointer items-start gap-3 p-3 text-left"
            onClick={() => {
              if (toast.projectId) useStore.getState().focusProject(toast.projectId);
              useStore.getState().dismissToast(toast.id);
            }}
          >
            <span className={`gotham-tag ${style.tag} mt-0.5 shrink-0`}>{style.label}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[11px] font-semibold tracking-wide text-gold">
                {toast.title}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-secondary">
                {toast.message}
              </span>
            </span>
            <span
              className="shrink-0 cursor-pointer text-muted hover:text-gold"
              onClick={(e) => {
                e.stopPropagation();
                useStore.getState().dismissToast(toast.id);
              }}
            >
              <IconClose className="h-3.5 w-3.5" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
