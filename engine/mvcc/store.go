// Package mvcc is the multi-version store and the visibility rules of spec §4.
package mvcc

import (
	"sort"
	"strings"

	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

// Version is one entry of a key's chain. CommitTS 0 means uncommitted.
type Version struct {
	Writer   string
	Value    int64
	Deleted  bool
	CommitTS uint64
}

// Store maps keys to version chains ordered oldest to newest.
type Store struct {
	chains map[string][]Version
	dirty  map[string]bool // keys changed since the last TakeDirty
}

func NewStore() *Store { return &Store{chains: map[string][]Version{}, dirty: map[string]bool{}} }

// Chain returns the key's chain (shared; callers must not modify it).
func (s *Store) Chain(k string) []Version { return s.chains[k] }

// Keys returns every key that has a chain, sorted.
func (s *Store) Keys() []string {
	out := make([]string, 0, len(s.chains))
	for k := range s.chains {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// KeysWithPrefix returns the sorted keys that start with prefix.
func (s *Store) KeysWithPrefix(prefix string) []string {
	var out []string
	for k := range s.chains {
		if strings.HasPrefix(k, prefix) {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

// AppendUncommitted adds an uncommitted version as the new last element.
func (s *Store) AppendUncommitted(k string, v Version) {
	v.CommitTS = 0
	s.dirty[k] = true
	s.chains[k] = append(s.chains[k], v)
}

// OverwriteOwn replaces the last (uncommitted) version.
func (s *Store) OverwriteOwn(k string, value int64, deleted bool) {
	s.dirty[k] = true
	c := s.chains[k]
	c[len(c)-1].Value = value
	c[len(c)-1].Deleted = deleted
}

// Stamp commits the writer's uncommitted version of k.
func (s *Store) Stamp(k, writer string, ts uint64) {
	s.dirty[k] = true
	c := s.chains[k]
	if n := len(c); n > 0 && c[n-1].Writer == writer && c[n-1].CommitTS == 0 {
		c[n-1].CommitTS = ts
	}
}

// RemoveUncommitted deletes the writer's uncommitted version of k.
func (s *Store) RemoveUncommitted(k, writer string) {
	s.dirty[k] = true
	c := s.chains[k]
	if n := len(c); n > 0 && c[n-1].Writer == writer && c[n-1].CommitTS == 0 {
		c = c[:n-1]
		if len(c) == 0 {
			delete(s.chains, k)
		} else {
			s.chains[k] = c
		}
	}
}

// NewestCommitted returns the newest committed version of k.
func (s *Store) NewestCommitted(k string) (Version, bool) {
	c := s.chains[k]
	for i := len(c) - 1; i >= 0; i-- {
		if c[i].CommitTS != 0 {
			return c[i], true
		}
	}
	return Version{}, false
}

// Snapshot returns the store as trace JSON, keys sorted.
func (s *Store) Snapshot() []trace.KeyVersions {
	keys := s.Keys()
	out := make([]trace.KeyVersions, 0, len(keys))
	for _, k := range keys {
		c := s.chains[k]
		vs := make([]trace.VersionJSON, len(c))
		for i, v := range c {
			vs[i] = trace.VersionJSON{Writer: v.Writer, Value: v.Value, Deleted: v.Deleted, CommitTS: v.CommitTS}
		}
		out = append(out, trace.KeyVersions{Key: k, Versions: vs})
	}
	return out
}

// TakeDirty returns, sorted, the keys changed since the previous call and
// resets the set.
func (s *Store) TakeDirty() []string {
	out := make([]string, 0, len(s.dirty))
	for k := range s.dirty {
		out = append(out, k)
	}
	sort.Strings(out)
	s.dirty = map[string]bool{}
	return out
}

// SnapshotKeys returns the chains of the given (sorted) keys. A key with no
// chain is reported with an empty version list, meaning "removed".
func (s *Store) SnapshotKeys(keys []string) []trace.KeyVersions {
	out := make([]trace.KeyVersions, 0, len(keys))
	for _, k := range keys {
		c := s.chains[k]
		vs := make([]trace.VersionJSON, len(c))
		for i, v := range c {
			vs[i] = trace.VersionJSON{Writer: v.Writer, Value: v.Value, Deleted: v.Deleted, CommitTS: v.CommitTS}
		}
		out = append(out, trace.KeyVersions{Key: k, Versions: vs})
	}
	return out
}
