// Iconos SVG inline (stroke: currentColor) con tamaño consistente.
// Sustituyen a los glifos de texto (« » 🗀 ↻ …), que renderizaban diminutos
// e irregulares con la fuente pixel.
import type { ReactNode } from 'react';

interface IconProps {
  className?: string;
}

function Svg({ children, className = 'h-4 w-4' }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const IconChevronsLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="m11 17-5-5 5-5M18 17l-5-5 5-5" />
  </Svg>
);

export const IconChevronsRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="m13 17 5-5-5-5M6 17l5-5-5-5" />
  </Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const IconArrowUpDir = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 5 5v6" />
  </Svg>
);

export const IconFolder = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.6L12 7h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </Svg>
);

export const IconTerminal = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 17 6-5-6-5" />
    <path d="M12 19h8" />
  </Svg>
);

export const IconGitBranch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="8" r="2.5" />
    <path d="M6 8.5v7" />
    <path d="M18 10.5c0 3-2.5 4.5-6 4.5H8.5" />
  </Svg>
);

export const IconBell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9Z" />
    <path d="M10 19a2.2 2.2 0 0 0 4 0" />
  </Svg>
);

export const IconLogo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 21.5 20h-19L12 3Z" />
    <path d="M12 10v4" />
  </Svg>
);
