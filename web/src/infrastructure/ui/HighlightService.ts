// Servicio de resaltado de sintaxis con highlight.js. Patrón: Singleton + Lazy Init
// El bundle "common" trae php, css, typescript, javascript y xml (html).
import hljs from 'highlight.js/lib/common';

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif',
]);
const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdown', 'mkd']);
// Solo HTML "puro" es renderizable como vista previa. Se excluye .html.twig
// (fileExt → 'twig') porque su sintaxis de plantilla no renderiza tal cual.
const HTML_EXTS = new Set(['html', 'htm', 'xhtml']);
const LANG_ALIASES: Record<string, string> = {
  jsx: 'javascript', tsx: 'typescript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', js: 'javascript',
  yml: 'yaml', sh: 'bash', zsh: 'bash', bash: 'bash',
  htm: 'xml', html: 'xml', vue: 'xml',
  php: 'php', phtml: 'php',
  rs: 'rust', py: 'python', rb: 'ruby', kt: 'kotlin', cs: 'csharp',
  'c++': 'cpp', cc: 'cpp', h: 'cpp', hpp: 'cpp',
  md: 'markdown', dockerfile: 'dockerfile', ps1: 'powershell', toml: 'ini',
};

class HighlightService {
  private static instance: HighlightService | null = null;

  private constructor() {}

  static getInstance(): HighlightService {
    if (!HighlightService.instance) {
      HighlightService.instance = new HighlightService();
    }
    return HighlightService.instance;
  }

  fileExt(path: string): string {
    const base = path.slice(path.lastIndexOf('/') + 1);
    if (!base.includes('.')) return base.toLowerCase();
    return base.slice(base.lastIndexOf('.') + 1).toLowerCase();
  }

  isImagePath(path: string): boolean {
    return IMAGE_EXTS.has(this.fileExt(path));
  }

  isMarkdownPath(path: string): boolean {
    return MARKDOWN_EXTS.has(this.fileExt(path));
  }

  isHtmlPath(path: string): boolean {
    return HTML_EXTS.has(this.fileExt(path));
  }

  highlightToLines(code: string, path: string): string[] {
    let html: string;
    try {
      const lang = this.resolveLanguage(path);
      html = lang
        ? hljs.highlight(code, { language: lang }).value
        : hljs.highlightAuto(code).value;
    } catch {
      html = this.escapeHtml(code);
    }
    return this.splitToLines(html);
  }

  private resolveLanguage(path: string): string | undefined {
    const ext = this.fileExt(path);
    const alias = LANG_ALIASES[ext];
    if (alias && hljs.getLanguage(alias)) return alias;
    if (hljs.getLanguage(ext)) return ext;
    return undefined;
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Reparte el HTML resaltado en una línea por salto de línea del fuente,
  // re-balanceando los <span> abiertos en cada corte. El salto de línea es un
  // token propio: así NUNCA puede quedar absorbido dentro de una etiqueta (p.ej.
  // si el resaltador emite un '<' suelto, como ocurre con plantillas Twig), lo
  // que colapsaría todo el archivo en una sola línea. La rama final `(<)` captura
  // un '<' que no formó etiqueta y lo conserva como texto en vez de descartarlo.
  private splitToLines(html: string): string[] {
    const lines: string[] = [];
    const open: string[] = [];
    let cur = '';
    const re = /(<[^>\n]+>)|(\n)|([^<\n]+)|(<)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (m[1]) {
        const tag = m[1];
        cur += tag;
        if (tag.startsWith('</')) open.pop();
        else if (!tag.endsWith('/>')) open.push(tag);
      } else if (m[2]) {
        cur += '</span>'.repeat(open.length);
        lines.push(cur);
        cur = open.join('');
      } else {
        cur += m[3] ?? m[4];
      }
    }
    lines.push(cur);
    return lines;
  }
}

export const highlightService = HighlightService.getInstance();
