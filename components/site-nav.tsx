"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { UsageBadge } from "./usage-badge";
import "./site-nav.css";

/**
 * The header.
 *
 * Seven destinations do not fit across a phone. They were laid out in a
 * horizontally scrollable row, which meant that on a 400px screen the menu ended
 * at "Bu" and Portfolio, Review, Sessions and Plans were invisible unless you
 * happened to swipe a strip of text that gave no sign it could be swiped. Below
 * 900px the links now collapse into a dropdown.
 *
 * Both layouts are built from the same LINKS array, so the panel cannot drift
 * out of step with the row.
 *
 * Hidden on exactly one route: the access gate. Before the code is entered every
 * link would bounce straight back to it, so a menu there is a row of buttons
 * that do nothing.
 *
 * It is shown on the Live Desk. Leaving mid-session used to look like losing the
 * review, but a session runs as a durable job and its report is saved whether or
 * not anyone is watching - it will be waiting under Dashboard and Sessions.
 */

type Me = { account: { email: string; staff?: boolean } | null };

const LINKS = [
  /* Monitor was folded in here: one page, one answer. The match still covers
     /monitor so the item stays highlighted while the redirect happens. */
  {
    href: "/dashboard",
    label: "Dashboard",
    match: (p: string) => p.startsWith("/dashboard") || p.startsWith("/monitor")
  },
  { href: "/analyze", label: "Analyze", match: (p: string) => p.startsWith("/analyze") },
  { href: "/build", label: "Build", match: (p: string) => p.startsWith("/build") },
  { href: "/portfolio", label: "Portfolio", match: (p: string) => p.startsWith("/portfolio") },
  { href: "/review", label: "Review", match: (p: string) => p.startsWith("/review") },
  { href: "/reports", label: "Sessions", match: (p: string) => p.startsWith("/reports") },
  { href: "/terms#plans", label: "Plans", match: () => false }
];

export function SiteNav() {
  const pathname = usePathname() ?? "/";
  const [me, setMe] = useState<Me["account"]>(null);
  const [checked, setChecked] = useState(false);
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    fetch("/api/v1/auth/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: Me) => setMe(body.account))
      .catch(() => undefined)
      .finally(() => setChecked(true));
  }, [pathname]);

  /* Arriving somewhere new closes the menu. Leaving it open over the new page is
     the classic way a mobile menu ends up covering the thing you asked for. */
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();   // put focus back where it came from
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || toggle.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  if (pathname.startsWith("/access")) return null;

  const staff = Boolean(me?.staff);
  const accountLabel = checked && me ? me.email.split("@")[0] : "Sign in";

  return (
    <header className="siteNav">
      <div className="siteNavInner">
        <Link href="/" className="siteNavBrand" aria-label="AI Investment Committee home">
          <span className="siteNavMark">AIC</span>
        </Link>

        {/* Wide screens: the links in a row. */}
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
          {staff && (
            <Link
              href="/admin"
              className={pathname.startsWith("/admin") ? "siteNavLink on" : "siteNavLink"}
            >
              Staff
            </Link>
          )}
        </nav>

        <div className="siteNavRight">
          <UsageBadge />
          <Link
            href="/account"
            className={pathname.startsWith("/account") ? "siteNavAccount on" : "siteNavAccount"}
          >
            {accountLabel}
          </Link>

          {/* Narrow screens: one button, everything behind it. */}
          <button
            ref={toggle}
            className="siteNavToggle"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls="siteNavPanel"
            aria-label={open ? "Close menu" : "Open menu"}
          >
            <span className={open ? "siteNavBurger open" : "siteNavBurger"} aria-hidden="true">
              <i /><i /><i />
            </span>
          </button>
        </div>
      </div>

      {open && (
        <div className="siteNavPanel" id="siteNavPanel" ref={panel}>
          <nav aria-label="Main menu">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={l.match(pathname) ? "siteNavPanelLink on" : "siteNavPanelLink"}
                aria-current={l.match(pathname) ? "page" : undefined}
              >
                {l.label}
              </Link>
            ))}
            {staff && (
              <Link
                href="/admin"
                className={pathname.startsWith("/admin") ? "siteNavPanelLink on" : "siteNavPanelLink"}
              >
                Staff
              </Link>
            )}
            <Link
              href="/account"
              className={
                pathname.startsWith("/account")
                  ? "siteNavPanelLink siteNavPanelAccount on"
                  : "siteNavPanelLink siteNavPanelAccount"
              }
            >
              {checked && me ? `Account · ${me.email}` : "Sign in"}
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
