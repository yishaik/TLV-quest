import type { Metadata } from "next";
import { PremiumOrganizerDashboard } from "@/components/PremiumOrganizerDashboard";

export const metadata: Metadata = { title: "חדר בקרה" };

export default async function OrganizerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PremiumOrganizerDashboard token={token} />;
}
