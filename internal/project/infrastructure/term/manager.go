// Package term implementa domain.TerminalService usando pseudo-terminales (PTY).
package term

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"log/slog"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"

	"agent-p/internal/project/domain"
	"agent-p/internal/project/infrastructure/hub"
)

const replayLimit = 256 * 1024

type session struct {
	projectID string
	termID    string
	title     string
	seq       int
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
		s.buf = append([]byte(nil), s.buf[len(s.buf)-replayLimit/2:]...)
	}
}

func (s *session) replay() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]byte(nil), s.buf...)
}

// Manager gestiona los PTYs e implementa domain.TerminalService.
type Manager struct {
	log *slog.Logger
	hub *hub.Hub

	onSessionEnd func(projectID, termID string)

	mu       sync.Mutex
	sessions map[string]*session
	seq      int
}

// New crea un Manager.
func New(log *slog.Logger, h *hub.Hub) *Manager {
	return &Manager{log: log, hub: h, sessions: make(map[string]*session)}
}

func sessionKey(projectID, termID string) string { return projectID + "\x00" + termID }

func (m *Manager) NewTermID() string {
	b := make([]byte, 4)
	rand.Read(b)
	return "t-" + hex.EncodeToString(b)
}

func (m *Manager) SetOnSessionEnd(fn func(projectID, termID string)) {
	m.onSessionEnd = fn
}

func (m *Manager) Start(projectID, termID, title, dir, cliCommand string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.sessions[sessionKey(projectID, termID)]; ok {
		return domain.ErrAlreadyRunning
	}

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}
	var cmd *exec.Cmd
	if cliCommand != "" {
		cmd = exec.Command(shell, "-l", "-c", cliCommand)
	} else {
		cmd = exec.Command(shell, "-l")
	}
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor")

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: 120, Rows: 32})
	if err != nil {
		return err
	}

	m.seq++
	sess := &session{
		projectID: projectID, termID: termID, title: title,
		seq: m.seq, cmd: cmd, ptmx: ptmx,
	}
	m.sessions[sessionKey(projectID, termID)] = sess
	m.hub.BroadcastGlobalEvent(hub.Events.SessionState(projectID, termID, true, title))

	go m.readLoop(sess)
	m.log.Info("pty started", "project", projectID, "term", termID)
	return nil
}

func (m *Manager) readLoop(sess *session) {
	buf := make([]byte, 8192)
	for {
		n, err := sess.ptmx.Read(buf)
		if n > 0 {
			chunk := buf[:n]
			sess.appendOutput(chunk)
			m.hub.BroadcastProjectEvent(sess.projectID,
				hub.Events.Output(sess.projectID, sess.termID, base64.StdEncoding.EncodeToString(chunk)))
		}
		if err != nil {
			break
		}
	}
	sess.cmd.Wait()
	m.remove(sess.projectID, sess.termID)
	m.hub.BroadcastGlobalEvent(hub.Events.SessionState(sess.projectID, sess.termID, false, sess.title))
	if m.onSessionEnd != nil {
		m.onSessionEnd(sess.projectID, sess.termID)
	}
	m.log.Info("pty ended", "project", sess.projectID, "term", sess.termID)
}

func (m *Manager) remove(projectID, termID string) {
	m.mu.Lock()
	delete(m.sessions, sessionKey(projectID, termID))
	m.mu.Unlock()
}

func (m *Manager) get(projectID, termID string) (*session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[sessionKey(projectID, termID)]
	return s, ok
}

func (m *Manager) Write(projectID, termID string, data []byte) error {
	sess, ok := m.get(projectID, termID)
	if !ok {
		return domain.ErrNotRunning
	}
	_, err := sess.ptmx.Write(data)
	return err
}

func (m *Manager) Resize(projectID, termID string, cols, rows uint16) error {
	sess, ok := m.get(projectID, termID)
	if !ok {
		return domain.ErrNotRunning
	}
	return pty.Setsize(sess.ptmx, &pty.Winsize{Cols: cols, Rows: rows})
}

func (m *Manager) Replay(projectID, termID string) ([]byte, bool) {
	sess, ok := m.get(projectID, termID)
	if !ok {
		return nil, false
	}
	return sess.replay(), true
}

func (m *Manager) Running(projectID, termID string) bool {
	_, ok := m.get(projectID, termID)
	return ok
}

func (m *Manager) ListTerminals(projectID string) []domain.TermInfo {
	m.mu.Lock()
	defer m.mu.Unlock()

	prefix := projectID + "\x00"
	var sessions []*session
	for k, s := range m.sessions {
		if strings.HasPrefix(k, prefix) {
			sessions = append(sessions, s)
		}
	}
	sort.Slice(sessions, func(i, j int) bool {
		if (sessions[i].termID == domain.AgentTermID) != (sessions[j].termID == domain.AgentTermID) {
			return sessions[i].termID == domain.AgentTermID
		}
		return sessions[i].seq < sessions[j].seq
	})

	terms := make([]domain.TermInfo, 0, len(sessions))
	for _, s := range sessions {
		terms = append(terms, domain.TermInfo{ID: s.termID, Title: s.title, Running: true})
	}
	return terms
}

func (m *Manager) Stop(projectID, termID string) error {
	sess, ok := m.get(projectID, termID)
	if !ok {
		return domain.ErrNotRunning
	}
	if sess.cmd.Process != nil {
		pid := sess.cmd.Process.Pid
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

func (m *Manager) StopProject(projectID string) error {
	m.mu.Lock()
	prefix := projectID + "\x00"
	var ids []string
	for k, s := range m.sessions {
		if strings.HasPrefix(k, prefix) {
			ids = append(ids, s.termID)
		}
	}
	m.mu.Unlock()

	if len(ids) == 0 {
		return domain.ErrNotRunning
	}
	for _, id := range ids {
		m.Stop(projectID, id)
	}
	return nil
}

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

// Compile-time check: Manager implementa domain.TerminalService.
var _ domain.TerminalService = (*Manager)(nil)
