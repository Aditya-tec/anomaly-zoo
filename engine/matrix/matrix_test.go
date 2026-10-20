package matrix

import (
	"testing"

	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

func checkLevels(t *testing.T, levels []trace.Level) {
	t.Helper()
	got, err := Compute("../../scenarios", levels)
	if err != nil {
		t.Fatal(err)
	}
	want, err := Load("../../scenarios/expected.json")
	if err != nil {
		t.Fatal(err)
	}
	if diffs := Diff(got, want, levels); len(diffs) > 0 {
		for _, d := range diffs {
			t.Error(d)
		}
	}
}

func TestMatrixRURC(t *testing.T) { checkLevels(t, []trace.Level{trace.RU, trace.RC}) }

func TestMatrixSI(t *testing.T) { checkLevels(t, []trace.Level{trace.SI}) }

func TestMatrixSER(t *testing.T) { checkLevels(t, []trace.Level{trace.SER}) }

func TestMatrixFull(t *testing.T) { checkLevels(t, trace.Levels) }
