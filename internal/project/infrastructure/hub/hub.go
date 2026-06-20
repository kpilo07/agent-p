// Package hub implementa el adaptador WebSocket del EventBus. Gestiona
// múltiples conexiones de UI y proyectos concurrentes.
// El estado interno es propiedad exclusiva de la goroutine Run(); toda
// mutación viaja por canales, eliminando la necesidad de mutexes.
package hub

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/gorilla/websocket"

	"agent-p/internal/project/domain"
)

// Tipos de eventos salientes (backend → UI).
const (
	EventOutput       = "output"
	EventReplay       = "replay"
	EventGitUpdate    = "git_update"
	EventFSChange     = "fs_change"
	EventNotification = "notification"
	EventSessionState = "session_state"
	EventActivity     = "activity"
	EventAgentState   = "agent_state"
)

// Tipos de comandos entrantes (UI → backend).
const (
	CmdAttach      = "attach"
	CmdDetach      = "detach"
	CmdInput       = "input"
	CmdResize      = "resize"
	CmdSubscribe   = "subscribe"
	CmdUnsubscribe = "unsubscribe"
)

// Event es el mensaje serializado hacia la UI.
type Event struct {
	Type      string `json:"type"`
	ProjectID string `json:"projectId,omitempty"`
	TermID    string `json:"termId,omitempty"`
	Payload   any    `json:"payload,omitempty"`
}

// EventFactory crea eventos de dominio de forma consistente. Patrón Factory.
type EventFactory struct{}

func (EventFactory) Output(projectID, termID, base64Data string) Event {
	return Event{Type: EventOutput, ProjectID: projectID, TermID: termID, Payload: base64Data}
}

func (EventFactory) Replay(projectID, termID, base64Data string) Event {
	return Event{Type: EventReplay, ProjectID: projectID, TermID: termID, Payload: base64Data}
}

func (EventFactory) GitUpdate(payload any) Event {
	return Event{Type: EventGitUpdate, Payload: payload}
}

func (EventFactory) FSChange(path, op string) Event {
	return Event{Type: EventFSChange, Payload: map[string]any{"path": path, "op": op}}
}

func (EventFactory) Notification(projectID string, payload any) Event {
	return Event{Type: EventNotification, ProjectID: projectID, Payload: payload}
}

func (EventFactory) Activity(projectID string, payload any) Event {
	return Event{Type: EventActivity, ProjectID: projectID, Payload: payload}
}

func (EventFactory) SessionState(projectID, termID string, running bool, title string) Event {
	return Event{
		Type:      EventSessionState,
		ProjectID: projectID,
		TermID:    termID,
		Payload:   map[string]any{"running": running, "title": title},
	}
}

// AgentState informa el estado detectado de un agente: working | idle | waiting.
func (EventFactory) AgentState(projectID, termID, state string) Event {
	return Event{
		Type:      EventAgentState,
		ProjectID: projectID,
		TermID:    termID,
		Payload:   map[string]any{"state": state},
	}
}

// Events es la instancia global del factory para uso en los adaptadores.
var Events EventFactory

// Command es un mensaje entrante desde un cliente.
type Command struct {
	Client    *Client `json:"-"`
	Type      string  `json:"type"`
	ProjectID string  `json:"projectId"`
	TermID    string  `json:"termId,omitempty"`
	Data      string  `json:"data,omitempty"`
	Cols      uint16  `json:"cols,omitempty"`
	Rows      uint16  `json:"rows,omitempty"`
}

type envelope struct {
	projectID string
	data      []byte
}

type subRequest struct {
	client    *Client
	projectID string
	subscribe bool
}

// Hub gestiona las conexiones WS e implementa domain.EventBus.
type Hub struct {
	log        *slog.Logger
	register   chan *Client
	unregister chan *Client
	outbound   chan envelope
	subs       chan subRequest
	commands   chan Command

	clients       map[*Client]struct{}
	subscriptions map[string]map[*Client]struct{}
}

func New(log *slog.Logger) *Hub {
	return &Hub{
		log:           log,
		register:      make(chan *Client),
		unregister:    make(chan *Client),
		outbound:      make(chan envelope, 256),
		subs:          make(chan subRequest),
		commands:      make(chan Command, 256),
		clients:       make(map[*Client]struct{}),
		subscriptions: make(map[string]map[*Client]struct{}),
	}
}

// Commands expone el canal de comandos para que el composition root los enrute.
func (h *Hub) Commands() <-chan Command { return h.commands }

