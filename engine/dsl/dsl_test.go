package dsl

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const minimal = `scenario t
schedule:
  T1 BEGIN
  T1 COMMIT
`

func mustParse(t *testing.T, src string) *Scenario {
	t.Helper()
	sc, errs := Parse(src)
	if len(errs) > 0 {
		t.Fatalf("unexpected errors: %v\n%s", errs, src)
	}
	return sc
}

func firstErr(t *testing.T, src string) Error {
	t.Helper()
	sc, errs := Parse(src)
	if sc != nil || len(errs) == 0 {
		t.Fatalf("expected an error for:\n%s", src)
	}
	return errs[0]
}

func TestCannedScenariosParseAndRoundTrip(t *testing.T) {
	files, err := filepath.Glob("../../scenarios/*.azs")
	if err != nil || len(files) != 8 {
		t.Fatalf("want 8 scenarios, got %d (%v)", len(files), err)
	}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		sc := mustParse(t, string(b))
		out := Format(sc)
		sc2 := mustParse(t, out)
		if Format(sc2) != out {
			t.Errorf("%s: Format is not idempotent", f)
		}
	}
}

func TestCRLFCopiesFormatIdentically(t *testing.T) {
	files, _ := filepath.Glob("../../scenarios/*.azs")
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		lf := strings.ReplaceAll(string(b), "\r\n", "\n")
		crlf := strings.ReplaceAll(lf, "\n", "\r\n")
		if Format(mustParse(t, lf)) != Format(mustParse(t, crlf)) {
			t.Errorf("%s: CRLF and LF formats differ", f)
		}
		if strings.Contains(Format(mustParse(t, crlf)), "\r") {
			t.Errorf("%s: Format emitted \\r", f)
		}
	}
}

func TestSubtractionNeedsSpaces(t *testing.T) {
	e := firstErr(t, "scenario t\nschedule:\n  T1 BEGIN\n  T1 READ k AS a\n  T1 PUT k = a-1\n  T1 COMMIT\n")
	if !strings.Contains(e.Message, "a - 1") {
		t.Fatalf("hint missing: %s", e.Message)
	}
	e = firstErr(t, "scenario t\ninvariant \"i\": 1-a == 0\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n")
	if e.Message == "" {
		t.Fatal("no message")
	}
}

func TestMinimal(t *testing.T) {
	sc := mustParse(t, minimal)
	if sc.ID != "t" || len(sc.Steps) != 2 {
		t.Fatalf("bad parse: %+v", sc)
	}
}

func TestCommentsAndBlankLines(t *testing.T) {
	mustParse(t, "# hi\n\nscenario t # trailing\nschedule:\n  T1 BEGIN # x\n\n  T1 COMMIT\n")
}

func TestCRLF(t *testing.T) {
	mustParse(t, strings.ReplaceAll(minimal, "\n", "\r\n"))
}

func TestErrorPositions(t *testing.T) {
	e := firstErr(t, "scenario t\nschedule:\n  T1 BEGIN\n  T1 READ k$ AS x\n  T1 COMMIT\n")
	if e.Line != 4 || e.Col == 0 {
		t.Fatalf("bad position: %+v", e)
	}
}

