// Modal de registro de proyecto: path (con explorador de carpetas), grid de
// agentes CLI predefinidos (tipear es el último recurso, vía "Otro") y nombre
// derivado automáticamente de la carpeta. El backend valida que sea repo git.
import { useState } from 'react';
import { apiClient as api } from '../../../infrastructure/api/ApiClient';
import { useStore } from '../../../infrastructure/store/store';
import { DirBrowser } from './DirBrowser';
import { ModalShell } from '../ui/ModalShell';
import { IconClose, IconFolder } from '../ui/icons';

const basename = (p: string) => p.split('/').filter(Boolean).pop() ?? '';

// Agentes habituales: un clic y listo. "Shell" deja el comando vacío.
const AGENT_PRESETS = [
  { label: 'Claude Code', cmd: 'claude' },
  { label: 'Codex', cmd: 'codex' },
  { label: 'Gemini CLI', cmd: 'gemini' },
  { label: 'Cursor', cmd: 'cursor-agent' },
  { label: 'Aider', cmd: 'aider' },
  { label: 'OpenCode', cmd: 'opencode' },
  { label: 'Shell', cmd: '' },
];

export function AddProjectModal({ onClose }: { onClose: () => void }) {
  const [path, setPath] = useState('');
  const [cliCommand, setCliCommand] = useState('');
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  const name = basename(path);

  const pickPreset = (cmd: string) => {
    setCustom(false);
    setCliCommand(cmd);
  };

  const submit = async (e: React.FormEvent, requestClose: () => void) => {
    e.preventDefault();
    if (!name) return;
    setBusy(true);
    try {
      const project = await api.createProject({ name, path, cliCommand });
      useStore.getState().upsertProject({ ...project, running: false });
      requestClose();
    } catch (err) {
      useStore.getState().pushToast({
        level: 'error',
        title: 'No se pudo crear',
        message: (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ModalShell z="z-[850]" escapeDisabled={browsing} onClose={onClose}>
        {(requestClose) => (
          <div className="glass-panel flex w-[480px] max-w-[92vw] flex-col overflow-hidden">
            <header className="flex items-center justify-between border-b border-[var(--border-secondary)] px-5 py-3">
              <span className="hud-label">Registrar proyecto</span>
              <button
                className="btn-tactical flex items-center justify-center p-1.5"
                onClick={requestClose}
              >
                <IconClose />
              </button>
            </header>

            <form onSubmit={(e) => submit(e, requestClose)} className="flex flex-col gap-2.5 p-5">
              <label className="hud-label">Carpeta del repositorio</label>
              <div className="flex gap-1.5">
                <input
                  className="hud-input min-w-0 flex-1"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/home/user/repo"
                  autoFocus
                  required
                />
                <button
                  type="button"
                  className="btn-tactical btn-tactical--cyan flex shrink-0 items-center justify-center px-3"
                  onClick={() => setBrowsing(true)}
                  title="Explorar carpetas"
                >
                  <IconFolder />
                </button>
              </div>

              {/* El nombre del proyecto = nombre de la carpeta seleccionada */}
              {name && (
                <p className="hud-label flex items-center gap-2">
                  Se registrará como
                  <span className="hud-value normal-case">{name}</span>
                </p>
              )}

              <label className="hud-label mt-2">Agente predeterminado</label>
              <div className="grid grid-cols-3 gap-1.5">
                {AGENT_PRESETS.map((preset) => {
                  const selected = !custom && cliCommand === preset.cmd;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => pickPreset(preset.cmd)}
                      className={`rounded-lg border px-2 py-2 font-mono text-[10px] tracking-wide uppercase transition-all ${
                        selected
                          ? 'border-[var(--border-active)] bg-[var(--hover-accent)] text-gold'
                          : 'border-[var(--border-secondary)] text-secondary hover:border-[var(--border-primary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setCustom(true);
                    setCliCommand('');
                  }}
                  className={`col-span-3 rounded-lg border border-dashed px-2 py-1.5 font-mono text-[10px] tracking-wide uppercase transition-all ${
                    custom
                      ? 'border-[var(--border-active)] bg-[var(--hover-accent)] text-gold'
                      : 'border-[var(--border-secondary)] text-muted hover:border-[var(--border-primary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Otro — escribir comando
                </button>
              </div>

              {/* Tipear el comando: solo como último recurso */}
              {custom && (
                <input
                  className="hud-input"
                  value={cliCommand}
                  onChange={(e) => setCliCommand(e.target.value)}
                  placeholder="mi-agente --flags"
                  autoFocus
                />
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="btn-tactical" onClick={requestClose}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-tactical btn-tactical--cyan"
                  disabled={busy || !name}
                >
                  {busy ? 'Registrando…' : 'Registrar'}
                </button>
              </div>
            </form>
          </div>
        )}
      </ModalShell>

      {/* Hermana de la shell (no hija): un ancestro con transform rompería su fixed */}
      {browsing && (
        <DirBrowser
          initialPath={path || undefined}
          onSelect={(selected) => {
            setPath(selected);
            setBrowsing(false);
          }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </>
  );
}
