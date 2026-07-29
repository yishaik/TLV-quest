import type { Metadata, Viewport } from "next";
import { AppChrome } from "@/components/AppChrome";
import "./globals.css";
import "./marketing.css";
import "./experience.css";
import "./flows.css";

const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

export const metadata: Metadata = {
  title: {
    default: "TLV Quest | הרפתקה אורבנית בנמל תל אביב",
    template: "%s · TLV Quest"
  },
  description:
    "מסע מסתורין קולנועי בנמל תל אביב: רמזים בעולם האמיתי, חידות, צילום, מיקום ותחרות חיה — ישירות מהטלפון.",
  metadataBase: new URL(siteUrl),
  applicationName: "TLV Quest",
  category: "entertainment",
  keywords: ["Tel Aviv", "urban quest", "escape game", "נמל תל אביב", "משחק עירוני"],
  openGraph: {
    title: "הנמל זוכר. אתם באים לגלות?",
    description: "מסע אורבני חי בעקבות קפסולת הזמן של נמל תל אביב.",
    type: "website",
    locale: "he_IL",
    alternateLocale: "en_US",
    images: [{ url: "/visuals/tlv-quest-og.svg", width: 1200, height: 630, alt: "TLV Quest at Tel Aviv Port" }]
  },
  twitter: {
    card: "summary_large_image",
    title: "TLV Quest",
    description: "The port remembers. Your team has one night to unlock the story.",
    images: ["/visuals/tlv-quest-og.svg"]
  },
  icons: { icon: "/visuals/quest-mark.svg" }
};

export const viewport: Viewport = {
  themeColor: "#08131f",
  colorScheme: "dark light"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <AppChrome />
        {children}
      </body>
    </html>
  );
}
