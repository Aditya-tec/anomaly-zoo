package conformance

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// TestPostgresSelect1 is AC0.5: the CI service container accepts a SELECT 1
// from this module. Locally it skips when CONFORMANCE_DATABASE_URL is unset;
// in CI AZOO_REQUIRE_DB=1 turns a missing database into a failure so the job
// cannot pass without actually talking to Postgres.
func TestPostgresSelect1(t *testing.T) {
	url := os.Getenv("CONFORMANCE_DATABASE_URL")
	if url == "" {
		if os.Getenv("AZOO_REQUIRE_DB") != "" {
			t.Fatal("AZOO_REQUIRE_DB is set but CONFORMANCE_DATABASE_URL is empty")
		}
		t.Skip("CONFORMANCE_DATABASE_URL not set; skipping (CI sets it)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	var one int
	if err := conn.QueryRow(ctx, "SELECT 1").Scan(&one); err != nil {
		t.Fatalf("SELECT 1: %v", err)
	}
	if one != 1 {
		t.Fatalf("SELECT 1 returned %d", one)
	}
	var version string
	if err := conn.QueryRow(ctx, "SHOW server_version").Scan(&version); err != nil {
		t.Fatalf("SHOW server_version: %v", err)
	}
	t.Logf("PostgreSQL server_version %s", version)
}
