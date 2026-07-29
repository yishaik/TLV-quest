import type { Metadata } from "next";
import { PremiumQuestPlayer } from "@/components/PremiumQuestPlayer";
import { QuestStationVisual } from "@/components/QuestStationVisual";

export const metadata: Metadata = { title: "המסע" };

export default async function PlayPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <>
      <QuestStationVisual token={token} />
      <PremiumQuestPlayer token={token} />
    </>
  );
}
