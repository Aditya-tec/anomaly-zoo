//go:build js && wasm

// Command wasm exposes the engine to the browser. P0 spike: hello only.
package main

import "syscall/js"

func main() {
	js.Global().Set("azoo", map[string]any{
		"version": js.FuncOf(func(this js.Value, args []js.Value) any { return "0.0.0-spike" }),
	})
	select {}
}
