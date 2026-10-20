package trace

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

// SchemaJSON is the JSON Schema (2020-12) every emitted trace must satisfy.
//
//go:embed trace.schema.json
var SchemaJSON []byte

// ValidateJSON checks data against SchemaJSON. It implements only the schema
// keywords the file uses: type, const, enum, properties, required,
// additionalProperties, items, minimum, $ref (local "#/$defs/x").
func ValidateJSON(data []byte) error {
	var schema map[string]any
	if err := json.Unmarshal(SchemaJSON, &schema); err != nil {
		return err
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	var doc any
	if err := dec.Decode(&doc); err != nil {
		return err
	}
	return validate(schema, schema, doc, "$")
}

func validate(root, s map[string]any, v any, path string) error {
	if ref, ok := s["$ref"].(string); ok {
		name := strings.TrimPrefix(ref, "#/$defs/")
		defs, _ := root["$defs"].(map[string]any)
		target, ok := defs[name].(map[string]any)
		if !ok {
			return fmt.Errorf("%s: unresolved $ref %s", path, ref)
		}
		return validate(root, target, v, path)
	}
	if c, ok := s["const"]; ok {
		if !jsonEqual(c, v) {
			return fmt.Errorf("%s: want const %v, got %v", path, c, v)
		}
	}
	if e, ok := s["enum"].([]any); ok {
		found := false
		for _, x := range e {
			if jsonEqual(x, v) {
				found = true
			}
		}
		if !found {
			return fmt.Errorf("%s: %v not in enum %v", path, v, e)
		}
	}
	if t, ok := s["type"]; ok {
		var types []any
		switch tt := t.(type) {
		case string:
			types = []any{tt}
		case []any:
			types = tt
		}
		matched := false
		for _, x := range types {
			if typeMatches(x.(string), v) {
				matched = true
			}
		}
		if !matched {
			return fmt.Errorf("%s: type %v does not match %T", path, t, v)
		}
	}
	if m, ok := s["minimum"]; ok {
		if n, isNum := v.(json.Number); isNum {
			f, _ := n.Float64()
			if f < m.(float64) {
				return fmt.Errorf("%s: %v below minimum %v", path, n, m)
			}
		}
	}
	switch val := v.(type) {
	case map[string]any:
		props, _ := s["properties"].(map[string]any)
		if req, ok := s["required"].([]any); ok {
			for _, r := range req {
				if _, present := val[r.(string)]; !present {
					return fmt.Errorf("%s: missing required property %q", path, r)
				}
			}
		}
		for k, child := range val {
			sub, known := props[k].(map[string]any)
			if !known {
				if ap, ok := s["additionalProperties"].(bool); ok && !ap {
					return fmt.Errorf("%s: unexpected property %q", path, k)
				}
				continue
			}
			if err := validate(root, sub, child, path+"."+k); err != nil {
				return err
			}
		}
	case []any:
		if items, ok := s["items"].(map[string]any); ok {
			for i, child := range val {
				if err := validate(root, items, child, fmt.Sprintf("%s[%d]", path, i)); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func typeMatches(t string, v any) bool {
	switch t {
	case "object":
		_, ok := v.(map[string]any)
		return ok
	case "array":
		_, ok := v.([]any)
		return ok
	case "string":
		_, ok := v.(string)
		return ok
	case "boolean":
		_, ok := v.(bool)
		return ok
	case "null":
		return v == nil
	case "integer":
		n, ok := v.(json.Number)
		return ok && !strings.ContainsAny(n.String(), ".eE")
	case "number":
		_, ok := v.(json.Number)
		return ok
	}
	return false
}

func jsonEqual(a, b any) bool {
	an, aok := a.(float64)
	bn, bok := b.(json.Number)
	if aok && bok {
		f, _ := bn.Float64()
		return an == f
	}
	return fmt.Sprint(a) == fmt.Sprint(b)
}
