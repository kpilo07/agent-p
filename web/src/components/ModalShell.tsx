// Carcasa común de todas las modales. La transición la maneja Blendy: el panel
// CRECE desde un punto en el centro del viewport (.blendy-seed) al abrir y
// COLAPSA hacia él al cerrar. El cierre es asíncrono: primero la animación y,
// al terminar, se notifica onClose para desmontar.
//
// Las modales hijas (anidadas) deben renderizarse como HERMANAS de este
// componente, nunca dentro: Blendy deja un transform en el panel y un ancestro
// con transform rompe su position: fixed.
import { useEffect, type ReactNode } from 'react';

import { BlendySeed, useBlendyModal } from './Blendy';

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
  const { id, closing, requestClose } = useBlendyModal(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !escapeDisabled) requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [escapeDisabled, requestClose]);

  return (
    <>
      <BlendySeed id={id} />
      <div
        className={`fixed inset-0 ${z} flex items-center justify-center bg-black/70 p-6 ${
          closing ? 'modal-backdrop-out' : 'modal-backdrop-in'
        }`}
        onClick={requestClose}
      >
        <div
          className="blendy-panel flex max-h-full min-w-0"
          data-blendy-to={id}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Blendy exige UN único wrapper dentro del elemento data-blendy-to */}
          <div className="flex max-h-full min-w-0">{children(requestClose)}</div>
        </div>
      </div>
    </>
  );
}
