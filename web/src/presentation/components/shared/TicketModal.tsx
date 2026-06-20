// Tickets del proyecto en foco. A la izquierda, el historial (estado + título);
// a la derecha, o el editor de un ticket nuevo (detalle + archivos del repo
// mencionados con @), o el detalle de un ticket existente con sus commits
// relacionados (rango base..HEAD) y las acciones de lanzar/cerrar/eliminar.
//
// Lanzar un ticket lo inyecta como prompt al agente (arrancándolo si hace falta)
// y abre su consola para darle seguimiento en vivo.
import { useEffect, useMemo, useState } from 'react';

import { apiClient as api } from '../../../infrastructure/api/ApiClient';
import type { Commit, TicketStatus, TreeNode } from '../../../core/domain/project';
import {
  AGENT_TERM_ID,
  selectFocusedProject,
  useStore,
  type Ticket,
} from '../../../infrastructure/store/store';
import { ModalShell } from '../ui/ModalShell';
import {
  IconClose,
  IconFile,
  IconGitCommit,
  IconPlus,
  IconRefresh,
  IconTerminal,
  IconTicket,
  IconTrash,
} from '../ui/icons';

interface FileEntry {
  path: string;
  name: string;
}

/** Aplana el árbol del repo a la lista de archivos (sin carpetas). */
function flatten(node: TreeNode, out: FileEntry[] = []): FileEntry[] {
  for (const child of node.children ?? []) {
    if (child.dir) flatten(child, out);
    else out.push({ path: child.path, name: child.name });
  }
  return out;
}

const STATUS_STYLE: Record<TicketStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'text-muted border-[var(--border-primary)]' },
  launched: { label: 'Launched', cls: 'text-cyan border-cyan/40' },
  closed: { label: 'Closed', cls: 'text-secondary border-[var(--border-primary)]' },
};

