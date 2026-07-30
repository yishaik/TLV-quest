import type { Metadata } from "next";
import { PremiumQuestPlayer } from "@/components/PremiumQuestPlayer";
import { QuestRealtimeProvider } from "@/components/QuestRealtimeProvider";
import { QuestRuntimeSafetyNet } from "@/components/QuestRuntimeSafetyNet";
import { QuestStationVisual } from "@/components/QuestStationVisual";

export const metadata: Metadata = { title: "המסע" };

export default async function PlayPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <QuestRealtimeProvider token={token}>
      <QuestStationVisual />
      <PremiumQuestPlayer token={token} />
      <QuestRuntimeSafetyNet token={token} />
    </QuestRealtimeProvider>
  );
}
