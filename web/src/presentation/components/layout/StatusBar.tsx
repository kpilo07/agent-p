// Barra de estado inferior (estilo editor): identidad, proyecto en foco, menú
// de proyectos abiertos (esquina inferior derecha, para saltar entre ellos),
// notificaciones pendientes y estado del enlace WebSocket.
import { useState } from 'react';

import { apiClient } from '../../../infrastructure/api/ApiClient';
import { projectService } from '../../../core/use-cases/ProjectService';
import { selectFocusedProject, useStore } from '../../../infrastructure/store/store';
import { useGit } from '../../hooks/useGit';
import { BranchSwitcher } from '../shared/BranchSwitcher';
import { SyncControl } from '../shared/SyncControl';
import { IconBell, IconChevronDown, IconLogo, IconLogout } from '../ui/icons';

const WS_STATUS_STYLE = {
  open: { cls: 'notification-pulse--green', label: 'LINK ACTIVE' },
  connecting: { cls: 'notification-pulse--gold', label: 'CONNECTING' },
  closed: { cls: '', label: 'OFFLINE' },
} as const;

export function StatusBar() {
  const wsStatus = useStore((s) => s.wsStatus);
  const focused = useStore(selectFocusedProject);
  const projects = useStore((s) => s.projects);
  const activeIds = useStore((s) => s.activeIds);
  const unread = useStore((s) => s.unread);

  const [menuOpen, setMenuOpen] = useState(false);

  const git = useGit(focused?.id ?? null);
  const branch = git?.branch;

  const activeProjects = projects.filter((p) => activeIds.includes(p.id));
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const status = WS_STATUS_STYLE[wsStatus];

  const switchTo = (id: string) => {
    setMenuOpen(false);
    projectService.openProject(id);
  };

  // Logout: invalida la sesión y recarga para teardown limpio (incluido el WS).
  const logout = async () => {
    try {
      await apiClient.authLogout();
    } finally {
      window.location.reload();
    }
  };

  return (
    <footer className="gotham-status-bar relative z-10">
      <div className="flex min-w-0 items-center gap-4">
        <span className="flex shrink-0 items-center gap-1.5 text-gold">
          <IconLogo className="h-3.5 w-3.5" />
          <span className="hud-text text-[10px] font-semibold">P-AGENT</span>
        </span>
        {focused && (
          <span className="hud-label flex min-w-0 items-center gap-1.5">
            FOCUS <span className="hud-value truncate">{focused.name}</span>
          </span>
        )}
        {focused && branch && <BranchSwitcher projectId={focused.id} current={branch} />}
        {focused && branch && git && (
          <SyncControl
            projectId={focused.id}
            ahead={git.ahead}
            behind={git.behind}
            hasUpstream={git.hasUpstream}
          />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-4">
        {/* Notificaciones pendientes: clic → panel de proyectos */}
        <button
          className={`flex items-center gap-1.5 transition-colors ${
            totalUnread > 0 ? 'text-gold' : 'text-muted'
          } hover:text-gold`}
          onClick={() => useStore.getState().setProjectsModalOpen(true)}
          title={totalUnread > 0 ? `${totalUnread} unread events` : 'No notifications'}
        >
          <IconBell className="h-3.5 w-3.5" />
          <span className="hud-value">{totalUnread}</span>
        </button>

        <span className="flex items-center gap-2">
          <span className={`notification-pulse ${status.cls}`} />
          <span className="hud-label">{status.label}</span>
        </span>

        <button
          className="flex items-center gap-1.5 text-muted transition-colors hover:text-gold"
          onClick={logout}
          title="Log out"
        >
          <IconLogout className="h-3.5 w-3.5" />
          <span className="hud-label">LOG OUT</span>
        </button>

        {/* Menú de proyectos abiertos: salto rápido entre ellos */}
        {activeProjects.length > 0 && (
          <div className="relative">
            <button
              className={`hud-label flex cursor-pointer items-center gap-1.5 transition-colors hover:!text-[var(--text-primary)] ${
                menuOpen ? '!text-[var(--text-primary)]' : ''
              }`}
              onClick={() => setMenuOpen((o) => !o)}
              title="Open projects"
            >
              OPEN <span className="hud-value">{activeProjects.length}</span>
              <IconChevronDown
                className={`h-3 w-3 transition-transform duration-200 ${
                  menuOpen ? '' : 'rotate-180'
                }`}
              />
            </button>

            {menuOpen && (
              <>
                {/* Click-away para cerrar el menú */}
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="gotham-enter absolute right-0 bottom-7 z-50 w-60 overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] py-1">
                  {activeProjects.map((p) => {
                    const isFocused = p.id === focused?.id;
                    const pending = unread[p.id] ?? 0;
                    return (
                      <button
                        key={p.id}
                        className={`flex w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-[var(--hover-accent)] ${
                          isFocused ? 'bg-[var(--hover-accent)]' : ''
                        }`}
                        onClick={() => switchTo(p.id)}
                        title={p.path}
                      >
                        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-alert-green" />
                        <span
                          className={`hud-value min-w-0 flex-1 truncate ${
                            isFocused ? '' : '!text-[var(--text-secondary)]'
                          }`}
                        >
                          {p.name}
                        </span>
                        {pending > 0 && !isFocused && (
                          <span className="notification-pulse notification-pulse--count shrink-0">
                            {pending > 9 ? '9+' : pending}
                          </span>
                        )}
                        {isFocused && <span className="hud-label shrink-0">focus</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </footer>
  );
}
