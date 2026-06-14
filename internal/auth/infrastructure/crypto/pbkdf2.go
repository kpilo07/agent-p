// Package crypto implementa domain.PasswordHasher con PBKDF2-HMAC-SHA256.
// Se usa la librería estándar (crypto/pbkdf2, Go 1.24+): cero dependencias
// externas y compatible con CGO_ENABLED=0.
package crypto

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"agent-p/internal/auth/domain"
)

const (
	// iterations: recomendación OWASP para PBKDF2-HMAC-SHA256.
	iterations = 600_000
	saltLen    = 16
	keyLen     = 32
)

// Hasher implementa domain.PasswordHasher.
type Hasher struct{}

// New construye el hasher.
func New() *Hasher { return &Hasher{} }

// Hash deriva la contraseña y devuelve una cadena auto-descriptiva:
//   pbkdf2-sha256$<iter>$<salt_b64>$<hash_b64>
func (Hasher) Hash(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	dk, err := pbkdf2.Key(sha256.New, password, salt, iterations, keyLen)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s",
		iterations,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(dk),
	), nil
}

// Compare verifica una contraseña contra un hash con comparación en tiempo
// constante. Devuelve false ante cualquier hash malformado.
func (Hasher) Compare(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter <= 0 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, password, salt, iter, len(want))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(got, want) == 1
}

var _ domain.PasswordHasher = (*Hasher)(nil)
