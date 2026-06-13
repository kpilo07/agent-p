package hub

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"testing"
	"time"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// newTestClient crea un Client sin conexión WebSocket real. El loop del hub
// solo toca c.send y c.closeSend, nunca c.conn, así que esto es seguro.
func newTestClient(h *Hub) *Client {
	return &Client{hub: h, send: make(chan []byte, sendBuffer)}
}

// TestHubSlowClientDoesNotBlock es el test de regresión del deadlock: un
// cliente que no drena su buffer NO debe congelar el hub. Antes del fix, el
// loop de Run llamaba a trySend, que al llenarse el buffer hacía
// `h.unregister <- c` — pero Run es el único lector de unregister, así que se
// bloqueaba a sí mismo y se paraban TODOS los websockets.
func TestHubSlowClientDoesNotBlock(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	h := New(testLogger())
	go h.Run(ctx)

	// Cliente lento: registrado pero nunca drena su canal → se llenará.
	slow := newTestClient(h)
	h.register <- slow

	// Cliente rápido: lo drenamos en el propio test.
	fast := newTestClient(h)
	h.register <- fast

	// Inundamos con broadcasts globales en segundo plano.
	go func() {
		evt := Events.Notification("p1", map[string]any{"n": 1})
		for {
			select {
			case <-ctx.Done():
				return
			default:
				h.BroadcastGlobalEvent(evt)
				time.Sleep(500 * time.Microsecond)
			}
		}
	}()

	// Si el hub sigue vivo, el cliente rápido recibe mensajes de forma
	// sostenida aunque el lento se haya saturado y haya sido expulsado.
	const want = 300
	deadline := time.After(5 * time.Second)
	got := 0
	for got < want {
		select {
		case <-fast.send:
			got++
		case <-deadline:
			t.Fatalf("hub bloqueado: el cliente rápido solo recibió %d/%d mensajes "+
				"(probable deadlock por cliente lento)", got, want)
		}
	}
}

// TestHubDropClientRemovesFromSubscriptions verifica que al expulsar un cliente
// se elimina también de todas las suscripciones por proyecto.
func TestHubDropClientRemovesFromSubscriptions(t *testing.T) {
	h := New(testLogger())
	c := newTestClient(h)

	h.clients[c] = struct{}{}
	h.subscriptions["p1"] = map[*Client]struct{}{c: {}}
	h.subscriptions["p2"] = map[*Client]struct{}{c: {}}

	h.dropClient(c)

	if _, ok := h.clients[c]; ok {
		t.Error("el cliente sigue en h.clients tras dropClient")
	}
	if _, ok := h.subscriptions["p1"][c]; ok {
		t.Error("el cliente sigue suscrito a p1 tras dropClient")
	}
	if _, ok := h.subscriptions["p2"][c]; ok {
		t.Error("el cliente sigue suscrito a p2 tras dropClient")
	}
}

func TestCheckOrigin(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		host   string // valor de r.Host
		want   bool
	}{
		{"sin origin (cliente no-navegador)", "", "127.0.0.1:8089", true},
		{"localhost", "http://localhost:8089", "127.0.0.1:8089", true},
		{"127.0.0.1", "http://127.0.0.1:8089", "127.0.0.1:8089", true},
		{"ipv6 loopback", "http://[::1]:8089", "127.0.0.1:8089", true},
		{"mismo host que el server", "http://miquina:8089", "miquina:8089", true},
		{"origin externo (DNS-rebinding)", "http://evil.example.com", "127.0.0.1:8089", false},
		{"origin malformado", "http://%zz", "127.0.0.1:8089", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := &http.Request{Header: http.Header{}, Host: tt.host}
			if tt.origin != "" {
				r.Header.Set("Origin", tt.origin)
			}
			if got := upgrader.CheckOrigin(r); got != tt.want {
				t.Errorf("CheckOrigin(origin=%q, host=%q) = %v, want %v",
					tt.origin, tt.host, got, tt.want)
			}
		})
	}
}
