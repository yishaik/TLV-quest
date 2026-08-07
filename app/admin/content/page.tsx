import type { Metadata } from "next";
import { UnifiedContentStudio } from "@/components/UnifiedContentStudio";

export const metadata: Metadata = {
  title: "Content Studio",
  robots: { index: false, follow: false }
};

export default function ContentStudioPage() {
  return <UnifiedContentStudio />;
}
