// Carcasa común de todas las modales: backdrop con fade y panel que hace
// ZOOM desde la toolbar flotante (derecha, centrada) al abrir, y regresa a
// ella al cerrar. El cierre es asíncrono: primero la animación de salida y,
// al terminar, se notifica onClose para desmontar.
//
// Las modales hijas (anidadas) deben renderizarse como HERMANAS de este
// componente, nunca dentro: un ancestro con transform rompe su
// position: fixed.
import { useEffect, useState, type ReactNode } from 'react';

interface Props {
  /** Clase de z-index del overlay, p.ej. 'z-[800]'. */
  z?: string;
  /** Desactiva el Escape mientras una modal hija está abierta. */
  escapeDisabled?: boolean;
  /** Se invoca cuando la animación de salida termina (desmontar aquí). */
  onClose: () => void;
  /** Render-prop: recibe requestClose para los botones de cierre internos. */
  children: (requestClose: () => void) => ReactNode;
}

export function ModalShell({ z = 'z-[800]', escapeDisabled = false, onClose, children }: Props) {
  const [closing, setClosing] = useState(false);
  const requestClose = () => setClosing(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !escapeDisabled) setClosing(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [escapeDisabled]);

  return (
    <div
      className={`fixed inset-0 ${z} flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? 'modal-backdrop-out' : 'modal-backdrop-in'
      }`}
      onClick={requestClose}
    >
      <div
        className={`flex max-h-full min-w-0 ${closing ? 'panel-to-toolbar' : 'panel-from-toolbar'}`}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={(e) => {
          if (closing && e.target === e.currentTarget) onClose();
        }}
      >
        {children(requestClose)}
      </div>
    </div>
  );
}
