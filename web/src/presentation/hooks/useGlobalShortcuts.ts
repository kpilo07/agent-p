// Atajos de teclado globales (accesibilidad). Un único listener en window
// centraliza todos los atajos de la app:
//
//   Ctrl/⌘ + K       → buscar archivos del repositorio (requiere proyecto en foco)
//   Ctrl/⌘ + Shift+F → buscar contenido (git grep) en el repositorio
//   Ctrl/⌘ + P       → abrir el panel de proyectos
//   Ctrl/⌘ + I       → abrir el panel de tickets (requiere proyecto en foco)
//   Ctrl/⌘ + `       → crear y abrir una nueva terminal (requiere proyecto en foco)
//
// No se disparan cuando el foco está en un campo editable o en una terminal
// (xterm), para no secuestrar teclas que el usuario está escribiendo allí.
import { useEffect } from 'react';

import { useStore } from '../../infrastructure/store/store';
import { createAndOpenTerminal } from './useTerminals';

// ¿El evento procede de un elemento que debe consumir el teclado por sí mismo?
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"], .xterm, .terminal-host');
}

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const s = useStore.getState();

      // Búsqueda de contenido: Ctrl/⌘+Shift+F (único atajo con Shift permitido).
      if (e.shiftKey && (e.code === 'KeyF' || e.key.toLowerCase() === 'f')) {
        if (!s.focusedId) return;
        e.preventDefault();
        s.setContentSearchOpen(true);
        return;
      }

      // El resto de atajos ignoran Shift (p. ej. para no pisar Ctrl+Shift+P de DevTools).
      if (e.shiftKey) return;

      // Backquote por código físico (independiente de la distribución del
      // teclado), con respaldo por carácter.
      if (e.code === 'Backquote' || e.key === '`') {
        if (!s.focusedId) return;
        e.preventDefault();
        void createAndOpenTerminal();
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'k': // buscar archivos
          if (!s.focusedId) return;
          e.preventDefault();
          s.setSearchOpen(true);
          break;
        case 'p': // panel de proyectos
          e.preventDefault();
          s.setProjectsModalOpen(true);
          break;
        case 'i': // tickets (issues)
          if (!s.focusedId) return;
          e.preventDefault();
          s.setTicketsModalOpen(true);
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
