package hub

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 64 * 1024
	sendBuffer     = 256
)

// Client representa una conexión WebSocket de la UI.
type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte

	closeOnce sync.Once
}

func newClient(h *Hub, conn *websocket.Conn) *Client {
	return &Client{hub: h, conn: conn, send: make(chan []byte, sendBuffer)}
}

// Send envía un evento directamente a ESTE cliente (p.ej. el replay del
// buffer de terminal tras un attach). Seguro desde cualquier goroutine.
func (c *Client) Send(evt Event) {
	c.trySend(mustMarshal(evt))
}

// trySend encola sin bloquear; un cliente lento no puede frenar al hub.
func (c *Client) trySend(data []byte) {
	select {
	case c.send <- data:
	default:
		// Buffer lleno: cliente colgado o demasiado lento. Lo desconectamos
		// para no acumular memoria; el frontend reconecta automáticamente.
		c.hub.unregister <- c
	}
}

func (c *Client) closeSend() {
	c.closeOnce.Do(func() { close(c.send) })
}

// readPump consume mensajes del navegador: gestiona attach/detach contra el
// hub y reenvía el resto de comandos (input/resize) a la capa de orquestación.
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		var cmd Command
		if err := json.Unmarshal(raw, &cmd); err != nil {
			c.hub.log.Warn("ws: invalid client message", "err", err)
			continue
		}
		cmd.Client = c

		switch cmd.Type {
		case CmdAttach, CmdSubscribe:
			c.hub.subs <- subRequest{client: c, projectID: cmd.ProjectID, subscribe: true}
		case CmdDetach, CmdUnsubscribe:
			c.hub.subs <- subRequest{client: c, projectID: cmd.ProjectID, subscribe: false}
		}

		// Solo los comandos de terminal viajan a la orquestación (attach
		// también: responde con el replay del buffer). subscribe/unsubscribe
		// se agotan en el hub.
		switch cmd.Type {
		case CmdAttach, CmdInput, CmdResize:
			select {
			case c.hub.commands <- cmd:
			default:
				c.hub.log.Warn("hub command channel full, dropping command", "type", cmd.Type)
			}
		}
	}
}

// writePump serializa todas las escrituras a la conexión y mantiene el
// keep-alive con pings periódicos.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
