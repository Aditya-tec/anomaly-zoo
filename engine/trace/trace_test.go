package trace

import (
	"strings"
	"testing"
)

func sample() *Trace {
	return &Trace{
		SchemaVersion: SchemaVersion, EngineVersion: EngineVersion,
		Scenario: ScenarioInfo{ID: "x", Invariants: []InvDecl{}}, Level: SI,
		Setup: []KV{}, Steps: []Event{}, Txns: []TxnSummary{}, FinalState: []KV{}, Invariants: []InvResult{},
	}
}

func TestSealedTraceValidates(t *testing.T) {
	b, err := sample().Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateJSON(b); err != nil {
		t.Fatal(err)
	}
}

func TestCanonicalSortsKeysAndIsCompact(t *testing.T) {
	b, _ := sample().Marshal()
	s := string(b)
	if strings.ContainsAny(s, " \n\t") {
		t.Fatalf("whitespace in canonical JSON: %s", s)
	}
	if !strings.HasPrefix(s, `{"digest":`) {
		t.Fatalf("keys not sorted: %s", s[:40])
	}
}

func TestDigestIgnoresDigestField(t *testing.T) {
	a := sample()
	d1, _ := ComputeDigest(a)
	a.Digest = "junk"
	d2, _ := ComputeDigest(a)
	if d1 != d2 {
		t.Fatal("digest depends on the digest field")
	}
	a.Level = RC
	if d3, _ := ComputeDigest(a); d3 == d1 {
		t.Fatal("digest ignores content")
	}
}

func TestSchemaRejectsBadDocuments(t *testing.T) {
	good, _ := sample().Marshal()
	bad := map[string]string{
		"bad level":       strings.Replace(string(good), `"level":"SI"`, `"level":"XX"`, 1),
		"extra property":  strings.Replace(string(good), `{"digest"`, `{"bogus":1,"digest"`, 1),
		"wrong version":   strings.Replace(string(good), `"schemaVersion":1`, `"schemaVersion":2`, 1),
		"float for int":   strings.Replace(string(good), `"schemaVersion":1`, `"schemaVersion":1.5`, 1),
		"missing digest":  `{"schemaVersion":1}`,
		"not json":        `{`,
		"string for bool": strings.Replace(string(good), `"verdict":false`, `"verdict":"no"`, 1),
	}
	for name, doc := range bad {
		if err := ValidateJSON([]byte(doc)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
