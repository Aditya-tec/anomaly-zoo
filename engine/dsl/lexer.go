package dsl

import (
	"strconv"
	"unicode/utf8"
)

// MaxErrors is the most errors Parse reports.
const MaxErrors = 20

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

type errList struct {
	list      []Error
	truncated bool
}

func (e *errList) add(line, col int, msg string) {
	if len(e.list) >= MaxErrors {
		e.truncated = true
		return
	}
	e.list = append(e.list, Error{Line: line, Col: col, Message: msg})
}

type tokKind int

const (
	tWord tokKind = iota
	tString
	tPunct
)

type token struct {
	kind tokKind
	text string
	col  int // 1-based byte column
}

func isWordByte(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
		c == ':' || c == '.' || c == '_' || c == '-'
}

// lexLine tokenises one source line. It never fails hard: problems are added
// to errs and the offending bytes are skipped.
func lexLine(s string, lineNo int, errs *errList) (toks []token, indented bool) {
	indented = len(s) > 0 && (s[0] == ' ' || s[0] == '\t')
	i := 0
	for i < len(s) {
		c := s[i]
		switch {
		case c == ' ' || c == '\t':
			i++
		case c == '#':
			return
		case c == '"':
			start := i
			i++
			var buf []byte
			closed := false
			for i < len(s) {
				ch := s[i]
				if ch == '"' {
					closed = true
					i++
					break
				}
				if ch == '\\' {
					if i+1 < len(s) && (s[i+1] == '"' || s[i+1] == '\\') {
						buf = append(buf, s[i+1])
						i += 2
						continue
					}
					errs.add(lineNo, i+1, `unknown escape; only \" and \\ are allowed`)
					i++
					continue
				}
				if ch < 0x20 || ch == 0x7f {
					errs.add(lineNo, i+1, "control character in string")
					i++
					continue
				}
				buf = append(buf, ch)
				i++
			}
			if !closed {
				errs.add(lineNo, start+1, "unterminated string")
			}
			str := string(buf)
			if !utf8.ValidString(str) {
				errs.add(lineNo, start+1, "string is not valid UTF-8")
				str = ""
			}
			toks = append(toks, token{tString, str, start + 1})
		case c == ':' && len(toks) > 0 && toks[len(toks)-1].kind == tString:
			toks = append(toks, token{tPunct, ":", i + 1})
			i++
		case isWordByte(c):
			start := i
			for i < len(s) && isWordByte(s[i]) {
				i++
			}
			toks = append(toks, token{tWord, s[start:i], start + 1})
		case c == '=' || c == '<' || c == '>':
			if i+1 < len(s) && s[i+1] == '=' {
				toks = append(toks, token{tPunct, s[i : i+2], i + 1})
				i += 2
			} else {
				toks = append(toks, token{tPunct, s[i : i+1], i + 1})
				i++
			}
		case c == '!':
			if i+1 < len(s) && s[i+1] == '=' {
				toks = append(toks, token{tPunct, "!=", i + 1})
				i += 2
			} else {
				errs.add(lineNo, i+1, "unexpected '!'; did you mean '!='?")
				i++
			}
		case c == '+' || c == '*' || c == '(' || c == ')':
			toks = append(toks, token{tPunct, s[i : i+1], i + 1})
			i++
		default:
			errs.add(lineNo, i+1, "unexpected character")
			if c >= 0x80 {
				_, n := utf8.DecodeRuneInString(s[i:])
				i += n
			} else {
				i++
			}
		}
	}
	return
}
