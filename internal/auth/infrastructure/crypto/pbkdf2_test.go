package crypto

import "testing"

func TestHashAndCompare(t *testing.T) {
	h := New()
	hash, err := h.Hash("correct horse battery staple")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if hash == "" {
		t.Fatal("hash vacío")
	}
	if !h.Compare(hash, "correct horse battery staple") {
		t.Fatal("la contraseña correcta no verificó")
	}
	if h.Compare(hash, "wrong password") {
		t.Fatal("una contraseña incorrecta verificó")
	}
}

func TestHashIsSalted(t *testing.T) {
	h := New()
	a, _ := h.Hash("same")
	b, _ := h.Hash("same")
	if a == b {
		t.Fatal("dos hashes de la misma contraseña deberían diferir (salt aleatorio)")
	}
}

func TestCompareRejectsMalformed(t *testing.T) {
	h := New()
	for _, bad := range []string{"", "plain", "pbkdf2-sha256$x$y", "md5$1$a$b"} {
		if h.Compare(bad, "x") {
			t.Fatalf("hash malformado aceptado: %q", bad)
		}
	}
}
