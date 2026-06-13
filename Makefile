# agent-p — binario único Go + React embebido
BINARY     := agent-p
CMD        := ./cmd/api
GO         ?= $(shell command -v go 2>/dev/null || echo $(HOME)/.local/go/bin/go)

.PHONY: all web build dev-backend dev-frontend lint test clean

all: build

## Compila el frontend (web/dist) — requisito previo del embed.
web:
	cd web && pnpm install && pnpm build

## Compila el binario final con el frontend embebido. SIN CGO.
build: web
	CGO_ENABLED=0 $(GO) build -trimpath -ldflags="-s -w" -o $(BINARY) $(CMD)

## Backend en caliente (sirve el último build de web/dist).
dev-backend:
	CGO_ENABLED=0 $(GO) run $(CMD) -addr 127.0.0.1:8089

## Frontend con HMR (proxy /api y /ws hacia :8089).
dev-frontend:
	cd web && pnpm dev

## Chequeo estático de todo el backend.
lint:
	$(GO) vet ./...

## Tests del backend.
test:
	CGO_ENABLED=0 $(GO) test ./...

clean:
	rm -f $(BINARY)
	rm -rf web/dist
