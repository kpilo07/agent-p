// Tipos del dominio de diff. Sin dependencias externas.

export type RowKind = 'add' | 'del' | 'ctx' | 'hunk';

export interface DiffRow {
  kind: RowKind;
  oldNo?: number;
  newNo?: number;
  text: string;
}

export interface DiffFile {
  path: string;
  rows: DiffRow[];
  additions: number;
  deletions: number;
}
