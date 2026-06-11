package server

import (
	"bytes"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"agent-p/internal/gitwatch"
)

// ── Mapa Táctico: árbol de archivos del repositorio ──────────────

// Directorios excluidos del árbol (y del watcher de fswatch).
var treeIgnored = map[string]bool{".git": true, "node_modules": true}

type treeNode struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"` // relativo a la raíz del repo, separador '/'
	Dir      bool        `json:"dir"`
	Children []*treeNode `json:"children,omitempty"`
}

// handleProjectTree devuelve la estructura completa del repositorio como un
// árbol JSON recursivo, ignorando .git y node_modules.
func (s *Server) handleProjectTree(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	root, err := scanTree(p.Path, "")
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	root.Name = filepath.Base(p.Path)
	writeJSON(w, http.StatusOK, root)
}

func scanTree(absDir, rel string) (*treeNode, error) {
	node := &treeNode{Name: path.Base(rel), Path: rel, Dir: true, Children: []*treeNode{}}

	entries, err := os.ReadDir(absDir)
	if err != nil {
		return nil, err
	}
	// Carpetas primero, luego archivos; alfabético dentro de cada grupo.
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].IsDir() && !entries[j].IsDir()
	})

	for _, e := range entries {
		if treeIgnored[e.Name()] {
			continue
		}
		childRel := path.Join(rel, e.Name())
		switch {
		case e.IsDir():
			child, err := scanTree(filepath.Join(absDir, e.Name()), childRel)
			if err != nil {
				continue // dir no legible: se omite sin tumbar el árbol
			}
			node.Children = append(node.Children, child)
		case e.Type().IsRegular():
			node.Children = append(node.Children, &treeNode{Name: e.Name(), Path: childRel})
		}
	}
	return node, nil
}

// ── Contenido de un archivo individual ───────────────────────────

// Tope de lectura: suficiente para cualquier fuente razonable sin arriesgar
// la memoria del proceso con artefactos gigantes.
const maxFileContent = 1 << 20 // 1 MiB

type fileContent struct {
	Path      string `json:"path"`
	Content   string `json:"content"`
	Size      int64  `json:"size"`
	Truncated bool   `json:"truncated"`
	Binary    bool   `json:"binary"`
}

// handleProjectFile devuelve el contenido de un archivo del repositorio
// (query param `path`, relativo a la raíz) para el visor del Mapa Táctico.
func (s *Server) handleProjectFile(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	clean, ok := s.cleanRepoPath(w, r)
	if !ok {
		return
	}

	abs := filepath.Join(p.Path, clean)
	info, err := os.Stat(abs)
	if err != nil || info.IsDir() {
		s.failMsg(w, "el path no existe o no es un archivo", http.StatusNotFound)
		return
	}

	f, err := os.Open(abs)
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	defer f.Close()

	buf := make([]byte, maxFileContent)
	n, _ := io.ReadFull(f, buf)
	data := buf[:n]

	truncated := info.Size() > int64(n)
	out := fileContent{
		Path:      filepath.ToSlash(clean),
		Size:      info.Size(),
		Truncated: truncated,
		Binary:    isBinary(data, truncated),
	}
	if !out.Binary {
		out.Content = string(data)
	}
	writeJSON(w, http.StatusOK, out)
}

// isBinary combina la heurística de git (NUL en la cabecera) con validación
// UTF-8: los binarios pequeños sin byte cero también deben detectarse.
func isBinary(data []byte, truncated bool) bool {
	head := data
	if len(head) > 8192 {
		head = head[:8192]
	}
	if bytes.IndexByte(head, 0) >= 0 {
		return true
	}
	if truncated && len(data) > utf8.UTFMax {
		// El corte a maxFileContent puede partir una runa multibyte al final.
		data = data[:len(data)-utf8.UTFMax]
	}
	return !utf8.Valid(data)
}

// cleanRepoPath valida y normaliza el query param `path` (relativo a la raíz
// del repo). Escribe la respuesta de error si no es válido.
func (s *Server) cleanRepoPath(w http.ResponseWriter, r *http.Request) (string, bool) {
	rel := r.URL.Query().Get("path")
	if rel == "" {
		s.failMsg(w, "falta el parámetro path", http.StatusBadRequest)
		return "", false
	}
	clean := filepath.Clean(filepath.FromSlash(rel))
	if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		s.failMsg(w, "path fuera del repositorio", http.StatusBadRequest)
		return "", false
	}
	return clean, true
}

// ── Diff de un archivo individual ────────────────────────────────

// handleProjectFileDiff devuelve el git diff de un único archivo del
// repositorio (query param `path`, relativo a la raíz).
func (s *Server) handleProjectFileDiff(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}

	clean, ok := s.cleanRepoPath(w, r)
	if !ok {
		return
	}

	diff, err := gitwatch.TakeFile(r.Context(), p.Path, clean)
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"path": filepath.ToSlash(clean),
		"diff": diff,
	})
}
