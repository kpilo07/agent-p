// Timeline de actividad del proyecto en foco: sesiones, cambios de git, ramas y
// acciones de gobierno (commit/stash/descartar/interrupt). Se alimenta del store
// (en vivo vía WebSocket) con una carga inicial por REST en el hook useActivity.
import type { ReactNode } from 'react';

import { selectFocusedProject, useStore } from '../../../infrastructure/store/store';
import type { ActivityEvent, ActivityKind } from '../../../core/domain/project';
import { useActivity } from '../../hooks/useActivity';
import { ModalShell } from '../ui/ModalShell';
import {
  IconArchive,
  IconClose,
  IconGitBranch,
  IconGitCommit,
  IconStop,
  IconTerminal,
  IconTicket,
  IconTrash,
} from '../ui/icons';

interface KindStyle {
  icon: (p: { className?: string }) => ReactNode;
  color: string;
  label: string;
}

const KIND: Record<ActivityKind, KindStyle> = {
  session_start: { icon: IconTerminal, color: 'text-alert-green', label: 'Agent started' },
  session_end: { icon: IconTerminal, color: 'text-muted', label: 'Agent stopped' },
  git_change: { icon: IconGitBranch, color: 'text-secondary', label: 'Working tree changed' },
  branch_switch: { icon: IconGitBranch, color: 'text-gold', label: 'Branch switch' },
  commit: { icon: IconGitCommit, color: 'text-alert-green', label: 'Commit' },
  stash: { icon: IconArchive, color: 'text-cyan', label: 'Stash' },
  discard: { icon: IconTrash, color: 'text-alert-red', label: 'Discard' },
  interrupt: { icon: IconStop, color: 'text-gold', label: 'Interrupt' },
  ticket: { icon: IconTicket, color: 'text-cyan', label: 'Ticket launched' },
};

const FALLBACK: KindStyle = { icon: IconGitBranch, color: 'text-secondary', label: 'Event' };

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'a moment ago';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

function Row({ ev }: { ev: ActivityEvent }) {
  const style = KIND[ev.kind] ?? FALLBACK;
  const Icon = style.icon;
  const hasStats = (ev.files ?? 0) > 0 || (ev.additions ?? 0) > 0 || (ev.deletions ?? 0) > 0;

  return (
    <li className="flex gap-3 px-5 py-2.5">
      <span className={`mt-0.5 ${style.color}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="hud-label shrink-0">{style.label}</span>
          <span className="font-mono text-[10px] text-muted">{relativeTime(ev.createdAt)}</span>
        </div>
        <p className="truncate text-[13px] text-[var(--text-primary)]">{ev.message}</p>
        {(hasStats || ev.branch) && (
          <div className="mt-0.5 flex items-center gap-3 font-mono text-[10px]">
            {ev.branch && <span className="text-gold">{ev.branch}</span>}
            {hasStats && (
              <span className="flex gap-2">
                <span className="text-secondary">{ev.files ?? 0} files</span>
                <span className="text-alert-green">+{ev.additions ?? 0}</span>
                <span className="text-alert-red">−{ev.deletions ?? 0}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function ActivityModal() {
  const focused = useStore(selectFocusedProject);
  const events = useActivity(focused?.id ?? null);

  if (!focused) return null;

  return (
    <ModalShell z="z-[800]" onClose={() => useStore.getState().setActivityModalOpen(false)}>
      {(requestClose) => (
        <div className="glass-panel flex h-[82vh] w-[560px] max-w-[95vw] flex-col overflow-hidden">
          <header className="flex items-center justify-between gap-4 border-b border-[var(--border-secondary)] px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="hud-label shrink-0">Activity</span>
              <span className="hud-value truncate">{focused.name}</span>
            </div>
            <button
              className="btn-tactical flex items-center justify-center p-1.5"
              onClick={requestClose}
            >
              <IconClose />
            </button>
          </header>

          <div className="styled-scrollbar min-h-0 flex-1 overflow-y-auto">
            {events.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-muted">
                No activity recorded yet.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-secondary)]">
                {events.map((ev) => (
                  <Row key={ev.id} ev={ev} />
                ))}
              </ul>
            )}
          </div>

          <footer className="border-t border-[var(--border-secondary)] px-5 py-1.5">
            <span className="hud-label">{events.length} events · live via WebSocket</span>
          </footer>
        </div>
      )}
    </ModalShell>
  );
}
