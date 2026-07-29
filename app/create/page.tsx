import type { Metadata } from "next";
import { PremiumCreateRunForm } from "@/components/PremiumCreateRunForm";

export const metadata: Metadata = { title: "יצירת הרצה פרטית" };

export default async function CreatePage({
  searchParams
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite = "" } = await searchParams;

  return (
    <main className="flow-page create-page">
      <div className="flow-visual" aria-hidden="true"><img src="/visuals/harbor-hero.svg" alt="" /></div>
      <div className="flow-overlay" />
      <header className="flow-page-header">
        <div className="flow-brand"><img src="/visuals/quest-mark.svg" alt="" /><span><b>TLV QUEST</b><small>ORGANIZER ACCESS</small></span></div>
        <span className="flow-code">PRIVATE RUN</span>
      </header>
      <div className="flow-page-content">
        <PremiumCreateRunForm inviteToken={invite} />
      </div>
    </main>
  );
}
