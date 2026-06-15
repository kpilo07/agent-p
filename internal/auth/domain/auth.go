// Package domain define el modelo y los contratos del bounded context "auth":
// usuarios locales de la aplicación y sus sesiones. No hay credenciales del
// sistema operativo (incompatibles con el binario único sin CGO y con un
// servidor TCP local), así que la autenticación es propia y se persiste en
// SQLite.
package domain

import (
	"context"
	"errors"
	"time"
)

// User es un usuario local de agent-p. PasswordHash nunca se expone por la API.
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}

// Session es un token de sesión emitido tras un login o setup correcto.
type Session struct {
	Token     string    `json:"-"`
	UserID    string    `json:"-"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// Errores del dominio de autenticación.
var (
	// ErrInvalidCredentials: usuario inexistente o contraseña incorrecta. Se
	// devuelve el mismo error en ambos casos para no filtrar qué usuarios existen.
	ErrInvalidCredentials = errors.New("auth: invalid credentials")
	// ErrSetupDone: se intentó crear el primer usuario cuando ya existe alguno.
	ErrSetupDone = errors.New("auth: the app already has users")
	// ErrWeakInput: usuario o contraseña no cumplen los requisitos mínimos.
	ErrWeakInput = errors.New("auth: invalid username or password")
	// ErrUserExists: ya existe un usuario con ese nombre.
	ErrUserExists = errors.New("auth: the user already exists")
	// ErrUnauthorized: token de sesión ausente, inválido o caducado.
	ErrUnauthorized = errors.New("auth: unauthorized")
	// ErrNotFound: el recurso solicitado no existe en el repositorio.
	ErrNotFound = errors.New("auth: not found")
)

// ── PUERTOS DE SALIDA (driven) ────────────────────────────────────────────

// UserRepository abstrae la persistencia de usuarios.
type UserRepository interface {
	CountUsers(ctx context.Context) (int, error)
	CreateUser(ctx context.Context, username, passwordHash string) (User, error)
	GetUserByUsername(ctx context.Context, username string) (User, error)
	GetUserByID(ctx context.Context, id string) (User, error)
}

// SessionRepository abstrae la persistencia de sesiones.
type SessionRepository interface {
	CreateSession(ctx context.Context, token, userID string, expiresAt time.Time) error
	GetSession(ctx context.Context, token string) (Session, error)
	DeleteSession(ctx context.Context, token string) error
	DeleteExpired(ctx context.Context) error
}

// PasswordHasher abstrae el hashing y verificación de contraseñas.
type PasswordHasher interface {
	Hash(password string) (string, error)
	Compare(hash, password string) bool
}

// ── PUERTO DE ENTRADA (driving) ───────────────────────────────────────────

// AuthUseCases es la fachada del bounded context "auth".
type AuthUseCases interface {
	// NeedsSetup indica si todavía no existe ningún usuario (primer arranque).
	NeedsSetup(ctx context.Context) (bool, error)
	// Setup crea el primer usuario. Solo permitido cuando no existe ninguno.
	Setup(ctx context.Context, username, password string) (Session, error)
	// Login valida credenciales y emite una sesión.
	Login(ctx context.Context, username, password string) (Session, error)
	// Logout invalida una sesión.
	Logout(ctx context.Context, token string) error
	// Authenticate resuelve el usuario a partir de un token de sesión válido.
	Authenticate(ctx context.Context, token string) (User, error)
}
