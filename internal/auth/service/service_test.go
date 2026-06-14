package service

import (
	"context"
	"testing"
	"time"

	"agent-p/internal/auth/domain"
	authcrypto "agent-p/internal/auth/infrastructure/crypto"
)

// fakeStore implementa UserRepository y SessionRepository en memoria.
type fakeStore struct {
	users    map[string]domain.User // por id
	byName   map[string]string      // username(lower) -> id
	sessions map[string]domain.Session
	seq      int
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		users:    map[string]domain.User{},
		byName:   map[string]string{},
		sessions: map[string]domain.Session{},
	}
}

func (f *fakeStore) CountUsers(context.Context) (int, error) { return len(f.users), nil }

func (f *fakeStore) CreateUser(_ context.Context, username, hash string) (domain.User, error) {
	if _, ok := f.byName[username]; ok {
		return domain.User{}, domain.ErrUserExists
	}
	f.seq++
	u := domain.User{ID: string(rune('a' + f.seq)), Username: username, PasswordHash: hash, CreatedAt: time.Now()}
	f.users[u.ID] = u
	f.byName[username] = u.ID
	return u, nil
}

func (f *fakeStore) GetUserByUsername(_ context.Context, username string) (domain.User, error) {
	id, ok := f.byName[username]
	if !ok {
		return domain.User{}, domain.ErrNotFound
	}
	return f.users[id], nil
}

func (f *fakeStore) GetUserByID(_ context.Context, id string) (domain.User, error) {
	u, ok := f.users[id]
	if !ok {
		return domain.User{}, domain.ErrNotFound
	}
	return u, nil
}

func (f *fakeStore) CreateSession(_ context.Context, token, userID string, exp time.Time) error {
	f.sessions[token] = domain.Session{Token: token, UserID: userID, ExpiresAt: exp}
	return nil
}

func (f *fakeStore) GetSession(_ context.Context, token string) (domain.Session, error) {
	s, ok := f.sessions[token]
	if !ok {
		return domain.Session{}, domain.ErrNotFound
	}
	return s, nil
}

func (f *fakeStore) DeleteSession(_ context.Context, token string) error {
	delete(f.sessions, token)
	return nil
}

func (f *fakeStore) DeleteExpired(context.Context) error { return nil }

func newSvc() (*Service, *fakeStore) {
	store := newFakeStore()
	return New(store, store, authcrypto.New()), store
}

func TestSetupFlow(t *testing.T) {
	ctx := context.Background()
	svc, _ := newSvc()

	if need, _ := svc.NeedsSetup(ctx); !need {
		t.Fatal("NeedsSetup debería ser true sin usuarios")
	}

	sess, err := svc.Setup(ctx, "admin", "supersecret")
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	if sess.Token == "" {
		t.Fatal("setup no emitió sesión")
	}

	if need, _ := svc.NeedsSetup(ctx); need {
		t.Fatal("NeedsSetup debería ser false tras crear usuario")
	}

	// Un segundo setup debe rechazarse.
	if _, err := svc.Setup(ctx, "otro", "supersecret"); err != domain.ErrSetupDone {
		t.Fatalf("segundo setup: esperaba ErrSetupDone, obtuve %v", err)
	}
}

func TestSetupRejectsWeakInput(t *testing.T) {
	ctx := context.Background()
	svc, _ := newSvc()
	if _, err := svc.Setup(ctx, "ab", "supersecret"); err != domain.ErrWeakInput {
		t.Fatalf("usuario corto: esperaba ErrWeakInput, obtuve %v", err)
	}
	if _, err := svc.Setup(ctx, "admin", "short"); err != domain.ErrWeakInput {
		t.Fatalf("contraseña corta: esperaba ErrWeakInput, obtuve %v", err)
	}
}

func TestLoginAndAuthenticate(t *testing.T) {
	ctx := context.Background()
	svc, _ := newSvc()
	if _, err := svc.Setup(ctx, "admin", "supersecret"); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.Login(ctx, "admin", "wrong"); err != domain.ErrInvalidCredentials {
		t.Fatalf("login con contraseña mala: esperaba ErrInvalidCredentials, obtuve %v", err)
	}
	if _, err := svc.Login(ctx, "fantasma", "supersecret"); err != domain.ErrInvalidCredentials {
		t.Fatalf("login usuario inexistente: esperaba ErrInvalidCredentials, obtuve %v", err)
	}

	sess, err := svc.Login(ctx, "admin", "supersecret")
	if err != nil {
		t.Fatalf("login válido: %v", err)
	}
	user, err := svc.Authenticate(ctx, sess.Token)
	if err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	if user.Username != "admin" {
		t.Fatalf("usuario inesperado: %q", user.Username)
	}

	// Token inválido y logout.
	if _, err := svc.Authenticate(ctx, "no-existe"); err != domain.ErrUnauthorized {
		t.Fatalf("token inválido: esperaba ErrUnauthorized, obtuve %v", err)
	}
	if err := svc.Logout(ctx, sess.Token); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Authenticate(ctx, sess.Token); err != domain.ErrUnauthorized {
		t.Fatalf("tras logout: esperaba ErrUnauthorized, obtuve %v", err)
	}
}

func TestAuthenticateRejectsExpired(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	svc := New(store, store, authcrypto.New())
	store.CreateUser(ctx, "admin", "x")
	store.CreateSession(ctx, "caducada", store.byName["admin"], time.Now().Add(-time.Hour))

	if _, err := svc.Authenticate(ctx, "caducada"); err != domain.ErrUnauthorized {
		t.Fatalf("sesión caducada: esperaba ErrUnauthorized, obtuve %v", err)
	}
	if _, ok := store.sessions["caducada"]; ok {
		t.Fatal("la sesión caducada debería haberse eliminado")
	}
}
