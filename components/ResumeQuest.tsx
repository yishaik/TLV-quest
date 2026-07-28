"use client";

import { useEffect, useState } from "react";

export function ResumeQuest() {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const token = window.localStorage.getItem("tlvQuestParticipantToken");
    if (token) {
      window.location.replace(`/play/${encodeURIComponent(token)}`);
      return;
    }

    const timer = window.setTimeout(() => setMissing(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="site-shell page">
      <section className="card" style={{ maxWidth: 680, margin: "40px auto" }}>
        <span className="badge">TLV Quest</span>
        <h1 className="page-title">
          {missing ? "לא נמצא משחק במכשיר הזה" : "פותח את המסע…"}
        </h1>
        {missing && (
          <>
            <p className="lead">
              קישור המשחק נשמר בדפדפן שבו ביצעת את ההרשמה. פתח את הקישור באותו מכשיר
              ובאותו דפדפן, או חזור לקישור ההרשמה שקיבלת מהמארגן.
            </p>
            <p className="muted">
              ב־WhatsApp אפשר לשלוח <strong>משימה</strong> כדי לקבל שוב את התחנה הנוכחית.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