// Run procesa el ciclo de vida del hub hasta que el contexto se cancele.
func (h *Hub) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			for c := range h.clients {
				c.closeSend()
			}
			return
		case c := <-h.register:
			h.clients[c] = struct{}{}
			h.log.Info("ws client connected", "clients", len(h.clients))
		case c := <-h.unregister:
			h.dropClient(c)
		case req := <-h.subs:
			if req.subscribe {
				set, ok := h.subscriptions[req.projectID]
				if !ok {
					set = make(map[*Client]struct{})
					h.subscriptions[req.projectID] = set
				}
				set[req.client] = struct{}{}
			} else if set, ok := h.subscriptions[req.projectID]; ok {
				delete(set, req.client)
			}
		case env := <-h.outbound:
			targets := h.clients
			if env.projectID != "" {
				targets = h.subscriptions[env.projectID]
			}
			// Recolectamos los clientes lentos y los eliminamos al final: NO se
			// puede usar h.unregister desde aquí (somos su único lector → deadlock).
			var dead []*Client
			for c := range targets {
				select {
				case c.send <- env.data:
				default:
					dead = append(dead, c)
				}
			}
			for _, c := range dead {
				h.dropClient(c)
			}
		}
	}
}

// dropClient elimina un cliente del hub y cierra su canal de envío. DEBE
// invocarse solo desde la goroutine Run (muta el estado sin sincronización).
func (h *Hub) dropClient(c *Client) {
	if _, ok := h.clients[c]; !ok {
		return
	}
	delete(h.clients, c)
	for _, set := range h.subscriptions {
		delete(set, c)
	}
	c.closeSend()
	h.log.Info("ws client disconnected", "clients", len(h.clients))
}

// BroadcastProject implementa domain.EventBus.
func (h *Hub) BroadcastProject(projectID string, evt domain.BusEvent) {
	hubEvt := busEventToHubEvent(evt)
	hubEvt.ProjectID = projectID
	h.send(envelope{projectID: projectID, data: mustMarshal(hubEvt)})
}

// BroadcastGlobal implementa domain.EventBus.
func (h *Hub) BroadcastGlobal(evt domain.BusEvent) {
	h.send(envelope{data: mustMarshal(busEventToHubEvent(evt))})
}

// BroadcastProjectEvent permite emitir hub.Event directamente para mayor eficiencia.
func (h *Hub) BroadcastProjectEvent(projectID string, evt Event) {
	evt.ProjectID = projectID
	h.send(envelope{projectID: projectID, data: mustMarshal(evt)})
}

// BroadcastGlobalEvent emite un hub.Event a todos los clientes.
func (h *Hub) BroadcastGlobalEvent(evt Event) {
	h.send(envelope{data: mustMarshal(evt)})
}

// SendToClient envía un evento directamente a un cliente específico.
func (h *Hub) SendToClient(c *Client, evt Event) {
	c.trySend(mustMarshal(evt))
}

func (h *Hub) send(env envelope) {
	select {
	case h.outbound <- env:
	default:
		h.log.Warn("hub outbound channel full, dropping event")
	}
}

func busEventToHubEvent(evt domain.BusEvent) Event {
	return Event{Type: evt.Type, ProjectID: evt.ProjectID, TermID: evt.TermID, Payload: evt.Payload}
}

func mustMarshal(evt Event) []byte {
	data, err := json.Marshal(evt)
	if err != nil {
		panic("hub: unmarshalable event: " + err.Error())
	}
	return data
}

// ── HTTP upgrade ────────────────────────────────────────────────

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		u, err := url.Parse(origin)
		if err != nil {
			return false
		}
		host := u.Hostname()
		return host == "localhost" || host == "127.0.0.1" || host == "::1" ||
			strings.EqualFold(host, hostnameOf(r.Host))
	},
}

func hostnameOf(hostport string) string {
	if h, _, err := splitHostPort(hostport); err == nil {
		return h
	}
	return hostport
}

func splitHostPort(hostport string) (string, string, error) {
	i := strings.LastIndex(hostport, ":")
	if i < 0 {
		return hostport, "", nil
	}
	return hostport[:i], hostport[i+1:], nil
}

// ServeWS hace upgrade de la petición HTTP y registra el cliente en el hub.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.log.Error("ws upgrade failed", "err", err)
		return
	}
	client := newClient(h, conn)
	h.register <- client

	go client.writePump()
	go client.readPump()
}

// Compile-time check: Hub implementa domain.EventBus.
var _ domain.EventBus = (*Hub)(nil)
