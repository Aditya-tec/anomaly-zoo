package oracle

import (
	"testing"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

func konst(n int64) *dsl.Expr {
	return &dsl.Expr{Terms: []dsl.SignedTerm{{Term: dsl.Term{Coef: n}}}}
}

func varPlus(name string, n int64) *dsl.Expr {
	return &dsl.Expr{Terms: []dsl.SignedTerm{
		{Term: dsl.Term{Atom: &dsl.Atom{Kind: dsl.AtomVar, Name: name}}},
		{Term: dsl.Term{Coef: n}},
	}}
}

func TestSerialHistoryAccepted(t *testing.T) {
	in := Input{
		Setup: []trace.KV{{Key: "x", Value: 1}},
		Txns: []Txn{
			{ID: "T2", Ops: []Op{{Kind: "READ", Key: "x", As: "a", Value: 2}, {Kind: "PUT", Key: "x", Expr: varPlus("a", 1)}}},
			{ID: "T1", Ops: []Op{{Kind: "READ", Key: "x", As: "a", Value: 1}, {Kind: "PUT", Key: "x", Expr: varPlus("a", 1)}}},
		},
		Final: []trace.KV{{Key: "x", Value: 3}},
	}
	ok, order := Check(in)
	if !ok || len(order) != 2 || order[0] != "T1" || order[1] != "T2" {
		t.Fatalf("ok=%v order=%v", ok, order)
	}
}

func TestLostUpdateRejected(t *testing.T) {
	in := Input{
		Setup: []trace.KV{{Key: "balance", Value: 100}},
		Txns: []Txn{
			{ID: "T1", Ops: []Op{{Kind: "READ", Key: "balance", As: "a", Value: 100}, {Kind: "PUT", Key: "balance", Expr: varPlus("a", 50)}}},
			{ID: "T2", Ops: []Op{{Kind: "READ", Key: "balance", As: "b", Value: 100}, {Kind: "PUT", Key: "balance", Expr: varPlus("b", 30)}}},
		},
		Final: []trace.KV{{Key: "balance", Value: 130}},
	}
	if ok, _ := Check(in); ok {
		t.Fatal("lost update accepted")
	}
}

func TestWriteSkewRejected(t *testing.T) {
	both := []trace.KV{{Key: "doctor:alice", Value: 1}, {Key: "doctor:bob", Value: 1}}
	where := &dsl.Where{Cmp: "==", Value: 1}
	in := Input{
		Setup: both,
		Txns: []Txn{
			{ID: "T1", Ops: []Op{{Kind: "SCAN", Key: "doctor:", Where: where, As: "s", Rows: both}, {Kind: "PUT", Key: "doctor:alice", Expr: konst(0)}}},
			{ID: "T2", Ops: []Op{{Kind: "SCAN", Key: "doctor:", Where: where, As: "s", Rows: both}, {Kind: "PUT", Key: "doctor:bob", Expr: konst(0)}}},
		},
		Final: []trace.KV{{Key: "doctor:alice", Value: 0}, {Key: "doctor:bob", Value: 0}},
	}
	if ok, _ := Check(in); ok {
		t.Fatal("write skew accepted")
	}
	// With T2 aborted the single committed transaction is trivially serializable.
	in.Txns = in.Txns[:1]
	in.Final = []trace.KV{{Key: "doctor:alice", Value: 0}, {Key: "doctor:bob", Value: 1}}
	if ok, order := Check(in); !ok || order[0] != "T1" {
		t.Fatalf("ok=%v order=%v", ok, order)
	}
}

func TestReadOnlyAnomalyRejected(t *testing.T) {
	in := Input{
		Setup: []trace.KV{{Key: "control:batch", Value: 1}},
		Txns: []Txn{
			{ID: "T1", Ops: []Op{
				{Kind: "READ", Key: "control:batch", As: "day", Value: 2},
				{Kind: "SCAN", Key: "receipt:1:", As: "r", Rows: nil},
			}},
			{ID: "T2", Ops: []Op{
				{Kind: "READ", Key: "control:batch", As: "current", Value: 1},
				{Kind: "PUT", Key: "receipt:1:r1", Expr: konst(100)},
			}},
			{ID: "T3", Ops: []Op{
				{Kind: "READ", Key: "control:batch", As: "before_close", Value: 1},
				{Kind: "PUT", Key: "control:batch", Expr: varPlus("before_close", 1)},
			}},
		},
		Final: []trace.KV{{Key: "control:batch", Value: 2}, {Key: "receipt:1:r1", Value: 100}},
	}
	if ok, _ := Check(in); ok {
		t.Fatal("read-only anomaly accepted")
	}
	// Dropping T2 (as SER does) leaves a serializable history.
	in.Txns = []Txn{in.Txns[0], in.Txns[2]}
	in.Final = []trace.KV{{Key: "control:batch", Value: 2}}
	if ok, order := Check(in); !ok || order[0] != "T3" || order[1] != "T1" {
		t.Fatalf("ok=%v order=%v", ok, order)
	}
}

func TestFinalStateMismatchRejected(t *testing.T) {
	in := Input{
		Setup: []trace.KV{{Key: "x", Value: 1}},
		Txns:  []Txn{{ID: "T1", Ops: []Op{{Kind: "PUT", Key: "x", Expr: konst(5)}}}},
		Final: []trace.KV{{Key: "x", Value: 6}},
	}
	if ok, _ := Check(in); ok {
		t.Fatal("wrong final state accepted")
	}
	in.Final = []trace.KV{{Key: "x", Value: 5}, {Key: "y", Value: 1}}
	if ok, _ := Check(in); ok {
		t.Fatal("extra key accepted")
	}
}

func TestEmptyHistoryAndDeleteAndAbsent(t *testing.T) {
	if ok, order := Check(Input{Setup: []trace.KV{{Key: "x", Value: 1}}, Final: []trace.KV{{Key: "x", Value: 1}}}); !ok || len(order) != 0 {
		t.Fatalf("empty history: %v %v", ok, order)
	}
	in := Input{
		Setup: []trace.KV{{Key: "x", Value: 1}},
		Txns: []Txn{
			{ID: "T1", Ops: []Op{{Kind: "DELETE", Key: "x"}}},
			{ID: "T2", Ops: []Op{{Kind: "READ", Key: "x", As: "a", Absent: true}}},
		},
		Final: nil,
	}
	if ok, order := Check(in); !ok || order[0] != "T1" {
		t.Fatalf("ok=%v order=%v", ok, order)
	}
}

func TestShrinkReducesToMinimalFailure(t *testing.T) {
	sc, errs := dsl.Parse(`scenario s
setup:
  PUT a = 1
  PUT b = 2
schedule:
  T1 BEGIN
  T2 BEGIN
  T1 READ a AS x
  T2 READ b AS y
  T1 PUT a = x + 1
  T2 PUT b = y + 1
  T1 COMMIT
  T2 COMMIT
`)
	if len(errs) > 0 {
		t.Fatal(errs)
	}
	// "Fails" while any step writes key a.
	fails := func(s *dsl.Scenario) bool {
		for _, st := range s.Steps {
			if st.Op == "PUT" && st.Key == "a" {
				return true
			}
		}
		return false
	}
	min := Shrink(sc, fails)
	if len(min.Steps) != 3 || len(min.Setup) != 0 {
		t.Fatalf("not minimal:\n%s", dsl.Format(min))
	}
}
