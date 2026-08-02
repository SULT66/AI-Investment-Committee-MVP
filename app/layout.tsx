import type { Metadata } from "next";
import Script from "next/script";
import { LanguageController } from "@/components/language-controller";
import { DialogueLanguageFix } from "@/components/dialogue-language-fix";
import { AudioControl } from "@/components/audio-control";
import { InteractiveCommitteeBridge } from "@/components/interactive-committee-bridge";
import { MarketDataBridge } from "@/components/market-data-bridge";
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
      <body>
        {children}
        <LanguageController />
        <DialogueLanguageFix />
        <AudioControl />
        <InteractiveCommitteeBridge />
        <MarketDataBridge />

        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-T2LZE9N3Y0"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){window.dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-T2LZE9N3Y0', {
              page_path: window.location.pathname
            });
          `}
        </Script>
      </body>
    </html>
  );
}
