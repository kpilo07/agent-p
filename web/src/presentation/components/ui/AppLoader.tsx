// Loader global: pantalla de arranque mostrada mientras se resuelve la sesión
// y se cargan los datos iniciales. Reutiliza el sprite de marca (AgentLogo) con
// un pulso suave y una barra de progreso indeterminada en estilo HUD.
import { AgentLogo } from './AgentLogo';

interface AppLoaderProps {
  /** Mensaje bajo el logo. Por defecto, arranque del sistema. */
  label?: string;
}

export function AppLoader({ label = 'Starting system…' }: AppLoaderProps) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-[var(--bg-void)]">
      <div className="animate-osiris-pulse">
        <AgentLogo size={88} />
      </div>
      <div className="app-loader__bar" role="progressbar" aria-label={label}>
        <span />
      </div>
      <span className="hud-label">{label}</span>
    </div>
  );
}
