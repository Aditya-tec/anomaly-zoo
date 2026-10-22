"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  /** User intent signal (focus): the page may start loading the engine. */
  onIntent: () => void;
  invalid: boolean;
  describedBy?: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

const MAX_NUMBERED_LINES = 2000;

// A <textarea> with a line-number gutter. The numbers are CSS counters: the
// gutter holds one empty <span> per line and ::before prints counter(line), so
// the gutter text is never part of the document the visitor edits or copies.
export function SourceEditor({ value, onChange, onRun, onIntent, invalid, describedBy, textareaRef }: Props) {
  const gutter = useRef<HTMLDivElement>(null);
  // The server-rendered textarea is editable before React hydrates, and hydration resets it to the
  // state's value, which silently discards anything typed in that window. So it is read-only until
  // hydrated, and `data-hydrated` tells tests (and anyone else) when it is ready.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const lineCount = Math.min(value.split("\n").length, MAX_NUMBERED_LINES);

  return (
    <div className="editor" data-testid="editor" data-hydrated={hydrated ? "true" : "false"}>
      <div className="editor-gutter" ref={gutter} aria-hidden="true" data-testid="editor-gutter" data-lines={lineCount}>
        {Array.from({ length: lineCount }, (_, i) => (
          <span key={i} />
        ))}
      </div>
      <textarea
        id="source"
        ref={textareaRef}
        className="editor-input"
        data-testid="source"
        value={value}
        wrap="off"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        readOnly={!hydrated}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onIntent}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            onRun();
          }
        }}
      />
    </div>
  );
}
