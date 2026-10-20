package dsl

import (
	"strings"
	"unicode/utf8"
)

// Limits (spec §4.10 and §10.4).
const (
	MaxSource     = 8 * 1024
	MaxSteps      = 200
	MaxKeys       = 64
	MaxKeyLen     = 32
	MaxIDLen      = 16
	MaxTitleLen   = 80
	MaxStoryLen   = 400
	MaxNoteLen    = 120
	MaxInvNameLen = 80
	maxScenarioID = 40
)

// Parse parses and validates a scenario. On any error the returned scenario is
// nil. It never panics.
func Parse(src string) (*Scenario, []Error) {
	errs := &errList{}
	if len(src) > MaxSource {
		errs.add(1, 1, "source exceeds "+itoa(MaxSource)+" bytes")
		return nil, errs.list
	}
	if !utf8.ValidString(src) {
		errs.add(1, 1, "source is not valid UTF-8")
		return nil, errs.list
	}
	src = strings.ReplaceAll(src, "\r\n", "\n")
	src = strings.ReplaceAll(src, "\r", "\n")

	sc := &Scenario{}
	const (
		stHeader = iota
		stSetup
		stSchedule
	)
	state := stHeader
	seenScenario, seenTitle, seenStory, seenSetup, seenSchedule := false, false, false, false, false

	for idx, raw := range strings.Split(src, "\n") {
		lineNo := idx + 1
		toks, indented := lexLine(raw, lineNo, errs)
		if len(toks) == 0 {
			continue
		}
		c := &cursor{toks: toks, line: lineNo, endCol: len(raw) + 1, errs: errs}

		if !seenScenario {
			seenScenario = true
			if indented || toks[0].text != "scenario" || toks[0].kind != tWord {
				errs.add(lineNo, toks[0].col, "expected 'scenario <id>' as the first line")
				continue
			}
			c.next()
			if t, ok := c.word("scenario id"); ok {
				if !validScenarioID(t.text) {
					errs.add(lineNo, t.col, "scenario id must match [a-z][a-z0-9-]{0,39}")
				}
				sc.ID = t.text
				c.end()
			}
			continue
		}

		if indented {
			switch state {
			case stSetup:
				parseSetupLine(c, sc)
			case stSchedule:
				parseStepLine(c, sc)
			default:
				errs.add(lineNo, toks[0].col, "unexpected indented line; expected 'setup:' or 'schedule:' first")
			}
			continue
		}

		t := c.next()
		if t.kind != tWord {
			errs.add(lineNo, t.col, "expected a keyword at the start of the line")
			continue
		}
		switch t.text {
		case "title":
			if state != stHeader || seenTitle {
				errs.add(lineNo, t.col, "'title' must appear once, before 'setup:'")
				continue
			}
			seenTitle = true
			if s, ok := c.str("title"); ok {
				if utf8.RuneCountInString(s) > MaxTitleLen {
					errs.add(lineNo, t.col, "title exceeds "+itoa(MaxTitleLen)+" characters")
				}
				sc.Title = s
				c.end()
			}
		case "story":
			if state != stHeader || seenStory {
				errs.add(lineNo, t.col, "'story' must appear once, before 'setup:'")
				continue
			}
			seenStory = true
			if s, ok := c.str("story"); ok {
				if utf8.RuneCountInString(s) > MaxStoryLen {
					errs.add(lineNo, t.col, "story exceeds "+itoa(MaxStoryLen)+" characters")
				}
				sc.Story = s
				c.end()
			}
		case "invariant":
			if state != stHeader {
				errs.add(lineNo, t.col, "'invariant' must appear before 'setup:'")
				continue
			}
			parseInvariant(c, sc)
		case "setup:":
			if state != stHeader || seenSetup {
				errs.add(lineNo, t.col, "'setup:' must appear once, before 'schedule:'")
				continue
			}
			seenSetup = true
			state = stSetup
			c.end()
		case "schedule:":
			if seenSchedule {
				errs.add(lineNo, t.col, "'schedule:' must appear once")
				continue
			}
			seenSchedule = true
			state = stSchedule
			c.end()
		default:
			errs.add(lineNo, t.col, "unknown keyword '"+clip(t.text)+"'")
		}
	}

	if !seenScenario {
		errs.add(1, 1, "empty file; expected 'scenario <id>'")
	} else if !seenSchedule {
		errs.add(1, 1, "missing 'schedule:' block")
	}
	validate(sc, errs)

	if errs.truncated {
		errs.list[len(errs.list)-1].Message += " (further errors not shown)"
	}
	if len(errs.list) > 0 {
		return nil, errs.list
	}
	return sc, nil
}

