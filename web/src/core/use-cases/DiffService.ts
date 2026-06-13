// Caso de uso: parseo y formateo de git diffs.
// Patrón: Strategy + Singleton — algoritmo intercambiable y testeable.
import type { DiffFile, DiffRow } from '../domain/diff';

class DiffService {
  private static instance: DiffService | null = null;

  private constructor() {}

  static getInstance(): DiffService {
    if (!DiffService.instance) {
      DiffService.instance = new DiffService();
    }
    return DiffService.instance;
  }

  /** Parsea un diff unificado de git a un array de archivos con filas renderizables. */
  parseDiff(diff: string): DiffFile[] {
    const files: DiffFile[] = [];
    let current: DiffFile | null = null;
    let oldNo = 0;
    let newNo = 0;

    for (const line of diff.split('\n')) {
      if (line.startsWith('diff --git ')) {
        const path = line.replace(/^diff --git a\/(.*) b\/.*$/, '$1');
        current = { path, rows: [], additions: 0, deletions: 0 };
        files.push(current);
        continue;
      }
      if (!current) continue;

      if (
        line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ') ||
        line.startsWith('new file mode') ||
        line.startsWith('deleted file mode') ||
        line.startsWith('old mode') ||
        line.startsWith('new mode') ||
        line.startsWith('similarity index') ||
        line.startsWith('rename from') ||
        line.startsWith('rename to')
      ) {
        continue;
      }

      if (line.startsWith('@@')) {
        const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
        if (m) {
          oldNo = parseInt(m[1], 10);
          newNo = parseInt(m[2], 10);
          current.rows.push({ kind: 'hunk', text: line } as DiffRow);
        }
        continue;
      }

      if (line.startsWith('+')) {
        current.rows.push({ kind: 'add', newNo: newNo++, text: line.slice(1) });
        current.additions++;
      } else if (line.startsWith('-')) {
        current.rows.push({ kind: 'del', oldNo: oldNo++, text: line.slice(1) });
        current.deletions++;
      } else if (line.startsWith('\\')) {
        current.rows.push({ kind: 'hunk', text: line } as DiffRow);
      } else {
        current.rows.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
      }
    }
    return files;
  }

  /** Mapea el código de estado de git a clase CSS y etiqueta legible. */
  statusTag(status: string): { cls: string; label: string } {
    if (status.includes('?')) return { cls: 'gotham-tag--info', label: 'nuevo' };
    if (status.includes('D')) return { cls: 'gotham-tag--critical', label: 'borrado' };
    if (status.includes('A')) return { cls: 'gotham-tag--low', label: 'añadido' };
    if (status.includes('R')) return { cls: 'gotham-tag--medium', label: 'renombrado' };
    return { cls: 'gotham-tag--medium', label: 'modificado' };
  }
}

export const diffService = DiffService.getInstance();
