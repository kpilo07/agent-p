// Package domain contiene las entidades puras del bounded context "project".
// Sin dependencias de infraestructura: no hay drivers, ni HTTP, ni SQL.
package domain

import "time"

// Project representa un repositorio git registrado en la herramienta.
type Project struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	CLICommand string    `json:"cliCommand"`
	CreatedAt  time.Time `json:"createdAt"`
}

// Session representa una ejecución del agente en un proyecto.
type Session struct {
	ID        int64      `json:"id"`
	ProjectID string     `json:"projectId"`
	Status    string     `json:"status"` // "running" | "ended"
	StartedAt time.Time  `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
}

// FileStat resume el estado de un archivo dentro del diff de git.
type FileStat struct {
	Path      string `json:"path"`
	Status    string `json:"status"` // M, A, D, R, ?? (untracked)…
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

// GitSnapshot es el estado de git de un proyecto en un instante.
type GitSnapshot struct {
	Diff      string     `json:"diff"`
	Files     []FileStat `json:"files"`
	Additions int        `json:"additions"`
	Deletions int        `json:"deletions"`
	Initial   bool       `json:"initial"` // primera lectura: no notificar
	UpdatedAt time.Time  `json:"updatedAt"`
}

// TermInfo describe una terminal activa para la UI.
type TermInfo struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Running bool   `json:"running"`
}

// AgentTermID identifica la terminal principal (la del agente de IA).
const AgentTermID = "agent"

// TreeNode representa un nodo del árbol de archivos del repositorio.
type TreeNode struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"` // relativo a la raíz del repo, separador '/'
	Dir      bool        `json:"dir"`
	Children []*TreeNode `json:"children,omitempty"`
}

// FileContent contiene el contenido textual de un archivo del repositorio.
type FileContent struct {
	Path      string `json:"path"`
	Content   string `json:"content"`
	Size      int64  `json:"size"`
	Truncated bool   `json:"truncated"`
	Binary    bool   `json:"binary"`
}

// FSEntry describe una entrada en el explorador de directorios.
type FSEntry struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	IsGitRepo bool   `json:"isGitRepo"`
}

// FSListing describe el contenido de un directorio para el explorador.
type FSListing struct {
	Path      string    `json:"path"`
	Parent    string    `json:"parent,omitempty"`
	IsGitRepo bool      `json:"isGitRepo"`
	Entries   []FSEntry `json:"entries"`
}
