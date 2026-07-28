import type { Metadata } from "next";
import { OrganizerDashboard } from "@/components/OrganizerDashboard";

export const metadata: Metadata = { title: "ניהול משחק" };

export default async function OrganizerPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <OrganizerDashboard token={token} />;
}
