package api

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func decode(t *testing.T, s string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatalf("response is not JSON: %v\n%s", err, s)
	}
	return m
}

func src(t *testing.T, id string) string {
	b, err := os.ReadFile("../../scenarios/" + id + ".azs")
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestParse(t *testing.T) {
	m := decode(t, ParseJSON(src(t, "write-skew")))
	if m["ok"] != true {
		t.Fatalf("%v", m)
	}
	sc := m["scenario"].(map[string]any)
	if sc["id"] != "write-skew" || len(sc["steps"].([]any)) != 10 {
		t.Fatalf("%v", sc)
	}
}

func TestParseErrorsAreData(t *testing.T) {
	m := decode(t, ParseJSON("scenario x\nschedule:\n  T1 BEGIN\n  T1 FROB\n"))
	errs := m["errors"].([]any)
	if m["ok"] != false || len(errs) == 0 {
		t.Fatalf("%v", m)
	}
	e := errs[0].(map[string]any)
	if e["line"].(float64) != 4 || e["col"].(float64) < 1 || e["message"] == "" {
		t.Fatalf("%v", e)
	}
}

func TestRunAndRunAll(t *testing.T) {
	s := src(t, "lost-update")
	m := decode(t, RunJSON(s, "SI"))
	tr := m["trace"].(map[string]any)
	if m["ok"] != true || tr["level"] != "SI" || tr["digest"] == "" {
		t.Fatalf("%v", m)
	}
	all := decode(t, RunAllJSON(s))["traces"].(map[string]any)
	if len(all) != 4 || all["SI"].(map[string]any)["digest"] != tr["digest"] {
		t.Fatalf("%v", all)
	}
}

func TestBadInputNeverThrows(t *testing.T) {
	for name, out := range map[string]string{
		"bad level":  RunJSON(src(t, "phantom"), "XX"),
		"empty":      RunJSON("", "RC"),
		"too big":    RunAllJSON(strings.Repeat("#", 9000)),
		"binary":     ParseJSON("\x00\xff\xfe"),
		"run errors": RunAllJSON("scenario x\n"),
	} {
		if m := decode(t, out); m["ok"] != false || len(m["errors"].([]any)) == 0 {
			t.Errorf("%s: %v", name, m)
		}
	}
}

func TestVersion(t *testing.T) {
	if Version() == "" {
		t.Fatal("empty version")
	}
}