func clip(s string) string {
	if len(s) > 24 {
		return s[:24] + "…"
	}
	return s
}

// cursor walks the tokens of one line and records at most one error per
// failed construct.
type cursor struct {
	toks   []token
	i      int
	line   int
	endCol int
	errs   *errList
}

func (c *cursor) peek() *token {
	if c.i < len(c.toks) {
		return &c.toks[c.i]
	}
	return nil
}

func (c *cursor) next() token {
	if c.i < len(c.toks) {
		t := c.toks[c.i]
		c.i++
		return t
	}
	return token{col: c.endCol}
}

func (c *cursor) fail(col int, msg string) { c.errs.add(c.line, col, msg) }

func (c *cursor) colHere() int {
	if t := c.peek(); t != nil {
		return t.col
	}
	return c.endCol
}

func (c *cursor) word(what string) (token, bool) {
	t := c.peek()
	if t == nil || t.kind != tWord {
		c.fail(c.colHere(), "expected "+what)
		return token{}, false
	}
	c.i++
	return *t, true
}

func (c *cursor) str(what string) (string, bool) {
	t := c.peek()
	if t == nil || t.kind != tString {
		c.fail(c.colHere(), "expected a quoted string for "+what)
		return "", false
	}
	c.i++
	return t.text, true
}

func (c *cursor) isWord(text string) bool {
	t := c.peek()
	return t != nil && t.kind == tWord && t.text == text
}

func (c *cursor) isPunct(text string) bool {
	t := c.peek()
	return t != nil && t.kind == tPunct && t.text == text
}

func (c *cursor) expectWord(text string) bool {
	if c.isWord(text) {
		c.i++
		return true
	}
	c.fail(c.colHere(), "expected '"+text+"'")
	return false
}

func (c *cursor) expectPunct(text string) bool {
	if c.isPunct(text) {
		c.i++
		return true
	}
	c.fail(c.colHere(), "expected '"+text+"'")
	return false
}

// end reports trailing tokens.
func (c *cursor) end() {
	if t := c.peek(); t != nil {
		c.fail(t.col, "unexpected '"+clip(t.text)+"' at end of line")
	}
}

func (c *cursor) cmp() (string, bool) {
	t := c.peek()
	if t != nil && t.kind == tPunct {
		switch t.text {
		case "==", "!=", "<", "<=", ">", ">=":
			c.i++
			return t.text, true
		}
	}
	c.fail(c.colHere(), "expected a comparison operator (== != < <= > >=)")
	return "", false
}

func (c *cursor) integer(what string) (int64, bool) {
	t := c.peek()
	if t == nil || t.kind != tWord {
		c.fail(c.colHere(), "expected an integer for "+what)
		return 0, false
	}
	n, ok := parseInt(t.text)
	if !ok {
		c.fail(t.col, "expected an integer for "+what+", found '"+clip(t.text)+"'")
		return 0, false
	}
	if n > MaxValue || n < -MaxValue {
		c.fail(t.col, "integer out of range (±1000000000)")
		return 0, false
	}
	c.i++
	return n, true
}

func parseInt(s string) (int64, bool) {
	neg := false
	if strings.HasPrefix(s, "-") {
		neg = true
		s = s[1:]
	}
	if s == "" || len(s) > 18 {
		return 0, false
	}
	var n int64
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return 0, false
		}
		n = n*10 + int64(s[i]-'0')
	}
	if neg {
		n = -n
	}
	return n, true
}

func isIntWord(s string) bool { _, ok := parseInt(s); return ok }

func validKey(s string) bool {
	if len(s) == 0 || len(s) > MaxKeyLen {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == ':' || c == '.' || c == '_' || c == '-') {
			return false
		}
	}
	return true
}

func validScenarioID(s string) bool {
	if len(s) == 0 || len(s) > maxScenarioID || s[0] < 'a' || s[0] > 'z' {
		return false
	}
	for i := 1; i < len(s); i++ {
		c := s[i]
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
			return false
		}
	}
	return true
}

