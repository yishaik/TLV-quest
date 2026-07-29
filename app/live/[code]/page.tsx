import type { Metadata } from "next";
import { PremiumLiveLeaderboard } from "@/components/PremiumLiveLeaderboard";

export const metadata: Metadata = { title: "המרוץ החי" };

export default async function LivePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PremiumLiveLeaderboard code={code.toUpperCase()} />;
}
