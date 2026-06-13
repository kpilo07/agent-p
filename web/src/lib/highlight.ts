// Utilidades del visor de archivos: detección de tipo (imagen / markdown),
// mapeo de extensión a lenguaje y resaltado de sintaxis preservando el corte
// por líneas (para mantener la rejilla de números de línea del visor).
import hljs from 'highlight.js/lib/common';

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif',
]);

const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdown', 'mkd']);

// Extensiones cuyo nombre de lenguaje en highlight.js no coincide con la
// extensión. Las que sí coinciden (js, ts, go, css, json, html…) se resuelven
// directamente vía hljs.getLanguage().
const LANG_ALIASES: Record<string, string> = {
  jsx: 'javascript',
  tsx: 'typescript',
  mjs: 'javascript',
  cjs: 'javascript',
  yml: 'yaml',
  sh: 'bash',
  zsh: 'bash',
  bash: 'bash',
  htm: 'xml',
  html: 'xml',
  vue: 'xml',
  rs: 'rust',
  py: 'python',
  rb: 'ruby',
  kt: 'kotlin',
  cs: 'csharp',
  'c++': 'cpp',
  cc: 'cpp',
  h: 'cpp',
  hpp: 'cpp',
  md: 'markdown',
  dockerfile: 'dockerfile',
  ps1: 'powershell',
  toml: 'ini',
};

export function fileExt(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  // Ficheros sin extensión pero con nombre conocido (Dockerfile, Makefile…).
  if (!base.includes('.')) return base.toLowerCase();
  return base.slice(base.lastIndexOf('.') + 1).toLowerCase();
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.has(fileExt(path));
}

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTS.has(fileExt(path));
}

// resolveLanguage devuelve el id de lenguaje de highlight.js para una ruta, o
// undefined si no se reconoce (se usará autodetección).
function resolveLanguage(path: string): string | undefined {
  const ext = fileExt(path);
  const alias = LANG_ALIASES[ext];
  if (alias && hljs.getLanguage(alias)) return alias;
  if (hljs.getLanguage(ext)) return ext;
  return undefined;
}

// highlightToLines resalta el contenido y lo devuelve como un array de líneas
// de HTML, cada una con sus <span> balanceados. Resalta el texto completo (para
// que comentarios de bloque y plantillas multilínea funcionen) y luego reparte
// el HTML por saltos de línea reabriendo los spans abiertos en cada corte.
export function highlightToLines(code: string, path: string): string[] {
  let html: string;
  try {
    const lang = resolveLanguage(path);
    html = lang
      ? hljs.highlight(code, { language: lang }).value
      : hljs.highlightAuto(code).value;
  } catch {
    html = escapeHtml(code);
  }
  return splitToLines(html);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// splitToLines parte HTML de highlight.js por '\n' manteniendo los <span>
// abiertos balanceados en cada línea (cierra al final, reabre al principio).
function splitToLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = []; // pila de etiquetas <span ...> abiertas
  let cur = '';

  const re = /(<[^>]+>)|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) {
      const tag = m[1];
      cur += tag;
      if (tag.startsWith('</')) open.pop();
      else if (!tag.endsWith('/>')) open.push(tag);
    } else {
      const parts = m[2].split('\n');
      for (let i = 0; i < parts.length; i++) {
        cur += parts[i];
        if (i < parts.length - 1) {
          cur += '</span>'.repeat(open.length);
          lines.push(cur);
          cur = open.join('');
        }
      }
    }
  }
  lines.push(cur);
  return lines;
}
