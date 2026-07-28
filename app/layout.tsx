import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "TLV Quest",
    template: "%s · TLV Quest"
  },
  description:
    "Autonomous urban quests. The first adventure follows a lost time capsule through Tel Aviv Port.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000")
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <div className="site-shell">
          <header className="topbar">
            <Link href="/" className="brand" aria-label="TLV Quest home">
              <span className="brand-mark">Q</span>
              <span>TLV Quest</span>
            </Link>
            <nav className="nav-links" aria-label="Primary navigation">
              <Link className="button button-secondary" href="/join/demo">
                הצטרפות
              </Link>
              <Link className="button button-dark" href="/create">
                יצירת משחק
              </Link>
            </nav>
          </header>
        </div>
        {children}
      </body>
    </html>
  );
}
