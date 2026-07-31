import type { Metadata } from "next";
import "./globals.css";
import "./phase2.css";
import "./globals-phase2.css";
import "./boardroom-fix.css";

export const metadata: Metadata = {
  title: "AI Investment Committee",
  description: "Personalized investment analysis through an interactive AI committee."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
