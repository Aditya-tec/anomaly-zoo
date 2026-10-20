"use client";

import { useEffect, useState } from "react";

type Pref = "system" | "light" | "dark";
const KEY = "azoo-theme";
const NEXT: Record<Pref, Pref> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Pref, string> = { system: "System", light: "Light", dark: "Dark" };

function apply(pref: Pref) {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}

// localStorage is used only to remember this choice. Every access is wrapped
// because it can throw (private windows, blocked site data); the site renders
// correctly without it.
export function ThemeToggle() {
  const [pref, setPref] = useState<Pref>("system");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") setPref(saved);
    } catch {
      /* storage unavailable: stay on the system theme */
    }
  }, []);

  function cycle() {
    const next = NEXT[pref];
    setPref(next);
    apply(next);
    try {
      if (next === "system") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, next);
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
