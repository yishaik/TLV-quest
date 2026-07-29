"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AppChrome() {
  const pathname = usePathname();

  if (pathname === "/" || pathname.startsWith("/admin/content")) return null;

  return (
    <div className="site-shell app-chrome">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="TLV Quest home">
          <span className="brand-mark" aria-hidden="true">Q</span>
          <span>TLV Quest</span>
        </Link>
        <nav className="nav-links" aria-label="Primary navigation">
          <Link className="button button-secondary" href="/resume">
            חזרה למסע / Resume
          </Link>
          <Link className="button button-dark" href="/create">
            יצירת משחק / Create
          </Link>
        </nav>
      </header>
    </div>
  );
}