func TestValidationRules(t *testing.T) {
	cases := map[string]string{
		"first step not BEGIN":  "scenario t\nschedule:\n  T1 READ k AS x\n  T1 COMMIT\n",
		"never ends":            "scenario t\nschedule:\n  T1 BEGIN\n",
		"step after end":        "scenario t\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n  T1 ABORT\n",
		"double begin":          "scenario t\nschedule:\n  T1 BEGIN\n  T1 BEGIN\n  T1 COMMIT\n",
		"empty schedule":        "scenario t\nschedule:\n",
		"missing schedule":      "scenario t\n",
		"rebinding":             "scenario t\nschedule:\n  T1 BEGIN\n  T1 READ k AS x\n  T1 READ j AS x\n  T1 COMMIT\n",
		"unbound var in put":    "scenario t\nschedule:\n  T1 BEGIN\n  T1 PUT k = x + 1\n  T1 COMMIT\n",
		"other txn var in put":  "scenario t\nschedule:\n  T1 BEGIN\n  T2 BEGIN\n  T1 READ k AS x\n  T2 PUT k = x\n  T1 COMMIT\n  T2 COMMIT\n",
		"invariant unknown var": "scenario t\ninvariant \"i\": zz == 1\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n",
		"invariant unknown txn": "scenario t\ninvariant \"i\": committed(T2) == 1\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n",
		"bad txn":               "scenario t\nschedule:\n  T7 BEGIN\n",
		"bad key uppercase":     "scenario t\nschedule:\n  T1 BEGIN\n  T1 DELETE Key\n  T1 COMMIT\n",
		"key too long":          "scenario t\nschedule:\n  T1 BEGIN\n  T1 DELETE " + strings.Repeat("a", 33) + "\n  T1 COMMIT\n",
		"id too long":           "scenario t\nschedule:\n  T1 BEGIN\n  T1 READ k AS " + strings.Repeat("a", 17) + "\n  T1 COMMIT\n",
		"reserved id":           "scenario t\nschedule:\n  T1 BEGIN\n  T1 READ k AS count\n  T1 COMMIT\n",
		"int out of range":      "scenario t\nsetup:\n  PUT k = 1000000001\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n",
		"duplicate setup":       "scenario t\nsetup:\n  PUT k = 1\n  PUT k = 2\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n",
		"final in put":          "scenario t\nschedule:\n  T1 BEGIN\n  T1 PUT k = final.val(\"k\")\n  T1 COMMIT\n",
		"unterminated string":   "scenario t\nschedule:\n  T1 BEGIN\n  T1 NOTE \"abc\n  T1 COMMIT\n",
		"unknown op":            "scenario t\nschedule:\n  T1 BEGIN\n  T1 FROB k\n  T1 COMMIT\n",
		"trailing tokens":       "scenario t\nschedule:\n  T1 BEGIN extra\n  T1 COMMIT\n",
		"lowercase keyword":     "scenario t\nschedule:\n  T1 begin\n  T1 COMMIT\n",
		"title after setup":     "scenario t\nsetup:\n  PUT k = 1\ntitle \"x\"\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n",
		"indent in header":      "scenario t\n  title \"x\"\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n",
		"missing scenario line": "schedule:\n  T1 BEGIN\n  T1 COMMIT\n",
		"bang alone":            "scenario t\ninvariant \"i\": 1 ! 1\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n",
		"non-ascii outside str": "scenario t\nschedule:\n  T1 BEGIN é\n  T1 COMMIT\n",
		"bad scenario id":       "scenario Bad_ID\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n",
		"long note":             "scenario t\nschedule:\n  T1 BEGIN\n  T1 NOTE \"" + strings.Repeat("x", 121) + "\"\n  T1 COMMIT\n",
		"long title":            "scenario t\ntitle \"" + strings.Repeat("x", 81) + "\"\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n",
	}
	for name, src := range cases {
		t.Run(name, func(t *testing.T) { firstErr(t, src) })
	}
}

func TestLimits(t *testing.T) {
	var b strings.Builder
	b.WriteString("scenario t\nschedule:\n  T1 BEGIN\n")
	for i := 0; i < MaxSteps; i++ {
		b.WriteString("  T1 NOTE \"x\"\n")
	}
	b.WriteString("  T1 COMMIT\n")
	firstErr(t, b.String())

	firstErr(t, "scenario t\n#"+strings.Repeat("x", MaxSource)+"\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n")

	b.Reset()
	b.WriteString("scenario t\nschedule:\n  T1 BEGIN\n")
	for i := 0; i < MaxKeys+1; i++ {
		b.WriteString("  T1 DELETE k" + itoa(int64(i)) + "\n")
	}
	b.WriteString("  T1 COMMIT\n")
	firstErr(t, b.String())
}

