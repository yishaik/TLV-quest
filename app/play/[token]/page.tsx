import type { Metadata } from "next";
import { QuestPlayer } from "@/components/QuestPlayer";

export const metadata: Metadata = { title: "המסע" };

export default async function PlayPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <QuestPlayer token={token} />;
}
