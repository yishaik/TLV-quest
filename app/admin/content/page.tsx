import type { Metadata } from "next";
import { ContentMapStudio } from "@/components/ContentMapStudio";

export const metadata: Metadata = {
  title: "Map Studio",
  robots: { index: false, follow: false }
};

export default function ContentMapStudioPage() {
  return <ContentMapStudio />;
}
