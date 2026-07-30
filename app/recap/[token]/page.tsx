import type { Metadata } from "next";
import { RecapExperience } from "@/components/RecapExperience";

export const metadata: Metadata = {
  title: "Quest recap",
  robots: { index: false, follow: false }
};

export default async function RecapPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <RecapExperience token={token} />;
}
