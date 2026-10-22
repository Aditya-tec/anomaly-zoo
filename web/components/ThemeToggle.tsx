"use client";

import { useEffect, useState } from "react";

type Pref = "phosphor" | "paper";
const KEY = "azoo-theme";
const NEXT: Record<Pref, Pref> = { phosphor: "paper", paper: "phosphor" };
const LABEL: Record<Pref, string> = { phosphor: "Phosphor", paper: "Paper" };

function apply(pref: Pref) {
  const root = document.documentElement;
  if (pref === "phosphor") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", "light");
}

// localStorage is used only to remember this choice. Every access is wrapped
// because it can throw (private windows, blocked site data); the site renders
// correctly without it.
export function ThemeToggle() {
  const [pref, setPref] = useState<Pref>("phosphor");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === "light") setPref("paper");
    } catch {
      /* storage unavailable: stay on the default theme */
    }
  }, []);

  function cycle() {
    const next = NEXT[pref];
    setPref(next);
    apply(next);
    try {
      if (next === "phosphor") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, "light");
    } catch {
      /* not persisted; still applied for this visit */
    }
  }

  return (
    <button type="button" className="btn" onClick={cycle} data-testid="theme-toggle">
      Theme: {LABEL[pref]}
    </button>
  );
}
