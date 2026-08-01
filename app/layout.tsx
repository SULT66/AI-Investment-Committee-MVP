import type { Metadata } from "next";
import { LanguageController } from "@/components/language-controller";
import { DialogueLanguageFix } from "@/components/dialogue-language-fix";
import { AudioControl } from "@/components/audio-control";
import { InteractiveCommitteeBridge } from "@/components/interactive-committee-bridge";
import "./globals.css";
import "./phase2.css";
import "./globals-phase2.css";
import "./boardroom-fix.css";
import "./committee/boardroom-v5.css";
import "./committee/boardroom-v6.css";

export const metadata: Metadata = {
  title: "AI Investment Committee",
  description: "Personalized investment analysis through an interactive AI committee."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}<LanguageController /><DialogueLanguageFix /><AudioControl /><InteractiveCommitteeBridge /></body>
    </html>
  );
}
