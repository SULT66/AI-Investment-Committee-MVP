"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { UsageBadge } from "./usage-badge";
import "./site-nav.css";

/**
 * The header.
 *
 * Three entry points, plans, and the account. Review is shown but not linked:
 * naming what is coming is useful, pretending it works is not, so it carries a
 * label and no href rather than a link into a 501.
 *
 * Hidden on two routes. The access gate has nothing to navigate to yet, and the
 * Live Desk is a session in progress - offering a way out mid-committee is how
 * someone loses a review they have already been charged for.
 */

type Me = { account: { email: string; staff?: boolean } | null };

const LINKS = [
  { href: "/analyze", label: "Analyze", match: (p: string) => p === "/" || p.startsWith("/analyze") },
  { href: "/build", label: "Build", match: (p: string) => p.startsWith("/build") },
  { href: "/reports", label: "Sessions", match: (p: string) => p.startsWith("/reports") },
  { href: "/terms#plans", label: "Plans", match: () => false }
];

export function SiteNav() {
  const pathname = usePathname() ?? "/";
  const [me, setMe] = useState<Me["account"]>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    fetch("/api/v1/auth/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: Me) => setMe(body.account))
      .catch(() => undefined)
      .finally(() => setChecked(true));
  }, [pathname]);

  if (pathname.startsWith("/access") || pathname.startsWith("/live")) return null;

  return (
    <header className="siteNav">
      <div className="siteNavInner">
        <Link href="/" className="siteNavBrand" aria-label="AI Investment Committee home">
          <span className="siteNavMark">AIC</span>
        </Link>

        <nav className="siteNavLinks" aria-label="Main">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={l.match(pathname) ? "siteNavLink on" : "siteNavLink"}
              aria-current={l.match(pathname) ? "page" : undefined}
            >
              {l.label}
            </Link>
          ))}
          <span className="siteNavLink siteNavSoon" aria-disabled="true">
            Review<em>soon</em>
          </span>
        </nav>

        <div className="siteNavRight">
          <UsageBadge />
          {me?.staff && (
            <Link href="/admin" className={pathname.startsWith("/admin") ? "siteNavLink on" : "siteNavLink"}>
              Staff
            </Link>
          )}
          <Link
            href="/account"
            className={pathname.startsWith("/account") ? "siteNavAccount on" : "siteNavAccount"}
          >
            {checked && me ? me.email.split("@")[0] : "Sign in"}
          </Link>
        </div>
      </div>
    </header>
  );
}
