import type { Metadata } from "next";
import { CreateRunForm } from "@/components/CreateRunForm";

export const metadata: Metadata = { title: "יצירת משחק" };

export default async function CreatePage({
  searchParams
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite = "" } = await searchParams;

  return (
    <main className="site-shell page">
      <span className="badge">אשף מארגן</span>
      <h1 className="page-title">משחק חדש בנמל</h1>
      <p className="lead">
        ברירות המחדל מתאימות לפיילוט של בני נוער במסלול קפסולת הזמן. אפשר
        לשנות את מבנה הקבוצות, ההתחלה, הניקוד והחשיפה בלוח.
      </p>
      <div style={{ marginTop: 32 }}>
        <CreateRunForm inviteToken={invite} />
      </div>
    </main>
  );
}
