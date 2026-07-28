import type { Metadata } from "next";
import { JoinRunForm } from "@/components/JoinRunForm";

export const metadata: Metadata = { title: "הצטרפות למשחק" };

export default async function JoinPage({
  params
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return (
    <main className="site-shell page">
      <span className="badge">קוד משחק · {code.toUpperCase()}</span>
      <h1 className="page-title">הקפסולה מחכה לכם.</h1>
      <p className="lead">
        כל משתתף נרשם בנפרד. המערכת תחבר אתכם לקבוצה, תיתן קישור אישי ותדריך
        אתכם כיצד להתחבר לסנדבוקס של WhatsApp.
      </p>
      <div style={{ marginTop: 32 }}>
        <JoinRunForm code={code.toUpperCase()} />
      </div>
    </main>
  );
}
