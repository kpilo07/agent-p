package service

import (
	"os"
	"path/filepath"
	"testing"

	"agent-p/internal/project/domain"
)

func TestIsBinary(t *testing.T) {
	tests := []struct {
		name      string
		data      []byte
		truncated bool
		want      bool
	}{
		{"texto ascii", []byte("hola mundo\n"), false, false},
		{"utf-8 válido", []byte("café añejo — €"), false, false},
		{"contiene byte nulo", []byte("abc\x00def"), false, true},
		{"vacío", []byte{}, false, false},
		{"utf-8 cortado al final no es binario", []byte("texto válido y más texto aquí"), true, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isBinary(tt.data, tt.truncated); got != tt.want {
				t.Errorf("isBinary(%q) = %v, want %v", tt.data, got, tt.want)
			}
		})
	}
}

func TestScanTreeIgnoresVCSAndDeps(t *testing.T) {
	root := t.TempDir()

	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.WriteFile(filepath.Join(root, "main.go"), []byte("package main"), 0o644))
	must(os.MkdirAll(filepath.Join(root, "src"), 0o755))
	must(os.WriteFile(filepath.Join(root, "src", "app.ts"), []byte("export {}"), 0o644))
	// Estos deben ignorarse por completo.
	must(os.MkdirAll(filepath.Join(root, ".git"), 0o755))
	must(os.WriteFile(filepath.Join(root, ".git", "HEAD"), []byte("ref: x"), 0o644))
	must(os.MkdirAll(filepath.Join(root, "node_modules", "left-pad"), 0o755))
	must(os.WriteFile(filepath.Join(root, "node_modules", "left-pad", "i.js"), []byte("//"), 0o644))

	tree, err := scanTree(root, "")
	if err != nil {
		t.Fatal(err)
	}

	names := childNames(tree)
	// scanTree ordena los directorios antes que los archivos, así que "src"
	// precede a "main.go".
	want := []string{"src", "main.go"}
	if len(names) != len(want) {
		t.Fatalf("hijos de la raíz = %v, want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Errorf("hijo[%d] = %q, want %q", i, names[i], want[i])
		}
	}

	src := findChild(tree, "src")
	if src == nil {
		t.Fatal("falta el directorio src")
	}
	if got := childNames(src); len(got) != 1 || got[0] != "app.ts" {
		t.Errorf("contenido de src = %v, want [app.ts]", got)
	}
}

func childNames(n *domain.TreeNode) []string {
	names := make([]string, 0, len(n.Children))
	for _, c := range n.Children {
		names = append(names, c.Name)
	}
	return names
}

func findChild(n *domain.TreeNode, name string) *domain.TreeNode {
	for _, c := range n.Children {
		if c.Name == name {
			return c
		}
	}
	return nil
}
