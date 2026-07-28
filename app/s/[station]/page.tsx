import type { Metadata } from "next";
import { StationScanner } from "@/components/StationScanner";

export const metadata: Metadata = { title: "תחנת משחק" };

export default async function StationPage({
  params
}: {
  params: Promise<{ station: string }>;
}) {
  const { station } = await params;
  return <StationScanner stationSlug={station} />;
}
