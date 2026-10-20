package mvcc

import (
	"testing"

	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

func chain() []Version {
	return []Version{
		{Writer: "T0", Value: 1, CommitTS: 1},
		{Writer: "T2", Value: 2, CommitTS: 3},
		{Writer: "T3", Value: 3}, // uncommitted
	}
}

func TestVisible(t *testing.T) {
	cases := []struct {
		name    string
		chain   []Version
		r       Reader
		stmtTS  uint64
		want    int64
		wantOK  bool
		wantWhy string
	}{
		{"RU sees dirty", chain(), Reader{ID: "T1", Level: trace.RU}, 3, 3, true, trace.VisibleDirty},
		{"RU sees newest committed", chain()[:2], Reader{ID: "T1", Level: trace.RU}, 3, 2, true, trace.VisibleCommittedStmt},
		{"RC skips uncommitted", chain(), Reader{ID: "T1", Level: trace.RC}, 3, 2, true, trace.VisibleCommittedStmt},
		{"RC statement time bounds", chain(), Reader{ID: "T1", Level: trace.RC}, 2, 1, true, trace.VisibleCommittedStmt},
		{"SI snapshot", chain(), Reader{ID: "T1", Level: trace.SI, SnapshotTS: 1}, 9, 1, true, trace.VisibleCommittedSnap},
		{"SI later snapshot", chain(), Reader{ID: "T1", Level: trace.SER, SnapshotTS: 3}, 9, 2, true, trace.VisibleCommittedSnap},
		{"own write wins at SI", chain(), Reader{ID: "T3", Level: trace.SI, SnapshotTS: 1}, 9, 3, true, trace.VisibleOwnWrite},
		{"own write wins at RC", chain(), Reader{ID: "T3", Level: trace.RC}, 9, 3, true, trace.VisibleOwnWrite},
		{"empty chain", nil, Reader{ID: "T1", Level: trace.RC}, 9, 0, false, trace.Absent},
		{"nothing before snapshot", []Version{{Writer: "T2", Value: 5, CommitTS: 4}}, Reader{ID: "T1", Level: trace.SI, SnapshotTS: 2}, 9, 0, false, trace.Absent},
		{"tombstone is absent", []Version{{Writer: "T0", Value: 1, CommitTS: 1}, {Writer: "T2", Deleted: true, CommitTS: 2}}, Reader{ID: "T1", Level: trace.RC}, 9, 0, false, trace.Absent},
		{"own tombstone is absent", []Version{{Writer: "T1", Deleted: true}}, Reader{ID: "T1", Level: trace.RC}, 9, 0, false, trace.Absent},
	}
	for _, c := range cases {
		v, ok, why := Visible(c.chain, c.r, c.stmtTS)
		if ok != c.wantOK || why != c.wantWhy || (ok && v.Value != c.want) {
			t.Errorf("%s: got (%d,%v,%s) want (%d,%v,%s)", c.name, v.Value, ok, why, c.want, c.wantOK, c.wantWhy)
		}
	}
}

func TestHiddenVersions(t *testing.T) {
	h := HiddenVersions(chain(), Reader{ID: "T1", Level: trace.SI, SnapshotTS: 1})
	if len(h) != 2 || h[0].Why != trace.InvisibleNewerSnapshot || h[1].Why != trace.InvisibleUncommittedOth {
		t.Fatalf("%+v", h)
	}
	if h := HiddenVersions(chain(), Reader{ID: "T1", Level: trace.RU}); len(h) != 0 {
		t.Fatalf("RU hides nothing: %+v", h)
	}
	if h := HiddenVersions(chain(), Reader{ID: "T3", Level: trace.RC}); len(h) != 0 {
		t.Fatalf("own write is never hidden: %+v", h)
	}
}

func TestStoreLifecycle(t *testing.T) {
	s := NewStore()
	s.AppendUncommitted("a:1", Version{Writer: "T1", Value: 5})
	s.AppendUncommitted("a:2", Version{Writer: "T1", Value: 6})
	s.AppendUncommitted("b", Version{Writer: "T1", Value: 7})
	s.OverwriteOwn("a:1", 9, false)
	s.Stamp("a:1", "T1", 4)
	s.RemoveUncommitted("a:2", "T1")
	if v, ok := s.NewestCommitted("a:1"); !ok || v.Value != 9 || v.CommitTS != 4 {
		t.Fatalf("%+v %v", v, ok)
	}
	if len(s.Chain("a:2")) != 0 {
		t.Fatal("a:2 should be gone")
	}
	if _, ok := s.NewestCommitted("b"); ok {
		t.Fatal("b is uncommitted")
	}
	// RemoveUncommitted must not touch a committed version or another writer's.
	s.RemoveUncommitted("a:1", "T1")
	s.RemoveUncommitted("b", "T9")
	if len(s.Chain("a:1")) != 1 || len(s.Chain("b")) != 1 {
		t.Fatal("removed something it should not have")
	}
	if got := s.KeysWithPrefix("a:"); len(got) != 1 || got[0] != "a:1" {
		t.Fatalf("%v", got)
	}
	if got := s.Keys(); len(got) != 2 || got[0] != "a:1" || got[1] != "b" {
		t.Fatalf("%v", got)
	}
	snap := s.Snapshot()
	if len(snap) != 2 || snap[0].Key != "a:1" || snap[0].Versions[0].CommitTS != 4 {
		t.Fatalf("%+v", snap)
	}
}
