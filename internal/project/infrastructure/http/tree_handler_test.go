package http

import (
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestCleanRepoPath(t *testing.T) {
	sep := string(filepath.Separator)
	tests := []struct {
		name    string
		path    string
		wantOK  bool
		wantVal string // solo se comprueba si wantOK
	}{
		{"archivo simple", "main.go", true, "main.go"},
		{"subdirectorio", "src/app.ts", true, filepath.FromSlash("src/app.ts")},
		{"normaliza ./", "./pkg/x.go", true, filepath.FromSlash("pkg/x.go")},
		{"normaliza interior", "a/b/../c.go", true, filepath.FromSlash("a/c.go")},
		{"vacío rechazado", "", false, ""},
		{"traversal simple", "..", false, ""},
		{"traversal con prefijo", "../etc/passwd", false, ""},
		{"traversal anidado que escapa", "a/../../secret", false, ""},
		{"ruta absoluta rechazada", sep + "etc" + sep + "passwd", false, ""},
	}

	s := &Server{} // cleanRepoPath no usa dependencias del Server
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/api/projects/x/file?path="+tt.path, nil)
			w := httptest.NewRecorder()

			got, ok := s.cleanRepoPath(w, r)
			if ok != tt.wantOK {
				t.Fatalf("cleanRepoPath(%q) ok = %v, want %v", tt.path, ok, tt.wantOK)
			}
			if tt.wantOK && got != tt.wantVal {
				t.Errorf("cleanRepoPath(%q) = %q, want %q", tt.path, got, tt.wantVal)
			}
		})
	}
}
