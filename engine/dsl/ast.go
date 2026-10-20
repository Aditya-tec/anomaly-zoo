// Package dsl parses, validates, evaluates and formats .azs scenario files.
package dsl

// MaxValue bounds every stored or computed integer (spec §4.1).
const MaxValue int64 = 1_000_000_000

// Scenario is a parsed .azs file. Line/Col fields are informational and are
// ignored by Format.
type Scenario struct {
	ID         string
	Title      string
	Story      string
	Invariants []Invariant
	Setup      []SetupPut
	Steps      []Step
}

// SetupPut is one `PUT key = int` line of the setup block.
type SetupPut struct {
	Line  int
	Key   string
	Value int64
}

// Invariant is `invariant "name": lhs CMP rhs`.
type Invariant struct {
	Line int
	Name string
	LHS  Expr
	Cmp  string
	RHS  Expr
}

// Step is one schedule line. Key holds the prefix for SCAN.
type Step struct {
	Line  int
	Col   int
	Txn   string // "T1".."T6"
	Op    string // BEGIN COMMIT ABORT READ SCAN PUT DELETE NOTE
	Key   string
	As    string
	Where *Where
	Expr  *Expr  // PUT only
	Text  string // NOTE only
}

// Where is the optional value filter of a SCAN or final.count.
type Where struct {
	Cmp   string
	Value int64
}

// Expr is a sum of signed terms.
type Expr struct {
	Terms []SignedTerm
}

// SignedTerm is a term with the sign it contributes with. The first term of an
// expression is never negated (negative literals are part of the INT).
type SignedTerm struct {
	Neg  bool
	Term Term
}

// Term is `INT`, `INT * atom` or `atom`. A nil Atom means the constant Coef.
type Term struct {
	HasCoef bool
	Coef    int64
	Atom    *Atom
}

// AtomKind enumerates expression atoms.
type AtomKind int

const (
	AtomVar AtomKind = iota
	AtomCount
	AtomSum
	AtomFinalVal
	AtomFinalCount
	AtomFinalSum
	AtomCommitted
)

// Atom is a leaf of an expression. Name is the variable, key/prefix or
// transaction id depending on Kind.
type Atom struct {
	Kind  AtomKind
	Name  string
	Where *Where
}

// Error is a positioned parse or validation error.
type Error struct {
	Line    int    `json:"line"`
	Col     int    `json:"col"`
	Message string `json:"message"`
}

func (e Error) Error() string {
	return itoa(int64(e.Line)) + ":" + itoa(int64(e.Col)) + ": " + e.Message
}