function StatusChip({ status }: { status: TicketStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${s.cls}`}>
      {s.label}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TicketModal() {
  const focused = useStore(selectFocusedProject);

  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Editor de ticket nuevo.
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [fileQuery, setFileQuery] = useState('');
  const [repoFiles, setRepoFiles] = useState<FileEntry[]>([]);

  // Commits relacionados con el ticket seleccionado.
  const [commits, setCommits] = useState<Commit[] | null>(null);

  const toast = (level: 'error' | 'info', tt: string, message: string) =>
    useStore.getState().pushToast({ level, title: tt, message });

  const loadTickets = () => {
    if (!focused) return;
    setTickets(null);
    api
      .listTickets(focused.id)
      .then((ts) => setTickets(ts))
      .catch((err) => {
        setTickets([]);
        toast('error', 'Tickets', (err as Error).message);
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadTickets, [focused?.id]);

  // Árbol del repo para el selector de archivos (mención @).
  useEffect(() => {
    if (!focused) return;
    api
      .getTree(focused.id)
      .then((t) => setRepoFiles(flatten(t)))
      .catch(() => setRepoFiles([]));
  }, [focused?.id]);

  // Commits del ticket seleccionado (solo si ya fue lanzado).
  useEffect(() => {
    if (!selected || selected.status === 'draft') {
      setCommits(selected ? [] : null);
      return;
    }
    setCommits(null);
    let cancelled = false;
    api
      .ticketCommits(selected.id)
      .then((cs) => !cancelled && setCommits(cs))
      .catch(() => !cancelled && setCommits([]));
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.status]);

  const fileMatches = useMemo(() => {
    const q = fileQuery.trim().toLowerCase();
    if (!q) return [];
    return repoFiles
      .filter((f) => !files.includes(f.path) && f.path.toLowerCase().includes(q))
      .slice(0, 8);
  }, [fileQuery, repoFiles, files]);

  const startNew = () => {
    setSelected(null);
    setEditing(true);
    setTitle('');
    setBody('');
    setFiles([]);
    setFileQuery('');
  };

  const selectTicket = (t: Ticket) => {
    setEditing(false);
    setSelected(t);
  };

  const upsertLocal = (t: Ticket) =>
    setTickets((prev) => {
      const list = prev ?? [];
      return list.some((x) => x.id === t.id)
        ? list.map((x) => (x.id === t.id ? t : x))
        : [t, ...list];
    });

  if (!focused) return null;

  return (
    <ModalShell z="z-[800]" onClose={() => useStore.getState().setTicketsModalOpen(false)}>
      {(requestClose) => {
        const createDraft = async (): Promise<Ticket | null> => {
          if (!title.trim() && !body.trim()) {
            toast('error', 'Ticket', 'Add a title or a description first');
            return null;
          }
          setBusy(true);
          try {
            const t = await api.createTicket(focused.id, { title, body, files });
            upsertLocal(t);
            setSelected(t);
            setEditing(false);
            return t;
          } catch (err) {
            toast('error', 'Ticket', (err as Error).message);
            return null;
          } finally {
            setBusy(false);
          }
        };

        const launch = async (ticket: Ticket) => {
          setBusy(true);
          try {
            const updated = await api.launchTicket(ticket.id);
            upsertLocal(updated);
            setSelected(updated);
            toast('info', 'Ticket', `Launched to the agent · following in console`);
            // Cerrar el panel y enfocar la consola del agente (sidebar) para seguimiento.
            requestClose();
            useStore.getState().focusTerm(AGENT_TERM_ID);
            useStore.getState().setSidebar({ collapsed: false });
          } catch (err) {
            toast('error', 'Launch', (err as Error).message);
          } finally {
            setBusy(false);
          }
        };

        const saveAndLaunch = async () => {
          const t = await createDraft();
          if (t) await launch(t);
        };

        const close = async (ticket: Ticket) => {
          setBusy(true);
          try {
            const updated = await api.closeTicket(ticket.id);
            upsertLocal(updated);
            setSelected(updated);
          } catch (err) {
            toast('error', 'Close', (err as Error).message);
          } finally {
            setBusy(false);
          }
        };

        const remove = async (ticket: Ticket) => {
          setBusy(true);
          try {
            await api.deleteTicket(ticket.id);
            setTickets((prev) => (prev ?? []).filter((x) => x.id !== ticket.id));
            setSelected(null);
            setEditing(false);
          } catch (err) {
            toast('error', 'Delete', (err as Error).message);
          } finally {
            setBusy(false);
          }
        };

        const openFile = (path: string) => useStore.getState().setSelectedFile(path);

        return (
          <div className="glass-panel flex h-[82vh] w-[1040px] max-w-[95vw] flex-col overflow-hidden">
            <header className="flex items-center justify-between gap-4 border-b border-[var(--border-secondary)] px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <IconTicket className="h-4 w-4 shrink-0 text-gold" />
                <span className="hud-label shrink-0">Tickets</span>
                <span className="hud-value truncate">{focused.name}</span>
                {tickets && <span className="hud-label shrink-0">· {tickets.length}</span>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  className="btn-tactical btn-tactical--cyan flex items-center gap-1.5 px-2 py-1.5 text-[11px]"
                  onClick={startNew}
                  title="New ticket"
                >
                  <IconPlus className="h-3.5 w-3.5" /> New
                </button>
                <button
                  className="btn-tactical flex items-center justify-center p-1.5"
                  onClick={loadTickets}
                  title="Reload"
                >
                  <IconRefresh />
                </button>
                <button
                  className="btn-tactical flex items-center justify-center p-1.5"
                  onClick={requestClose}
                >
                  <IconClose />
                </button>
              </div>
            </header>

            <div className="flex min-h-0 flex-1">
              {/* Lista de tickets */}
              <aside className="styled-scrollbar w-80 shrink-0 overflow-y-auto border-r border-[var(--border-secondary)]">
                {tickets === null ? (
                  <p className="hud-label px-4 py-4">Loading…</p>
                ) : tickets.length === 0 ? (
                  <p className="hud-label px-4 py-4">No tickets yet. Create one →</p>
                ) : (
                  tickets.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => selectTicket(t)}
                      className={`flex w-full flex-col gap-1 border-b border-[var(--border-secondary)] px-4 py-2.5 text-left transition-colors hover:bg-[var(--hover-accent)] ${
                        !editing && t.id === selected?.id ? 'bg-[var(--hover-accent)]' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <StatusChip status={t.status} />
                        <span
                          className={`min-w-0 flex-1 truncate text-[12px] ${
                            !editing && t.id === selected?.id
                              ? 'text-gold'
                              : 'text-[var(--text-primary)]'
                          }`}
                        >
                          {t.title || t.body.split('\n')[0] || '(untitled)'}
                        </span>
                      </div>
                      <span className="flex items-center gap-2 font-mono text-[10px] text-muted">
                        <span>{formatDate(t.createdAt)}</span>
                        {t.files && t.files.length > 0 && (
                          <span className="ml-auto shrink-0">{t.files.length} file(s)</span>
                        )}
                      </span>
                    </button>
                  ))
                )}
              </aside>

              {/* Detalle / editor */}
              <div className="styled-scrollbar min-h-0 flex-1 overflow-y-auto bg-[var(--bg-primary)]">
                {editing ? (
                  <div className="flex flex-col gap-4 p-5">
                    <input
                      className="w-full rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-active)]"
                      placeholder="Ticket title (optional)"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                    <textarea
                      className="styled-scrollbar h-48 w-full resize-none rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 font-mono text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--border-active)]"
                      placeholder="Describe the task for the agent. Mention repo files below to add them as context."
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                    />

                    {/* Selector de archivos mencionados */}
                    <div className="flex flex-col gap-2">
                      <span className="hud-label">Mentioned files</span>
                      {files.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {files.map((f) => (
                            <span
                              key={f}
                              className="flex items-center gap-1 rounded bg-[var(--hover-accent)] px-2 py-0.5 font-mono text-[10px] text-gold"
                            >
                              {f}
                              <button
                                className="text-muted hover:text-alert-red"
                                onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="relative">
                        <input
                          className="w-full rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--border-active)]"
                          placeholder="Search a file to mention…"
                          value={fileQuery}
                          onChange={(e) => setFileQuery(e.target.value)}
                        />
                        {fileMatches.length > 0 && (
                          <div className="styled-scrollbar absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded border border-[var(--border-active)] bg-[var(--bg-secondary)] py-1">
                            {fileMatches.map((f) => (
                              <button
                                key={f.path}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] hover:bg-[var(--hover-accent)]"
                                onClick={() => {
                                  setFiles((prev) => [...prev, f.path]);
                                  setFileQuery('');
                                }}
                              >
                                <IconFile className="h-3.5 w-3.5 shrink-0 text-muted" />
                                <span className="min-w-0 truncate text-[var(--text-primary)]">
                                  {f.path}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        className="btn-tactical flex items-center gap-1.5 px-3 py-1.5 text-[12px] disabled:opacity-50"
                        onClick={() => void createDraft()}
                        disabled={busy}
                      >
                        Save draft
                      </button>
                      <button
                        className="btn-tactical btn-tactical--cyan flex items-center gap-1.5 px-3 py-1.5 text-[12px] disabled:opacity-50"
                        onClick={() => void saveAndLaunch()}
                        disabled={busy}
                      >
                        <IconTerminal className="h-3.5 w-3.5" /> Save &amp; launch
                      </button>
                    </div>
                  </div>
                ) : selected ? (
                  <div className="flex flex-col gap-4 p-5">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <StatusChip status={selected.status} />
                          {selected.branch && (
                            <span className="font-mono text-[10px] text-gold">{selected.branch}</span>
                          )}
                        </div>
                        <h2 className="text-[15px] text-[var(--text-primary)]">
                          {selected.title || '(untitled)'}
                        </h2>
                      </div>
                    </div>

                    {selected.body && (
                      <pre className="styled-scrollbar overflow-x-auto rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-3 font-mono text-[12px] whitespace-pre-wrap text-[var(--text-primary)]">
                        {selected.body}
                      </pre>
                    )}

                    {selected.files && selected.files.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <span className="hud-label">Mentioned files</span>
                        {selected.files.map((f) => (
                          <button
                            key={f}
                            className="flex items-center gap-2 rounded px-2 py-1 text-left font-mono text-[11px] hover:bg-[var(--hover-accent)]"
                            onClick={() => openFile(f)}
                            title="Open file"
                          >
                            <IconFile className="h-3.5 w-3.5 shrink-0 text-gold" />
                            <span className="min-w-0 truncate text-[var(--text-primary)]">{f}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Commits relacionados */}
                    <div className="flex flex-col gap-1.5">
                      <span className="hud-label flex items-center gap-2">
                        <IconGitCommit className="h-3.5 w-3.5" /> Related commits
                      </span>
                      {selected.status === 'draft' ? (
                        <p className="text-[11px] text-muted">Not launched yet.</p>
                      ) : commits === null ? (
                        <p className="text-[11px] text-muted">Loading…</p>
                      ) : commits.length === 0 ? (
                        <p className="text-[11px] text-muted">
                          No commits since launch{selected.status === 'closed' ? '' : ' yet'}.
                        </p>
                      ) : (
                        commits.map((c) => (
                          <div
                            key={c.hash}
                            className="flex items-center gap-2 rounded border-b border-[var(--border-secondary)] px-2 py-1.5 font-mono text-[11px]"
                          >
                            <span className="text-secondary">{c.shortHash}</span>
                            <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">
                              {c.subject}
                            </span>
                            <span className="text-alert-green">+{c.additions}</span>
                            <span className="text-alert-red">−{c.deletions}</span>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Acciones */}
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        className="btn-tactical btn-tactical--cyan flex items-center gap-1.5 px-3 py-1.5 text-[12px] disabled:opacity-50"
                        onClick={() => void launch(selected)}
                        disabled={busy || selected.status === 'closed'}
                        title={selected.status === 'launched' ? 'Re-inject to the agent' : 'Launch to the agent'}
                      >
                        <IconTerminal className="h-3.5 w-3.5" />
                        {selected.status === 'launched' ? 'Relaunch' : 'Launch'}
                      </button>
                      {selected.status !== 'closed' && (
                        <button
                          className="btn-tactical flex items-center gap-1.5 px-3 py-1.5 text-[12px] disabled:opacity-50"
                          onClick={() => void close(selected)}
                          disabled={busy}
                          title="Close ticket (freezes the commit range)"
                        >
                          Close
                        </button>
                      )}
                      <button
                        className="btn-tactical ml-auto flex items-center justify-center p-1.5 hover:!text-alert-red disabled:opacity-50"
                        onClick={() => void remove(selected)}
                        disabled={busy}
                        title="Delete ticket"
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <p className="hud-label">Select a ticket or create a new one</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      }}
    </ModalShell>
  );
}
