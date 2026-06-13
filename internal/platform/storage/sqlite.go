// Package storage provee la factoría de conexión SQLite reutilizable por
// cualquier bounded context que necesite persistencia. Configura WAL mode y
// foreign keys por defecto.
package storage

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// OpenSQLite abre (o crea) un fichero SQLite y devuelve la conexión configurada
// para un único escritor concurrente con WAL mode para máxima concurrencia de lectores.
func OpenSQLite(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf(
		"file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)",
		path,
	)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("storage: open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	return db, nil
}