var reservedIDs = map[string]bool{"count": true, "sum": true, "final": true, "committed": true}

func validID(s string) bool {
	if len(s) == 0 || len(s) > MaxIDLen || s[0] < 'a' || s[0] > 'z' {
		return false
	}
	for i := 1; i < len(s); i++ {
		c := s[i]
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_') {
			return false
		}
	}
	return !reservedIDs[s]
}

func validTxn(s string) bool {
	return len(s) == 2 && s[0] == 'T' && s[1] >= '1' && s[1] <= '6'
}

func (c *cursor) key(what string) (string, bool) {
	t, ok := c.word(what)
	if !ok {
		return "", false
	}
	if !validKey(t.text) {
		c.fail(t.col, "invalid "+what+" '"+clip(t.text)+"': use 1-32 characters from a-z 0-9 : . _ -")
		return "", false
	}
	return t.text, true
}

func (c *cursor) id(what string) (string, bool) {
	t, ok := c.word(what)
	if !ok {
		return "", false
	}
	if !validID(t.text) {
		c.fail(t.col, "invalid "+what+" '"+clip(t.text)+"': use [a-z][a-z0-9_]{0,15}, not count/sum/final/committed")
		return "", false
	}
	return t.text, true
}

func parseSetupLine(c *cursor, sc *Scenario) {
	if !c.expectWord("PUT") {
		return
	}
	k, ok := c.key("key")
	if !ok || !c.expectPunct("=") {
		return
	}
	v, ok := c.integer("setup value")
	if !ok {
		return
	}
	c.end()
	sc.Setup = append(sc.Setup, SetupPut{Line: c.line, Key: k, Value: v})
}

func parseInvariant(c *cursor, sc *Scenario) {
	name, ok := c.str("invariant name")
	if !ok || !c.expectPunct(":") {
		return
	}
	if utf8.RuneCountInString(name) > MaxInvNameLen {
		c.fail(1, "invariant name exceeds "+itoa(MaxInvNameLen)+" characters")
		return
	}
	lhs, ok := c.expr(true)
	if !ok {
		return
	}
	op, ok := c.cmp()
	if !ok {
		return
	}
	rhs, ok := c.expr(true)
	if !ok {
		return
	}
	c.end()
	sc.Invariants = append(sc.Invariants, Invariant{Line: c.line, Name: name, LHS: lhs, Cmp: op, RHS: rhs})
}

func parseStepLine(c *cursor, sc *Scenario) {
	first := c.peek()
	txn, ok := c.word("transaction (T1..T6)")
	if !ok {
		return
	}
	if !validTxn(txn.text) {
		c.fail(first.col, "invalid transaction '"+clip(txn.text)+"'; use T1..T6")
		return
	}
	opTok, ok := c.word("operation")
	if !ok {
		return
	}
	st := Step{Line: c.line, Col: txn.col, Txn: txn.text, Op: opTok.text}
	switch opTok.text {
	case "BEGIN", "COMMIT", "ABORT":
		c.end()
	case "READ":
		k, ok := c.key("key")
		if !ok || !c.expectWord("AS") {
			return
		}
		a, ok := c.id("variable name")
		if !ok {
			return
		}
		c.end()
		st.Key, st.As = k, a
	case "SCAN":
		p, ok := c.key("prefix")
		if !ok {
			return
		}
		st.Key = p
		if c.isWord("WHERE") {
			c.i++
			op, ok := c.cmp()
			if !ok {
				return
			}
			n, ok := c.integer("filter value")
			if !ok {
				return
			}
			st.Where = &Where{Cmp: op, Value: n}
		}
		if !c.expectWord("AS") {
			return
		}
		a, ok := c.id("variable name")
		if !ok {
			return
		}
		c.end()
		st.As = a
	case "PUT":
		k, ok := c.key("key")
		if !ok || !c.expectPunct("=") {
			return
		}
		e, ok := c.expr(false)
		if !ok {
			return
		}
		c.end()
		st.Key, st.Expr = k, &e
	case "DELETE":
		k, ok := c.key("key")
		if !ok {
			return
		}
		c.end()
		st.Key = k
	case "NOTE":
		s, ok := c.str("note")
		if !ok {
			return
		}
		if utf8.RuneCountInString(s) > MaxNoteLen {
			c.fail(opTok.col, "note exceeds "+itoa(MaxNoteLen)+" characters")
			return
		}
		c.end()
		st.Text = s
	default:
		c.fail(opTok.col, "unknown operation '"+clip(opTok.text)+"'")
		return
	}
	sc.Steps = append(sc.Steps, st)
}