func TestErrorCap(t *testing.T) {
	src := "scenario t\nschedule:\n" + strings.Repeat("  T1 FROB\n", 50)
	_, errs := Parse(src)
	if len(errs) != MaxErrors {
		t.Fatalf("want %d errors, got %d", MaxErrors, len(errs))
	}
}

type testEnv struct {
	vars      map[string]Binding
	committed map[string]bool
}

func (e testEnv) Var(n string) (Binding, bool)    { b, ok := e.vars[n]; return b, ok }
func (e testEnv) FinalVal(string) int64           { return 7 }
func (e testEnv) FinalCount(string, *Where) int64 { return 2 }
func (e testEnv) FinalSum(string) int64           { return 9 }
func (e testEnv) Committed(t string) bool         { return e.committed[t] }

func TestExprEval(t *testing.T) {
	sc := mustParse(t, "scenario t\nschedule:\n  T1 BEGIN\n  T1 READ k AS a\n  T1 PUT k = a + 50 - 3\n  T1 COMMIT\n")
	env := testEnv{vars: map[string]Binding{"a": {Value: 100}}}
	v, err := sc.Steps[2].Expr.Eval(env)
	if err != nil || v != 147 {
		t.Fatalf("got %d, %v", v, err)
	}
}

func TestExprOverflow(t *testing.T) {
	sc := mustParse(t, "scenario t\nschedule:\n  T1 BEGIN\n  T1 READ k AS a\n  T1 PUT k = a + 1\n  T1 COMMIT\n")
	env := testEnv{vars: map[string]Binding{"a": {Value: MaxValue}}}
	if _, err := sc.Steps[2].Expr.Eval(env); err != ErrRange {
		t.Fatalf("want ErrRange, got %v", err)
	}
}

func TestInvariantEval(t *testing.T) {
	sc := mustParse(t, "scenario t\ninvariant \"i\": 2 * a + committed(T1) == 3\nschedule:\n  T1 BEGIN\n  T1 READ k AS a\n  T1 COMMIT\n")
	inv := &sc.Invariants[0]
	env := testEnv{vars: map[string]Binding{"a": {Value: 1}}, committed: map[string]bool{"T1": true}}
	if r := EvalInvariant(inv, env); r.Status != InvHolds {
		t.Fatalf("want holds: %+v", r)
	}
	env.committed["T1"] = false
	if r := EvalInvariant(inv, env); r.Status != InvViolated {
		t.Fatalf("want violated: %+v", r)
	}
	if r := EvalInvariant(inv, testEnv{}); r.Status != InvNA {
		t.Fatalf("want n/a: %+v", r)
	}
}

func TestNegativeLiteralRoundTrip(t *testing.T) {
	sc := mustParse(t, "scenario t\ninvariant \"i\": a - -1 == 0\nschedule:\n  T1 BEGIN\n  T1 READ k AS a\n  T1 COMMIT\n")
	out := Format(sc)
	if Format(mustParse(t, out)) != out {
		t.Fatalf("not idempotent:\n%s", out)
	}
}

func FuzzParse(f *testing.F) {
	files, _ := filepath.Glob("../../scenarios/*.azs")
	for _, p := range files {
		if b, err := os.ReadFile(p); err == nil {
			f.Add(string(b))
		}
	}
	f.Add(minimal)
	f.Fuzz(func(t *testing.T, src string) {
		sc, errs := Parse(src)
		if sc == nil {
			if len(errs) == 0 || len(errs) > MaxErrors {
				t.Fatalf("bad error count %d", len(errs))
			}
			return
		}
		out := Format(sc)
		sc2, errs2 := Parse(out)
		if sc2 == nil {
			t.Fatalf("Format output does not re-parse: %v\n%s", errs2, out)
		}
		if Format(sc2) != out {
			t.Fatalf("Format not idempotent:\n%s", out)
		}
	})
}
