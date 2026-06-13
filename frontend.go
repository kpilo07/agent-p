// Package agentspa expone el frontend embebido (web/dist) para que cmd/api
// pueda importarlo. Separado de main porque go:embed no admite rutas con '..'.
package agentspa

import "embed"

//go:embed all:web/dist
var Frontend embed.FS
