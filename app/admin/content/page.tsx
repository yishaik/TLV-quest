import type { Metadata } from "next";
import { ContentStudioV2 } from "@/components/ContentStudioV2";

export const metadata: Metadata = {
  title: "Content Studio",
  robots: { index: false, follow: false }
};

export default function ContentStudioPage() {
  return <ContentStudioV2 />;
}
