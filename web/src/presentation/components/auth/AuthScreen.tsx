// Pantalla de autenticación a pantalla completa. Cubre dos modos:
//   - 'setup': primer arranque, no hay usuarios → crear el primer usuario.
//   - 'login': ya existen usuarios → iniciar sesión.
// Al autenticar correctamente invoca onAuthenticated, que deja pasar a la app.
import { useState } from 'react';

import { apiClient as api } from '../../../infrastructure/api/ApiClient';
import { AgentLogo } from '../ui/AgentLogo';

interface AuthScreenProps {
  mode: 'setup' | 'login';
  onAuthenticated: () => void;
}

export function AuthScreen({ mode, onAuthenticated }: AuthScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isSetup = mode === 'setup';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (isSetup && password !== confirm) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setBusy(true);
    try {
      if (isSetup) {
        await api.authSetup(username, password);
      } else {
        await api.authLogin(username, password);
      }
      onAuthenticated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center bg-[var(--bg-void)] p-4">
      <div className="glass-panel flex w-[400px] max-w-[92vw] flex-col overflow-hidden">
        <header className="flex flex-col items-center gap-3 border-b border-[var(--border-secondary)] px-6 py-7">
          <AgentLogo size={64} />
          <span className="hud-label text-[11px]">AGENT-P</span>
          <h1 className="hud-value text-base normal-case">
            {isSetup ? 'Crea el primer usuario' : 'Inicia sesión'}
          </h1>
          {isSetup && (
            <p className="text-center text-[11px] leading-relaxed text-muted">
              Aún no hay usuarios. Este será el administrador de la aplicación.
            </p>
          )}
        </header>

        <form onSubmit={submit} className="flex flex-col gap-2.5 p-6">
          <label className="hud-label">Usuario</label>
          <input
            className="hud-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />

          <label className="hud-label mt-1">Contraseña</label>
          <input
            className="hud-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSetup ? 'new-password' : 'current-password'}
            required
          />

          {isSetup && (
            <>
              <label className="hud-label mt-1">Repite la contraseña</label>
              <input
                className="hud-input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
              <p className="text-[10px] text-muted">Mínimo 8 caracteres.</p>
            </>
          )}

          {error && (
            <p className="rounded-md border border-[var(--alert-red,#7f1d1d)] bg-[rgba(127,29,29,0.15)] px-3 py-2 text-[11px] text-[var(--text-primary)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn-tactical btn-tactical--cyan mt-3 justify-center py-2"
            disabled={busy || !username || !password || (isSetup && !confirm)}
          >
            {busy
              ? isSetup
                ? 'Creando…'
                : 'Entrando…'
              : isSetup
                ? 'Crear usuario'
                : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
