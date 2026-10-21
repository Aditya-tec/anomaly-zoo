package dsl

import (
	"strings"
	"testing"
)

// Spec §10.4: titles, stories, notes and invariant names are plain text with
// caps of 80, 400, 120 and 80 characters. The caps count characters (runes),
// not bytes, and control characters are refused outright rather than stripped
// (silently editing a scenario would change what is run; see DECISIONS.md).
func TestStringCapsAreExactlyTheSpecifiedOnes(t *testing.T) {
	wrap := map[string]func(s string) string{
		"title": func(s string) string {
			return "scenario t\ntitle \"" + s + "\"\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n"
		},
		"story": func(s string) string {
			return "scenario t\nstory \"" + s + "\"\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n"
		},
		"note": func(s string) string {
			return "scenario t\nschedule:\n  T1 BEGIN\n  T1 NOTE \"" + s + "\"\n  T1 COMMIT\n"
		},
		"invariant name": func(s string) string {
			return "scenario t\ninvariant \"" + s + "\": 1 == 1\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n"
		},
	}
	caps := map[string]int{"title": 80, "story": 400, "note": 120, "invariant name": 80}
	if caps["title"] != MaxTitleLen || caps["story"] != MaxStoryLen || caps["note"] != MaxNoteLen || caps["invariant name"] != MaxInvNameLen {
		t.Fatalf("caps drifted from spec §10.4: %d %d %d %d", MaxTitleLen, MaxStoryLen, MaxNoteLen, MaxInvNameLen)
	}
	for field, f := range wrap {
		n := caps[field]
		for _, ch := range []string{"x", "é", "日"} { // 1-, 2- and 3-byte characters
			if _, errs := Parse(f(strings.Repeat(ch, n))); len(errs) > 0 {
				t.Errorf("%s of exactly %d %q must be accepted: %v", field, n, ch, errs)
			}
			if _, errs := Parse(f(strings.Repeat(ch, n+1))); len(errs) == 0 {
				t.Errorf("%s of %d %q must be refused", field, n+1, ch)
			}
		}
		for _, c := range []string{"\x00", "\x01", "\x07", "\x1b", "\x7f"} {
			if _, errs := Parse(f("a" + c + "b")); len(errs) == 0 {
				t.Errorf("%s containing %q must be refused", field, c)
			}
		}
	}
}
