package conformance

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

// siLocks returns the SIREAD locks the current backend holds, as "type(relation)" strings.
func siLocks(ctx context.Context, c *pgx.Conn) ([]string, error) {
	rows, err := c.Query(ctx, `SELECT locktype, coalesce(relation::regclass::text, '') FROM pg_locks WHERE mode = 'SIReadLock' AND pid = pg_backend_pid()`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var t, rel string
		if err := rows.Scan(&t, &rel); err != nil {
			return nil, err
		}
		out = append(out, fmt.Sprintf("%s(%s)", t, rel))
	}
	sort.Strings(out)
	return out, rows.Err()
}

// TestSIReadLockGranularity is the evidence behind the documented SER
// divergence "PostgreSQL's predicate locks are coarser than keys": after a
// point read of one key, the backend holds a page-level SIREAD lock on the
// primary-key index, so a write to any other key on that page conflicts with
// the read. A prefix scan holds the same page lock (it takes no relation-level
// lock here).
func TestSIReadLockGranularity(t *testing.T) {
	dsn := os.Getenv("CONFORMANCE_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("AZOO_REQUIRE_DB") != "" {
			t.Fatal("AZOO_REQUIRE_DB is set but CONFORMANCE_DATABASE_URL is not")
		}
		t.Skip("CONFORMANCE_DATABASE_URL not set")
	}
	ctx := context.Background()
	r, err := NewRunner(ctx, dsn, "az_siread")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close(ctx)
	for _, k := range []string{"a", "c", "p:1"} {
		if _, err := r.admin.Exec(ctx, sqlUpsert, k, 1); err != nil {
			t.Fatal(err)
		}
	}
	c, err := pgx.ConnectConfig(ctx, r.cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close(ctx)

	if _, err := c.Exec(ctx, `BEGIN ISOLATION LEVEL SERIALIZABLE`); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Exec(ctx, sqlRead, "a"); err != nil {
		t.Fatal(err)
	}
	point, err := siLocks(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Exec(ctx, `SELECT k, v FROM kv WHERE starts_with(k, $1) ORDER BY k`, "p:"); err != nil {
		t.Fatal(err)
	}
	scan, err := siLocks(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Exec(ctx, `ROLLBACK`); err != nil {
		t.Fatal(err)
	}
	t.Logf("SIREAD locks after READ a: %v", point)
	t.Logf("SIREAD locks after SCAN p: %v", scan)

	has := func(locks []string, prefix string) bool {
		for _, l := range locks {
			if strings.HasPrefix(l, prefix) {
				return true
			}
		}
		return false
	}
	if !has(point, "page(") {
		t.Errorf("expected a page-level SIREAD lock after a point read, got %v", point)
	}
	if !has(scan, "page(") {
		t.Errorf("expected a page-level SIREAD lock after a prefix scan, got %v", scan)
	}
}
