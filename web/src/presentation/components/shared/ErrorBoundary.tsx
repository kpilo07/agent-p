// Error boundary de presentación. Si un subárbol de React lanza durante el
// render (p. ej. React Flow ante datos inesperados), evita que toda la zona
// quede en blanco: muestra un panel recuperable con el mensaje real y un botón
// de reintento. Resetea su estado cuando cambia `resetKey` (p. ej. el proyecto).
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  resetKey?: unknown;
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Deja rastro en consola para diagnóstico (el panel muestra el mensaje).
    console.error('ErrorBoundary capturó un error de render:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // Al cambiar la clave de reseteo (cambio de proyecto), limpiamos el error.
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <section className="glass-panel glass-panel--terminal relative flex h-full min-h-0 flex-col items-center justify-center gap-4 overflow-hidden p-6 text-center">
          <span className="hud-label text-alert-red">
            {this.props.label ?? 'No se pudo renderizar'}
          </span>
          <p className="max-w-[520px] font-mono text-[11px] break-words text-secondary">
            {this.state.error.message || String(this.state.error)}
          </p>
          <button
            className="btn-tactical btn-tactical--cyan px-3 py-1.5"
            onClick={() => this.setState({ error: null })}
          >
            Reintentar
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}
