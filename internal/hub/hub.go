// Package hub implementa un Hub centralizado de WebSockets capaz de gestionar
// múltiples conexiones de UI y múltiples proyectos concurrentes.
//
// Modelo:
//   - Cada cliente (pestaña del navegador) mantiene UNA conexión WS.
//   - Un cliente se "suscribe" (attach) al stream de terminal de un proyecto.
//   - Los eventos de proyecto (salida de PTY, git diff) se enrutan solo a los
//     suscriptores de ese proyecto.
//   - Los eventos globales (notificaciones de proyectos en segundo plano,
//     cambios de estado) se difunden a TODOS los clientes conectados.
//
// El estado interno (clients/subs) es propiedad exclusiva de la goroutine
// Run(); toda mutación viaja por canales, por lo que no se necesitan mutexes.
package hub

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/gorilla/websocket"
)

// Tipos de eventos salientes (backend → UI).
const (
	EventOutput       = "output"        // datos de la terminal (base64)
	EventReplay       = "replay"        // buffer histórico al hacer attach
	EventGitUpdate    = "git_update"    // snapshot de git diff de un proyecto
	EventFSChange     = "fs_change"     // un archivo del proyecto cambió en disco
	EventNotification = "notification"  // alerta global (toast en la UI)
	EventSessionState = "session_state" // un PTY arrancó o terminó
)

// Tipos de comandos entrantes (UI → backend).
const (
	CmdAttach = "attach"
	CmdDetach = "detach"
	CmdInput  = "input"
	CmdResize = "resize"
	// Suscripción a los eventos del proyecto (git_update, fs_change…) SIN
	// terminal de por medio: la usa la UI cuando la consola no está montada
	// (Modo Mapa Táctico).
	CmdSubscribe   = "subscribe"
	CmdUnsubscribe = "unsubscribe"
)

// Event es un mensaje saliente hacia la UI.
type Event struct {
	Type      string `json:"type"`
	ProjectID string `json:"projectId,omitempty"`
	TermID    string `json:"termId,omitempty"` // terminal concreta del proyecto
	Payload   any    `json:"payload,omitempty"`
}

// Command es un mensaje entrante desde un cliente.
type Command struct {
	Client    *Client `json:"-"`
	Type      string  `json:"type"`
	ProjectID string  `json:"projectId"`
	TermID    string  `json:"termId,omitempty"`
	Data      string  `json:"data,omitempty"` // input: texto / output: base64
	Cols      uint16  `json:"cols,omitempty"`
	Rows      uint16  `json:"rows,omitempty"`
}

type envelope struct {
	projectID string // "" = broadcast global
	data      []byte
}

type subRequest struct {
	client    *Client
	projectID string
	subscribe bool
}

type Hub struct {
	log        *slog.Logger
	register   chan *Client
	unregister chan *Client
	outbound   chan envelope
	subs       chan subRequest
	commands   chan Command

	// Estado propiedad exclusiva de Run().
	clients       map[*Client]struct{}
	subscriptions map[string]map[*Client]struct{} // projectID → suscriptores
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

// Commands expone el flujo de comandos de clientes (input/resize/attach) para
// que la capa de orquestación los enrute al gestor de PTYs.
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
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				for _, set := range h.subscriptions {
					delete(set, c)
				}
				c.closeSend()
				h.log.Info("ws client disconnected", "clients", len(h.clients))
			}

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
			if env.projectID == "" {
				for c := range h.clients {
					c.trySend(env.data)
				}
			} else {
				for c := range h.subscriptions[env.projectID] {
					c.trySend(env.data)
				}
			}
		}
	}
}

// BroadcastProject envía un evento solo a los clientes suscritos al proyecto.
func (h *Hub) BroadcastProject(projectID string, evt Event) {
	evt.ProjectID = projectID
	h.send(envelope{projectID: projectID, data: mustMarshal(evt)})
}

// BroadcastGlobal envía un evento a todos los clientes conectados.
// Úsalo para notificaciones de proyectos en segundo plano.
func (h *Hub) BroadcastGlobal(evt Event) {
	h.send(envelope{data: mustMarshal(evt)})
}

func (h *Hub) send(env envelope) {
	select {
	case h.outbound <- env:
	default:
		h.log.Warn("hub outbound channel full, dropping event")
	}
}

func mustMarshal(evt Event) []byte {
	data, err := json.Marshal(evt)
	if err != nil {
		// Solo posible con payloads no serializables: bug de programación.
		panic("hub: unmarshalable event: " + err.Error())
	}
	return data
}

// ── HTTP upgrade ────────────────────────────────────────────────

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// Esta herramienta expone PTYs: solo aceptamos conexiones cuyo Origin sea
	// local. Evita que una web maliciosa abra ws://localhost y ejecute comandos.
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true // clientes no-navegador (curl, wscat)
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
