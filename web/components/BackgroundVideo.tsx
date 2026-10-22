"use client";

import { useEffect, useRef, useState } from "react";

// A slow, dark, looping clip behind every page (generated locally, public/media/ambient.mp4; nothing is
// fetched from another host). It plays at half speed. Two ways to stop it: the operating-system
// "reduce motion" setting, which keeps it paused from the start, and the button in the footer
// (WCAG 2.2.2: moving content that lasts more than five seconds needs a pause control).
// The file is requested after the page's load event, so it never competes with the headline for
// bandwidth (the Lighthouse LCP budget is 2.5 s on the mobile profile).
const SRC = "/media/ambient.mp4";

export function BackgroundVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.playbackRate = 0.5;
    const load = () => {
      video.src = SRC;
      video.playbackRate = 0.5;
    };
    if (document.readyState === "complete") load();
    else window.addEventListener("load", load, { once: true });
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (query.matches) {
        video.pause();
        setPaused(true);
      }
    };
    apply();
    query.addEventListener("change", apply);
    return () => {
      query.removeEventListener("change", apply);
      window.removeEventListener("load", load);
    };
  }, []);

  useEffect(() => {
    const onToggle = () => {
      const video = ref.current;
      if (!video) return;
      if (video.paused) void video.play().catch(() => undefined);
      else video.pause();
    };
    document.addEventListener("azoo:toggle-background", onToggle);
    return () => document.removeEventListener("azoo:toggle-background", onToggle);
  }, []);

  return (
    <video
      ref={ref}
      className="bg-video"
      muted
      autoPlay
      loop
      playsInline
      preload="none"
      aria-hidden="true"
      tabIndex={-1}
      data-testid="bg-video"
      data-paused={paused ? "true" : "false"}
      onPlay={() => setPaused(false)}
      onPause={() => setPaused(true)}
    />
  );
}
