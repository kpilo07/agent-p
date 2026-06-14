# agent-p — binario único Go + React embebido
BINARY     := agent-p
CMD        := ./cmd/api
GO         ?= $(shell command -v go 2>/dev/null || echo $(HOME)/.local/go/bin/go)

# Metadatos de build, inyectados en main vía -ldflags. En las releases los fija
# GoReleaser; aquí se derivan de git para builds locales.
VERSION    ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT     ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo none)
DATE       ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS    := -s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT) -X main.date=$(DATE)

.PHONY: all web build dev-backend dev-frontend lint test test-race release-check clean

all: build

## Compila el frontend (web/dist) — requisito previo del embed.
web:
	cd web && pnpm install && pnpm build

## Compila el binario final con el frontend embebido. SIN CGO.
build: web
	CGO_ENABLED=0 $(GO) build -trimpath -ldflags="$(LDFLAGS)" -o $(BINARY) $(CMD)

## Backend en caliente (sirve el último build de web/dist).
dev-backend:
	CGO_ENABLED=0 $(GO) run $(CMD) -addr 127.0.0.1:8089

## Frontend con HMR (proxy /api y /ws hacia :8089).
dev-frontend:
	cd web && pnpm dev

## Chequeo estático de todo el backend.
lint:
	$(GO) vet ./...

## Tests del backend (rápido, sin CGO).
test:
	CGO_ENABLED=0 $(GO) test ./...

## Tests con el detector de carreras (requiere CGO, p.ej. el deadlock del hub).
test-race:
	CGO_ENABLED=1 $(GO) test -race -count=1 ./...

## Dry-run de release con GoReleaser (sin publicar): valida config y compila
## todos los targets en ./dist. Requiere `goreleaser` instalado.
release-check:
	goreleaser release --snapshot --clean --skip=publish

clean:
	rm -f $(BINARY)
	rm -rf web/dist dist
