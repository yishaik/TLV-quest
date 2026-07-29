import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import "./marketing.css";

export const metadata: Metadata = {
  title: {
    default: "TLV Quest | הרפתקת חידות חיה בנמל תל אביב",
    template: "%s · TLV Quest"
  },
  description:
    "הפכו את נמל תל אביב לזירת הרפתקה. חפשו רמזים, פתרו חידות, השלימו משימות וחשפו את הסיפור שמסתתר בין הרציפים.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "הנמל מסתיר סיפור. אתם יכולים לפתוח אותו.",
    description: "הרפתקה אורבנית חיה בנמל תל אביב עם חידות בעולם האמיתי, משימות צילום וקודים נסתרים.",
    type: "website"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <div className="site-shell app-chrome">
          <header className="topbar">
            <Link href="/" className="brand" aria-label="TLV Quest home">
              <span className="brand-mark">Q</span>
              <span>TLV Quest</span>
            </Link>
            <nav className="nav-links" aria-label="Primary navigation">
              <Link className="button button-secondary" href="/join/demo">הצטרפות / Join</Link>
              <Link className="button button-dark" href="/create">יצירת משחק / Create</Link>
            </nav>
          </header>
        </div>
        {children}
      </body>
    </html>
  );
}
