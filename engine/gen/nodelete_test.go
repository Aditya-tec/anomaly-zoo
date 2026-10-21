package gen

import "testing"

func TestNoDeleteOption(t *testing.T) {
	sawDelete := false
	for seed := uint64(1); seed <= 2000; seed++ {
		for _, st := range Generate(seed, Config{}).Steps {
			if st.Op == "DELETE" {
				sawDelete = true
			}
		}
		for _, st := range Generate(seed, Config{NoDelete: true}).Steps {
			if st.Op == "DELETE" {
				t.Fatalf("seed %d: NoDelete produced a DELETE", seed)
			}
		}
	}
	if !sawDelete {
		t.Fatal("the default generator never produced a DELETE in 2000 seeds; the option test is vacuous")
	}
}
