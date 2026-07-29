import type { Metadata } from "next";
import { PremiumQuestPlayer } from "@/components/PremiumQuestPlayer";

export const metadata: Metadata = { title: "המסע" };

export default async function PlayPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PremiumQuestPlayer token={token} />;
}