// expr parses `term { (+|-) term }`. With full=false only the PUT subset is
// accepted (INT, ID, count(ID), sum(ID)).
func (c *cursor) expr(full bool) (Expr, bool) {
	var e Expr
	t, ok := c.term(full)
	if !ok {
		return e, false
	}
	e.Terms = append(e.Terms, SignedTerm{Term: t})
	for {
		neg := false
		switch {
		case c.isPunct("+"):
		case c.isWord("-"):
			neg = true
		default:
			return e, true
		}
		c.i++
		t, ok := c.term(full)
		if !ok {
			return e, false
		}
		e.Terms = append(e.Terms, SignedTerm{Neg: neg, Term: t})
	}
}

func (c *cursor) term(full bool) (Term, bool) {
	t := c.peek()
	if t != nil && t.kind == tWord && isIntWord(t.text) {
		n, ok := c.integer("term")
		if !ok {
			return Term{}, false
		}
		if full && c.isPunct("*") {
			c.i++
			a, ok := c.atom(full)
			if !ok {
				return Term{}, false
			}
			return Term{HasCoef: true, Coef: n, Atom: &a}, true
		}
		return Term{Coef: n}, true
	}
	a, ok := c.atom(full)
	if !ok {
		return Term{}, false
	}
	return Term{Atom: &a}, true
}

func (c *cursor) atom(full bool) (Atom, bool) {
	t, ok := c.word("a variable, count(..), sum(..) or integer")
	if !ok {
		return Atom{}, false
	}
	call := func(kind AtomKind, restricted bool) (Atom, bool) {
		if restricted && !full {
			c.fail(t.col, "'"+t.text+"' is only allowed in invariants")
			return Atom{}, false
		}
		if !c.expectPunct("(") {
			return Atom{}, false
		}
		a := Atom{Kind: kind}
		switch kind {
		case AtomCount, AtomSum:
			n, ok := c.id("variable name")
			if !ok {
				return Atom{}, false
			}
			a.Name = n
		case AtomFinalVal, AtomFinalCount, AtomFinalSum:
			col := c.colHere()
			s, ok := c.str("key or prefix")
			if !ok {
				return Atom{}, false
			}
			if !validKey(s) {
				c.fail(col, "invalid key or prefix '"+clip(s)+"'")
				return Atom{}, false
			}
			a.Name = s
			if kind == AtomFinalCount && c.isWord("WHERE") {
				c.i++
				op, ok := c.cmp()
				if !ok {
					return Atom{}, false
				}
				n, ok := c.integer("filter value")
				if !ok {
					return Atom{}, false
				}
				a.Where = &Where{Cmp: op, Value: n}
			}
		case AtomCommitted:
			x, ok := c.word("transaction")
			if !ok {
				return Atom{}, false
			}
			if !validTxn(x.text) {
				c.fail(x.col, "invalid transaction '"+clip(x.text)+"'; use T1..T6")
				return Atom{}, false
			}
			a.Name = x.text
		}
		if !c.expectPunct(")") {
			return Atom{}, false
		}
		return a, true
	}
	switch t.text {
	case "count":
		return call(AtomCount, false)
	case "sum":
		return call(AtomSum, false)
	case "final.val":
		return call(AtomFinalVal, true)
	case "final.count":
		return call(AtomFinalCount, true)
	case "final.sum":
		return call(AtomFinalSum, true)
	case "committed":
		return call(AtomCommitted, true)
	}
	if !validID(t.text) {
		if i := strings.Index(t.text[1:], "-"); i >= 0 {
			i++
			c.fail(t.col, "'"+clip(t.text)+"' is not a variable; to subtract, write `"+clip(t.text[:i])+" - "+clip(t.text[i+1:])+"` with spaces around '-'")
			return Atom{}, false
		}
		c.fail(t.col, "expected a variable name, found '"+clip(t.text)+"'")
		return Atom{}, false
	}
	return Atom{Kind: AtomVar, Name: t.text}, true
}
