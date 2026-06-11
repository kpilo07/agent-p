# agent-p — binario único Go + React embebido
BINARY  := agent-p
# Usa el go del PATH; si no existe, cae al instalado en ~/.local/go.
GO      ?= $(shell command -v go 2>/dev/null || echo $(HOME)/.local/go/bin/go)

.PHONY: all web build dev-backend dev-frontend clean

all: build

## Compila el frontend (web/dist) — requisito previo del embed.
web:
	cd web && pnpm install && pnpm build

## Compila el binario final con el frontend embebido. SIN CGO.
build: web
	CGO_ENABLED=0 $(GO) build -trimpath -ldflags="-s -w" -o $(BINARY) .

## Backend en caliente (sirve el último build de web/dist).
dev-backend:
	CGO_ENABLED=0 $(GO) run . -addr 127.0.0.1:8089

## Frontend con HMR (proxy /api y /ws hacia :8089).
dev-frontend:
	cd web && pnpm dev

clean:
	rm -f $(BINARY)
	rm -rf web/dist
