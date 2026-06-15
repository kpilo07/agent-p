// Logo de AGENT-P: personaje con sombrero en pixel-art, renderizado como SVG
// inline (exactamente el sprite proporcionado). shape-rendering: crispEdges
// mantiene los bordes nítidos al escalar.
const DEFAULT_SIZE = 160; // tamaño por defecto en CSS px

interface AgentLogoProps {
  /** Lado del sprite en px (cuadrado). Por defecto 160 (pantalla de inicio). */
  size?: number;
  className?: string;
}

export function AgentLogo({ size = DEFAULT_SIZE, className }: AgentLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={className}
      aria-hidden="true"
    >
      <path d="M6,2 h4 v1 h-4 z" fill="#5C341A" />
      <path d="M5,3 h6 v2 h-6 z" fill="#5C341A" />
      <path d="M5,5 h6 v1 h-6 z" fill="#2B2B2B" />
      <path d="M2,6 h12 v1 h-12 z" fill="#7A4B26" />

      <path d="M4,7 h8 v1 h-8 z" fill="#00A8A8" />
      <path d="M4,8 h2 v1 h-2 z" fill="#00A8A8" />
      <path d="M6,8 h1 v1 h-1 z" fill="#FFFFFF" />
      <path d="M7,8 h1 v1 h-1 z" fill="#2B2B2B" />
      <path d="M8,8 h1 v1 h-1 z" fill="#FFFFFF" />
      <path d="M9,8 h1 v1 h-1 z" fill="#2B2B2B" />
      <path d="M10,8 h2 v1 h-2 z" fill="#00A8A8" />

      <path d="M5,9 h6 v1 h-6 z" fill="#FF9900" />
      <path d="M6,10 h4 v1 h-4 z" fill="#E68A00" />

      <path d="M4,11 h8 v4 h-8 z" fill="#00A8A8" />
    </svg>
  );
}
