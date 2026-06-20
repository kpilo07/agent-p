// Catálogo presentacional de fondos del Mapa Táctico.
// El estado seleccionado vive en el store (mapConfig); aquí solo están las
// opciones (etiqueta/icono) para los controles. Lo comparten el StatusBar
// (dropdown) y el NodeMap (que mapea el id a la variante de React Flow).
//
// IMPORTANTE: este módulo NO debe importar de @xyflow. El StatusBar (bundle
// principal) lo importa, y el NodeMap se carga diferido precisamente para
// mantener @xyflow fuera del bundle principal.
import type { BgPattern } from '../../../infrastructure/store/store';

export const BG_PATTERNS: { id: BgPattern; label: string; icon: string }[] = [
  { id: 'dots',      label: 'Dots',     icon: '·' },
  { id: 'lines',     label: 'Lines',    icon: '≡' },
  { id: 'cross',     label: 'Cross',    icon: '⊞' },
  { id: 'dashedgrid',label: 'Grid',     icon: '⬚' },
  { id: 'circuit',   label: 'Circuit',  icon: '⊙' },
  { id: 'diagonal',  label: 'Diagonal', icon: '⤢' },
  { id: 'zigzag',    label: 'Zigzag',   icon: '∿' },
  { id: 'none',      label: 'Clean',    icon: '□' },
];
