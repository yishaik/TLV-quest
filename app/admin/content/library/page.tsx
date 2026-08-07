import type { Metadata } from "next";
import Link from "next/link";
import { ContentStudioV2 } from "@/components/ContentStudioV2";

export const metadata: Metadata = {
  title: "Content Studio",
  robots: { index: false, follow: false }
};

export default function ContentStudioLibraryPage() {
  return (
    <>
      <Link
        href="/admin/content"
        style={{
          position: "fixed",
          insetInlineStart: 18,
          bottom: 18,
          zIndex: 100,
          padding: "10px 14px",
          borderRadius: 12,
          background: "#ffffff",
          color: "#0a2638",
          border: "1px solid rgba(10, 31, 44, 0.14)",
          boxShadow: "0 10px 28px rgba(7, 32, 46, 0.16)",
          textDecoration: "none",
          fontWeight: 800
        }}
      >
        חזרה למפה
      </Link>
      <ContentStudioV2 />
    </>
  );
}
