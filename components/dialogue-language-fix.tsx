"use client";

import { useEffect } from "react";

type Lang = "en"|"ru"|"es"|"fr"|"de"|"it"|"pt"|"ar"|"tr"|"az";

const locales: Record<Lang, string> = {
  en: "en-US", ru: "ru-RU", es: "es-ES", fr: "fr-FR", de: "de-DE",
  it: "it-IT", pt: "pt-BR", ar: "ar-SA", tr: "tr-TR", az: "az-AZ"
};

const cache = new Map<string, string>();

function currentLanguage(): Lang {
  const value = (localStorage.getItem("aic-language") || "en") as Lang;
  return value in locales ? value : "en";
}

export function DialogueLanguageFix() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    async function translate(text: string, language: Lang): Promise<string> {
      if (!text.trim() || language === "en") return text;
      const key = `${language}:${text}`;
      const existing = cache.get(key);
      if (existing) return existing;
      try {
        const response = await originalFetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, language })
        });
        if (!response.ok) return text;
        const data = await response.json();
        const translated = typeof data.text === "string" ? data.text : text;
        cache.set(key, translated);
        return translated;
      } catch {
        return text;
      }
    }

    const patchedFetch: typeof window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const language = currentLanguage();

      if (init?.body && typeof init.body === "string" && url.includes("/api/voice")) {
        try {
          const body = JSON.parse(init.body);
          if (typeof body.text === "string") body.text = await translate(body.text, language);
          body.language = locales[language];
          init = { ...init, body: JSON.stringify(body) };
        } catch {}
      }

      if (init?.body && typeof init.body === "string" && url.includes("/api/committee/sessions")) {
        try {
          const body = JSON.parse(init.body);
          body.language = language;
          init = { ...init, body: JSON.stringify(body) };
        } catch {}
      }

      return originalFetch(input, init);
    };

    window.fetch = patchedFetch;

    let running = false;
    const translateVisibleDialogue = async () => {
      if (running) return;
      running = true;
      try {
        const language = currentLanguage();
        if (language === "en") return;
        const nodes = Array.from(document.querySelectorAll<HTMLElement>(
          ".liveCaption p, .dialogueLine p, .aicReport p, .aicReport li"
        ));
        for (const node of nodes) {
          const original = node.dataset.originalText || node.textContent || "";
          if (!original.trim()) continue;
          node.dataset.originalText = original;
          const marker = `${language}:${original}`;
          if (node.dataset.translatedKey === marker) continue;
          node.textContent = await translate(original, language);
          node.dataset.translatedKey = marker;
        }
      } finally {
        running = false;
      }
    };

    const observer = new MutationObserver(() => void translateVisibleDialogue());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    void translateVisibleDialogue();

    const onStorage = () => void translateVisibleDialogue();
    window.addEventListener("storage", onStorage);
    const interval = window.setInterval(() => void translateVisibleDialogue(), 800);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
      window.removeEventListener("storage", onStorage);
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
