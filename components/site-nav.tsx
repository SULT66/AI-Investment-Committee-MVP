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
 * Hidden on exactly one route: the access gate. Before the code is entered every
 * link would bounce straight back to it, so a menu there is a row of buttons
 * that do nothing.
 *
 * It is shown on the Live Desk. Leaving mid-session used to look like losing the
 * review, but a session runs as a durable job and its report is saved whether or
 * not anyone is watching - it will be waiting under Dashboard and Sessions. A
 * client who wants to leave should not have to hunt for the way out.
 */

type Me = { account: { email: string; staff?: boolean } | null };

const LINKS = [
  { href: "/dashboard", label: "Dashboard", match: (p: string) => p.startsWith("/dashboard") },
  { href: "/analyze", label: "Analyze", match: (p: string) => p.startsWith("/analyze") },
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

  if (pathname.startsWith("/access")) return null;

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
