import type { Metadata } from "next";
import { ContentStudio } from "@/components/ContentStudio";

export const metadata: Metadata = {
  title: "Content Operating System",
  robots: { index: false, follow: false }
};

export default function ContentStudioPage() {
  return <ContentStudio />;
}
