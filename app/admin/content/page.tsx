import type { Metadata } from "next";
import { ContentStudioComposer } from "@/components/ContentStudioComposer";

export const metadata: Metadata = {
  title: "Content Operating System",
  robots: { index: false, follow: false }
};

export default function ContentStudioPage() {
  return <ContentStudioComposer />;
}
