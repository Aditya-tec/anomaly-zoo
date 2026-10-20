package mvcc

import "github.com/Aditya-tec/anomaly-zoo/engine/trace"

// Reader describes who is reading.
type Reader struct {
	ID         string
	Level      trace.Level
	SnapshotTS uint64 // SI and SER only
}

// Hidden is a version the reader cannot see, with the reason.
type Hidden struct {
	Version Version
	Why     string
}

// Visible implements the pseudocode of spec §4.4. ok is false when nothing is
// visible (absent or deleted). why explains the outcome: for a visible
// version the visible_* code, otherwise "absent".
func Visible(chain []Version, r Reader, stmtTS uint64) (v Version, ok bool, why string) {
	if len(chain) == 0 {
		return Version{}, false, trace.Absent
	}
	last := chain[len(chain)-1]
	switch {
	case last.Writer == r.ID && last.CommitTS == 0:
		v, why = last, trace.VisibleOwnWrite
	case r.Level == trace.RU:
		v = last
		if last.CommitTS == 0 {
			why = trace.VisibleDirty
		} else {
			why = trace.VisibleCommittedStmt
		}
	default:
		limit, reason := stmtTS, trace.VisibleCommittedStmt
		if r.Level == trace.SI || r.Level == trace.SER {
			limit, reason = r.SnapshotTS, trace.VisibleCommittedSnap
		}
		found := false
		for i := len(chain) - 1; i >= 0; i-- {
			if chain[i].CommitTS != 0 && chain[i].CommitTS <= limit {
				v, found = chain[i], true
				break
			}
		}
		if !found {
			return Version{}, false, trace.Absent
		}
		why = reason
	}
	if v.Deleted {
		return Version{}, false, trace.Absent
	}
	return v, true, why
}

// HiddenVersions lists, oldest first, the versions of a chain that the reader
// cannot see because of another transaction: its uncommitted writes (except
// at RU) and, for snapshot levels, versions committed after the snapshot. The
// reader's own uncommitted version is never hidden.
func HiddenVersions(chain []Version, r Reader) []Hidden {
	var out []Hidden
	for _, c := range chain {
		switch {
		case c.Writer == r.ID && c.CommitTS == 0:
		case c.CommitTS == 0:
			if r.Level != trace.RU {
				out = append(out, Hidden{c, trace.InvisibleUncommittedOth})
			}
		case (r.Level == trace.SI || r.Level == trace.SER) && c.CommitTS > r.SnapshotTS:
			out = append(out, Hidden{c, trace.InvisibleNewerSnapshot})
		}
	}
	return out
}
