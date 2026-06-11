// Package term gestiona Pseudo-Terminales (PTY) por proyecto. Cada proyecto
// puede tener varias terminales: la del agente (AgentTermID, que ejecuta el
// cli_command) y shells adicionales creadas por el usuario. Cada PTY corre en
// su propia goroutine y su salida se difunde por el Hub etiquetada con
// projectId + termId.
package term

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"

	"agent-p/internal/hub"
)

// AgentTermID identifica la terminal principal (la del agente de IA).
const AgentTermID = "agent"

var (
	ErrAlreadyRunning = errors.New("term: session already running")
	ErrNotRunning     = errors.New("term: no session running")
)

// replayLimit acota el buffer de scrollback que se reenvía al hacer attach.
const replayLimit = 256 * 1024

// TermInfo describe una terminal activa para la UI.
type TermInfo struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Running bool   `json:"running"`
}

type session struct {
	projectID string
	termID    string
	title     string
	seq       int // orden de creación, para listar establemente
	cmd       *exec.Cmd
	ptmx      *os.File

	mu  sync.Mutex
	buf []byte
}

func (s *session) appendOutput(p []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.buf = append(s.buf, p...)
	if len(s.buf) > replayLimit {
		// Conserva la mitad más reciente para no recortar en cada chunk.
		s.buf = append([]byte(nil), s.buf[len(s.buf)-replayLimit/2:]...)
	}
}

func (s *session) replay() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]byte(nil), s.buf...)
}

// Manager mantiene los PTYs de todos los proyectos activos.
type Manager struct {
	log *slog.Logger
	hub *hub.Hub

	// OnSessionEnd se invoca (en la goroutine del PTY) cuando un proceso
	// termina, para que la orquestación cierre la sesión en BD, etc.
	OnSessionEnd func(projectID, termID string)

	mu       sync.Mutex
	sessions map[string]*session // key: projectID + "\x00" + termID
	seq      int
}

func NewManager(log *slog.Logger, h *hub.Hub) *Manager {
	return &Manager{log: log, hub: h, sessions: make(map[string]*session)}
}

func key(projectID, termID string) string { return projectID + "\x00" + termID }

// NewTermID genera un identificador corto para terminales adicionales.
func NewTermID() string {
	b := make([]byte, 4)
	rand.Read(b)
	return "t-" + hex.EncodeToString(b)
}

// Start lanza un PTY para (proyecto, terminal). Si cliCommand está vacío se
// abre el shell de login del usuario.
func (m *Manager) Start(projectID, termID, title, dir, cliCommand string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.sessions[key(projectID, termID)]; ok {
		return ErrAlreadyRunning
	}

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}
	var cmd *exec.Cmd
	if cliCommand != "" {
		// El comando del agente (claude, codex, aider…) corre dentro de un
		// shell de login para heredar PATH y configuración del usuario.
		cmd = exec.Command(shell, "-l", "-c", cliCommand)
	} else {
		cmd = exec.Command(shell, "-l")
	}
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor")

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: 120, Rows: 32})
	if err != nil {
		return fmt.Errorf("term: start pty: %w", err)
	}

	m.seq++
	sess := &session{
		projectID: projectID,
		termID:    termID,
		title:     title,
		seq:       m.seq,
		cmd:       cmd,
		ptmx:      ptmx,
	}
	m.sessions[key(projectID, termID)] = sess

	m.hub.BroadcastGlobal(hub.Event{
		Type:      hub.EventSessionState,
		ProjectID: projectID,
		TermID:    termID,
		Payload:   map[string]any{"running": true, "title": title},
	})

	go m.readLoop(sess)
	m.log.Info("pty started", "project", projectID, "term", termID, "cmd", cmd.Args)
	return nil
}

// readLoop es la goroutine dueña de la lectura del PTY de una terminal.
func (m *Manager) readLoop(sess *session) {
	buf := make([]byte, 8192)
	for {
		n, err := sess.ptmx.Read(buf)
		if n > 0 {
			chunk := buf[:n]
			sess.appendOutput(chunk)
			// La salida cruda puede no ser UTF-8 válido: base64 para JSON.
			m.hub.BroadcastProject(sess.projectID, hub.Event{
				Type:    hub.EventOutput,
				TermID:  sess.termID,
				Payload: base64.StdEncoding.EncodeToString(chunk),
			})
		}
		if err != nil {
			break // EOF o PTY cerrado: el proceso terminó.
		}
	}

	sess.cmd.Wait()
	m.remove(sess.projectID, sess.termID)

	m.hub.BroadcastGlobal(hub.Event{
		Type:      hub.EventSessionState,
		ProjectID: sess.projectID,
		TermID:    sess.termID,
		Payload:   map[string]any{"running": false, "title": sess.title},
	})
	if m.OnSessionEnd != nil {
		m.OnSessionEnd(sess.projectID, sess.termID)
	}
	m.log.Info("pty ended", "project", sess.projectID, "term", sess.termID)
}

