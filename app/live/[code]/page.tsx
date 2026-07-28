import type { Metadata } from "next";
import { LiveLeaderboard } from "@/components/LiveLeaderboard";

export const metadata: Metadata = { title: "לוח חי" };

export default async function LivePage({
  params
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <LiveLeaderboard code={code.toUpperCase()} />;
}
