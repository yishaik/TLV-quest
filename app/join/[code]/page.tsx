import type { Metadata } from "next";
import { PremiumJoinRunForm } from "@/components/PremiumJoinRunForm";

export const metadata: Metadata = { title: "הזמנה למסע" };

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const publicCode = code.toUpperCase();

  return (
    <main className="flow-page join-page">
      <div className="flow-visual" aria-hidden="true"><img src="/visuals/harbor-hero.svg" alt="" /></div>
      <div className="flow-overlay" />
      <header className="flow-page-header">
        <div className="flow-brand"><img src="/visuals/quest-mark.svg" alt="" /><span><b>TLV QUEST</b><small>PRIVATE INVITATION</small></span></div>
        <span className="flow-code">{publicCode}</span>
      </header>
      <div className="flow-page-content">
        <PremiumJoinRunForm code={publicCode} />
      </div>
    </main>
  );
}
