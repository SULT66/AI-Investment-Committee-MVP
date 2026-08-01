"use client";

import { useEffect, useState } from "react";

const activeMedia = new Set<HTMLMediaElement>();
let installed = false;
let blocked = false;
let originalPlay: typeof HTMLMediaElement.prototype.play | null = null;

export function AudioControl() {
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (!installed) {
      installed = true;
      originalPlay = HTMLMediaElement.prototype.play;

      HTMLMediaElement.prototype.play = function patchedPlay() {
        const media = this;
        activeMedia.add(media);
        const cleanup = () => activeMedia.delete(media);
        media.addEventListener("ended", cleanup, { once: true });
        media.addEventListener("error", cleanup, { once: true });

        if (blocked) {
          media.pause();
          return Promise.resolve();
        }
        return originalPlay!.call(media);
      };
    }

    return () => {
      // Keep the global patch installed for the lifetime of the page.
    };
  }, []);

  function stopSpeaking() {
    blocked = true;
    setStopped(true);
    for (const media of activeMedia) media.pause();
    window.speechSynthesis?.cancel();
    window.dispatchEvent(new CustomEvent("aic-audio-stop"));
  }

  function resumeSpeaking() {
    blocked = false;
    setStopped(false);
    for (const media of activeMedia) {
      if (media.paused && !media.ended) originalPlay?.call(media).catch(() => undefined);
    }
    window.dispatchEvent(new CustomEvent("aic-audio-resume"));
  }

  return (
    <button
      type="button"
      onClick={stopped ? resumeSpeaking : stopSpeaking}
      aria-label={stopped ? "Resume speaking" : "Stop speaking"}
      style={{
        position: "fixed",
        right: 205,
        bottom: 18,
        zIndex: 1001,
        minWidth: 150,
        padding: "11px 14px",
        borderRadius: 10,
        border: stopped ? "1px solid #3f9f5b" : "1px solid #8d3d3d",
        background: stopped ? "rgba(15,57,31,.96)" : "rgba(62,18,18,.96)",
        color: "#fff",
        fontWeight: 800,
        cursor: "pointer",
        boxShadow: "0 12px 35px rgba(0,0,0,.45)"
      }}
    >
      {stopped ? "▶ Resume" : "■ Stop speaking"}
    </button>
  );
}
