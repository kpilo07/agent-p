package gitwatch

import (
	"strings"
	"testing"

	"agent-p/internal/project/domain"
)

func TestParseNumstat(t *testing.T) {
	in := []byte("3\t1\tmain.go\n" +
		"10\t0\tinternal/svc.go\n" +
		"-\t-\tassets/logo.png\n" + // binario: git emite "-"
		"malformada\n") // línea con menos de 3 campos: se ignora

	stats := parseNumstat(in)

	if len(stats) != 3 {
		t.Fatalf("esperaba 3 entradas, obtuve %d: %v", len(stats), stats)
	}
	if got := stats["main.go"]; got != [2]int{3, 1} {
		t.Errorf("main.go = %v, want [3 1]", got)
	}
	if got := stats["internal/svc.go"]; got != [2]int{10, 0} {
		t.Errorf("internal/svc.go = %v, want [10 0]", got)
	}
	if got := stats["assets/logo.png"]; got != [2]int{0, 0} {
		t.Errorf("binario logo.png = %v, want [0 0]", got)
	}
}

func TestSummarize(t *testing.T) {
	s := &domain.GitSnapshot{
		Files:     []domain.FileStat{{Path: "a.go"}, {Path: "b.go"}},
		Additions: 12,
		Deletions: 4,
	}
	got := summarize(s)
	for _, want := range []string{"2 archivo", "+12", "-4"} {
		if !strings.Contains(got, want) {
			t.Errorf("summarize() = %q, no contiene %q", got, want)
		}
	}
}

func TestSnapHash(t *testing.T) {
	base := &domain.GitSnapshot{
		Branch: "main",
		Diff:   "diff --git a/x b/x",
		Files:  []domain.FileStat{{Path: "x", Status: "M"}},
	}
	same := &domain.GitSnapshot{
		Branch: "main",
		Diff:   "diff --git a/x b/x",
		Files:  []domain.FileStat{{Path: "x", Status: "M"}},
		// Additions/UpdatedAt distintos NO deben cambiar el hash: solo
		// branch+diff+files participan en la identidad del snapshot.
		Additions: 99,
	}
	if snapHash(base) != snapHash(same) {
		t.Error("snapshots con mismo branch/diff/files deberían tener el mismo hash")
	}

	tests := []func(*domain.GitSnapshot){
		func(s *domain.GitSnapshot) { s.Branch = "dev" },
		func(s *domain.GitSnapshot) { s.Diff = "otra cosa" },
		func(s *domain.GitSnapshot) { s.Files[0].Status = "A" },
		func(s *domain.GitSnapshot) { s.Files[0].Path = "y" },
	}
	for i, mutate := range tests {
		mod := &domain.GitSnapshot{Branch: base.Branch, Diff: base.Diff,
			Files: []domain.FileStat{{Path: "x", Status: "M"}}}
		mutate(mod)
		if snapHash(base) == snapHash(mod) {
			t.Errorf("mutación #%d debería cambiar el hash", i)
		}
	}
}
