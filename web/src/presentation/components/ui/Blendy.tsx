// Pegamento React ↔ Blendy para las transiciones de modales desde el centro.
//
// useBlendyModal devuelve { id, closing, requestClose }:
//   · monta el panel y, en useLayoutEffect (antes del primer paint, sin
//     parpadeo), llama a blendy.toggle(id) → el panel crece desde el seed.
//   · requestClose lanza blendy.untoggle(id, …) → el panel colapsa al seed y,
//     al terminar, invoca onClose para desmontar.
// BlendySeed pinta el origen: un punto fijo en el centro del viewport.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { blendyService } from '../../../infrastructure/ui/BlendyService';

// Margen sobre la duración de la animación de Blendy (450ms en modo 'dynamic').
// Si pasado este tiempo Blendy no ha invocado su callback de fin (animación
// cancelada por otra modal, o pestaña en segundo plano con rAF pausado),
// desmontamos igualmente para no dejar el overlay bloqueando la app.
const CLOSE_FALLBACK_MS = 600;

export function useBlendyModal(onClose: () => void) {
  // useId trae ':' que no es válido como valor de atributo para los selectores
  // de Blendy; lo saneamos a un id estable y único por modal.
  const id = 'b' + useId().replace(/:/g, '');
  const [closing, setClosing] = useState(false);

  // onClose puede cambiar de identidad entre renders; lo leemos por ref para
  // no recrear requestClose ni arrastrar un valor obsoleto al callback.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closedRef = useRef(false);
  const toggledRef = useRef(false);
  const finishedRef = useRef(false);
  const fallbackRef = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    // Guard: en StrictMode (dev) los efectos corren dos veces sobre los mismos
    // nodos; toggle debe lanzarse una sola vez por instancia.
    if (toggledRef.current) return;
    toggledRef.current = true;
    const b = blendyService.getBlendy();
    b.update(); // registra el seed/panel recién montados
    b.toggle(id);
  }, [id]);

  // Limpia el timeout de seguridad si la modal se desmonta antes de dispararse.
  useEffect(() => () => window.clearTimeout(fallbackRef.current), []);

  const requestClose = useCallback(() => {
    if (closedRef.current) return; // evita doble untoggle (Escape + clic, etc.)
    closedRef.current = true;
    setClosing(true);

    // Desmonta una sola vez, venga de Blendy o del timeout de seguridad.
    const finish = () => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      window.clearTimeout(fallbackRef.current);
      onCloseRef.current();
    };

    blendyService.getBlendy().untoggle(id, finish);
    // Red de seguridad: Blendy solo llama a `finish` al completar la animación
    // (un único slot global; si otra modal anima, esta se cancela y su callback
    // se pierde). El timeout garantiza el desmontaje pase lo que pase.
    fallbackRef.current = window.setTimeout(finish, CLOSE_FALLBACK_MS);
  }, [id]);

  return { id, closing, requestClose };
}

/** Origen de la transición: un punto fijo y transparente en el centro. */
export function BlendySeed({ id }: { id: string }) {
  return (
    <div className="blendy-seed" data-blendy-from={id} aria-hidden="true">
      <div />
    </div>
  );
}
