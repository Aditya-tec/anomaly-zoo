// Small decorative icons. They always sit next to a text label, so they are
// hidden from assistive technology.
const base = { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": true, focusable: false, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function LockIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

export function CrossIcon() {
  return (
    <svg {...base}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function SkipIcon() {
  return (
    <svg {...base}>
      <path d="M3 8h10" />
      <path d="M10 5l3 3-3 3" />
    </svg>
  );
}

export function QueueIcon() {
  return (
    <svg {...base}>
      <path d="M3 4h10M3 8h10M3 12h6" />
    </svg>
  );
}

export function ResumeIcon() {
  return (
    <svg {...base}>
      <path d="M13 8a5 5 0 1 1-1.6-3.7" />
      <path d="M13 3v3h-3" />
    </svg>
  );
}