func (m *Manager) remove(projectID, termID string) {
	m.mu.Lock()
	delete(m.sessions, key(projectID, termID))
	m.mu.Unlock()
}

func (m *Manager) get(projectID, termID string) (*session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[key(projectID, termID)]
	return s, ok
}

// Write envía input del usuario a la terminal indicada.
func (m *Manager) Write(projectID, termID string, data []byte) error {
	sess, ok := m.get(projectID, termID)
	if !ok {
		return ErrNotRunning
	}
	_, err := sess.ptmx.Write(data)
	return err
}

// Resize ajusta el tamaño del PTY al de la terminal del navegador.
func (m *Manager) Resize(projectID, termID string, cols, rows uint16) error {
	sess, ok := m.get(projectID, termID)
	if !ok {
		return ErrNotRunning
	}
	return pty.Setsize(sess.ptmx, &pty.Winsize{Cols: cols, Rows: rows})
}

// Replay devuelve el scrollback acumulado (para repintar al hacer attach).
func (m *Manager) Replay(projectID, termID string) ([]byte, bool) {
	sess, ok := m.get(projectID, termID)
	if !ok {
		return nil, false
	}
	return sess.replay(), true
}

// Running indica si la terminal tiene un PTY activo.
func (m *Manager) Running(projectID, termID string) bool {
	_, ok := m.get(projectID, termID)
	return ok
}

// ListTerminals devuelve las terminales activas de un proyecto, la del
// agente primero y el resto por orden de creación.
func (m *Manager) ListTerminals(projectID string) []TermInfo {
	m.mu.Lock()
	defer m.mu.Unlock()

	prefix := projectID + "\x00"
	sessions := []*session{}
	for k, s := range m.sessions {
		if strings.HasPrefix(k, prefix) {
			sessions = append(sessions, s)
		}
	}
	sort.Slice(sessions, func(i, j int) bool {
		if (sessions[i].termID == AgentTermID) != (sessions[j].termID == AgentTermID) {
			return sessions[i].termID == AgentTermID
		}
		return sessions[i].seq < sessions[j].seq
	})

	terms := make([]TermInfo, 0, len(sessions))
	for _, s := range sessions {
		terms = append(terms, TermInfo{ID: s.termID, Title: s.title, Running: true})
	}
	return terms
}

// Stop termina el proceso de una terminal. Envía SIGHUP (cierre natural de
// terminal: el bash interactivo IGNORA SIGTERM) + SIGTERM al grupo de proceso
// y escala a SIGKILL si el proceso sigue vivo pasados unos segundos.
func (m *Manager) Stop(projectID, termID string) error {
	sess, ok := m.get(projectID, termID)
	if !ok {
		return ErrNotRunning
	}
	if sess.cmd.Process != nil {
		pid := sess.cmd.Process.Pid
		// Señal negativa = grupo de proceso completo (el shell y sus hijos).
		syscall.Kill(-pid, syscall.SIGHUP)
		syscall.Kill(-pid, syscall.SIGTERM)
		time.AfterFunc(3*time.Second, func() {
			if m.Running(projectID, termID) {
				syscall.Kill(-pid, syscall.SIGKILL)
			}
		})
	}
	sess.ptmx.Close()
	return nil
}

// StopProject termina todas las terminales de un proyecto.
func (m *Manager) StopProject(projectID string) error {
	m.mu.Lock()
	prefix := projectID + "\x00"
	ids := []string{}
	for k, s := range m.sessions {
		if strings.HasPrefix(k, prefix) {
			ids = append(ids, s.termID)
		}
	}
	m.mu.Unlock()

	if len(ids) == 0 {
		return ErrNotRunning
	}
	for _, id := range ids {
		m.Stop(projectID, id)
	}
	return nil
}

// StopAll termina todas las sesiones activas (apagado ordenado del servidor).
func (m *Manager) StopAll() {
	m.mu.Lock()
	type pair struct{ p, t string }
	all := make([]pair, 0, len(m.sessions))
	for _, s := range m.sessions {
		all = append(all, pair{s.projectID, s.termID})
	}
	m.mu.Unlock()
	for _, x := range all {
		m.Stop(x.p, x.t)
	}
}
