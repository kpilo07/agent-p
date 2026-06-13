package domain

import "errors"

var (
	// ErrNotFound se devuelve cuando un recurso no existe en el repositorio.
	ErrNotFound = errors.New("domain: not found")

	// ErrAlreadyRunning se devuelve al intentar arrancar un proceso ya activo.
	ErrAlreadyRunning = errors.New("domain: already running")

	// ErrNotRunning se devuelve al operar sobre un proceso que no está activo.
	ErrNotRunning = errors.New("domain: not running")
)
