// Servicio de resaltado de sintaxis con highlight.js. Patrón: Singleton + Lazy Init
import hljs from 'highlight.js/lib/common';

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif',
]);
const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdown', 'mkd']);
const LANG_ALIASES: Record<string, string> = {
  jsx: 'javascript', tsx: 'typescript', mjs: 'javascript', cjs: 'javascript',
  yml: 'yaml', sh: 'bash', zsh: 'bash', bash: 'bash',
  htm: 'xml', html: 'xml', vue: 'xml',
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

  private splitToLines(html: string): string[] {
    const lines: string[] = [];
    const open: string[] = [];
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
}

export const highlightService = HighlightService.getInstance();
