"use client";

import { useEffect, useState } from "react";

// The pause control for the background clip. It talks to <BackgroundVideo> through a document event,
// and mirrors the video's real state (the label changes, so it is not also an aria-pressed toggle) by listening to its play and pause events.
export function BackgroundToggle() {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const video = document.querySelector<HTMLVideoElement>('[data-testid="bg-video"]');
    if (!video) return;
    const sync = () => setPaused(video.paused);
    sync();
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    return () => {
      video.removeEventListener("play", sync);
      video.removeEventListener("pause", sync);
    };
  }, []);

  return (
    <button type="button" className="btn" onClick={() => document.dispatchEvent(new Event("azoo:toggle-background"))} data-testid="bg-toggle">
      {paused ? "Resume motion" : "Stop motion"}
    </button>
  );
}
