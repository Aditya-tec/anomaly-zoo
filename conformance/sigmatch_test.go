package conformance

import "testing"

func TestSigMatch(t *testing.T) {
	cases := []struct {
		pattern, sig string
		want         bool
	}{
		{"RC:race/*", "RC:race/varies:final", true},
		{"RC:race/*", "SI:race/varies:final", false},
		{"RC:*", "RC:status", true},
		{"SER:fewer:*", "SER:fewer:race/fixed:abortset+status", true},
		{"SER:fewer:*", "SER:more:abortset", false},
		{"*:race/*", "SI:race/fixed:rows", true},
		{"*:race/*", "SI:rows", false},
		{"SI:status", "SI:status", true},
		{"SI:status", "SI:status+rows", false},
		{"RC:*:final", "RC:race/varies:final", true},
		{"RC:*:final", "RC:race/varies:final+rows", false},
	}
	for _, c := range cases {
		if got := sigMatch(c.pattern, c.sig); got != c.want {
			t.Errorf("sigMatch(%q, %q) = %v, want %v", c.pattern, c.sig, got, c.want)
		}
	}
}
