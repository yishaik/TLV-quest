import type { Metadata } from "next";
import { OrganizerPortal } from "@/components/OrganizerPortal";

export const metadata: Metadata = {
  title: "Organizer Portal",
  robots: { index: false, follow: false }
};

export default function PortalPage() {
  return <OrganizerPortal />;
}
