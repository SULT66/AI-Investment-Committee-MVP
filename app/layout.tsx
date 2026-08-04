import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import "./committee/boardroom-final.css";

export const metadata: Metadata = {
  title: "AI Investment Committee",
  description: "AI investment research and decision support. Independent AI analysts examine a stock, argue, and show their evidence. Not investment advice."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}

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
