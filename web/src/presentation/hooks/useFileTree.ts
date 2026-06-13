// Hook de presentación: conecta la UI con el árbol de archivos y alertas.
import { useStore } from '../../infrastructure/store/store';

export function useFileTree(projectId: string | null) {
  const treeVersion = useStore((s) => (projectId ? (s.treeVersion[projectId] ?? 0) : 0));
  const expandedDirs = useStore((s) => (projectId ? (s.expandedDirs[projectId] ?? []) : []));
  const fileAlerts = useStore((s) => (projectId ? (s.fileAlerts[projectId] ?? {}) : {}));
  const toggleDir = useStore((s) => s.toggleDir);
  const clearFileAlert = useStore((s) => s.clearFileAlert);
  const selectedFile = useStore((s) => s.selectedFile);
  const setSelectedFile = useStore((s) => s.setSelectedFile);
  const searchOpen = useStore((s) => s.searchOpen);
  const setSearchOpen = useStore((s) => s.setSearchOpen);

  return {
    treeVersion,
    expandedDirs,
    fileAlerts,
    selectedFile,
    searchOpen,
    toggleDir,
    clearFileAlert,
    setSelectedFile,
    setSearchOpen,
  } as const;
}
