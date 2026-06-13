// Instancia única de Blendy (https://blendy.tahazsh.com): anima un elemento
// `data-blendy-from` hasta su `data-blendy-to` con técnica FLIP. La usamos para
// TODAS las transiciones de modales: el "from" es un punto fijo en el centro
// del viewport (ver .blendy-seed en index.css), así que cada panel crece desde
// el centro y vuelve a colapsar a él al cerrar.
import { createBlendy, type Blendy } from 'blendy';

let instance: Blendy | null = null;

export function getBlendy(): Blendy {
  if (!instance) instance = createBlendy({ animation: 'dynamic' });
  return instance;
}
