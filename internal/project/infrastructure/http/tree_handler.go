package http

import (
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// handleProjectTree devuelve el árbol de archivos del repositorio.
func (s *Server) handleProjectTree(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	tree, err := s.uc.GetFileTree(r.Context(), p.Path)
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, tree)
}

// handleProjectFile devuelve el contenido de un archivo del repositorio.
func (s *Server) handleProjectFile(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	clean, ok := s.cleanRepoPath(w, r)
	if !ok {
		return
	}

	content, err := s.uc.GetFile(r.Context(), p.Path, clean)
	if err != nil {
		s.failMsg(w, "el path no existe o no es un archivo", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, content)
}

// handleProjectRaw sirve los bytes crudos de un archivo del repositorio.
func (s *Server) handleProjectRaw(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
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

	ctype := mime.TypeByExtension(filepath.Ext(abs))
	f, err := os.Open(abs)
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	defer f.Close()
	if ctype == "" {
		head := make([]byte, 512)
		n, _ := f.Read(head)
		ctype = http.DetectContentType(head[:n])
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			s.fail(w, err, http.StatusInternalServerError)
			return
		}
	}
	w.Header().Set("Content-Type", ctype)
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

// handleProjectFileDiff devuelve el diff de un único archivo del repositorio.
func (s *Server) handleProjectFileDiff(w http.ResponseWriter, r *http.Request) {
	p, err := s.uc.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failNotFound(w, err)
		return
	}
	clean, ok := s.cleanRepoPath(w, r)
	if !ok {
		return
	}

	diff, err := s.uc.GetFileDiff(r.Context(), p.Path, clean)
	if err != nil {
		s.fail(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"path": filepath.ToSlash(clean),
		"diff": diff,
	})
}

// cleanRepoPath valida y normaliza el query param `path`.
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
