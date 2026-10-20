//go:build js && wasm

// Command wasm exposes the engine to the browser as globalThis.azoo (spec
// §5.9). All logic lives in engine/api; this file is only the syscall/js glue.
// Calls are synchronous and never throw: failures are returned as data.
package main

import (
	"syscall/js"

	"github.com/Aditya-tec/anomaly-zoo/engine/api"
)

// jsonFunc wraps a function returning a JSON document into a js.Func that
// returns the parsed object. Missing or non-string arguments become "", which
// the api layer reports as an ordinary error.
func jsonFunc(f func(args []string) string) js.Func {
	return js.FuncOf(func(this js.Value, args []js.Value) any {
		strs := make([]string, len(args))
		for i, a := range args {
			if a.Type() == js.TypeString {
				strs[i] = a.String()
			}
		}
		doc := f(strs)
		return js.Global().Get("JSON").Call("parse", doc)
	})
}

func arg(args []string, i int) string {
	if i < len(args) {
		return args[i]
	}
	return ""
}

func main() {
	azoo := js.Global().Get("Object").New()
	azoo.Set("version", js.FuncOf(func(this js.Value, args []js.Value) any { return api.Version() }))
	azoo.Set("parse", jsonFunc(func(a []string) string { return api.ParseJSON(arg(a, 0)) }))
	azoo.Set("run", jsonFunc(func(a []string) string { return api.RunJSON(arg(a, 0), arg(a, 1)) }))
	azoo.Set("runAll", jsonFunc(func(a []string) string { return api.RunAllJSON(arg(a, 0)) }))
	js.Global().Set("azoo", azoo)
	select {} // keep the runtime alive so the functions stay callable
}
