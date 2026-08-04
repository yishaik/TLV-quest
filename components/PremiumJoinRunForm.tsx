"use client";

import { FormEvent, useState } from "react";

type Locale = "he" | "en";
type JoinResult = {
  recoveryCode: string;
  teamName: string;
  playUrl: string;
  sandboxJoinUrl: string | null;
  gameLinkUrl: string;
};

const copy = {
  he: {
    kicker: "הזמנה אישית למסע",
    title: "לפני שהאות נפתח",
    intro: "שם פרטי וזהו. המערכת תחבר אתכם אוטומטית לאותה קבוצה.",
    firstName: "שם פרטי",
    phone: "WhatsApp לעדכונים — לא חובה",
    consent: "אני מסכים לשמירה מוצפנת של פרטי ההרשמה, ההודעות והתמונות עד 72 שעות לאחר סיום המשחק, ולאחר מכן למחיקתם.",
    submit: "פתיחת ההזמנה",
    loading: "מכין את הכניסה…",
    success: "הכניסה נפתחה",
    assigned: "הצוות שלכם",
    recovery: "קוד השחזור האישי",
    recoveryNote: "שמרו צילום מסך. הקוד מאפשר לחזור למסע גם ממכשיר אחר.",
    copy: "העתקת הקוד",
    copied: "הקוד הועתק",
    whatsapp: "עדכונים ב־WhatsApp — לא חובה",
    whatsappText: "המשחק מתנהל באתר. אפשר לחבר WhatsApp רק לקבלת עדכונים וקישור חזרה.",
    sandbox: "הצטרפות ל־WhatsApp",
    connect: "חיבור לעדכונים",
    enter: "כניסה למסע",
    ready: "הכול מוכן. המסך יתעדכן אוטומטית כשהמשחק יתחיל."
  },
  en: {
    kicker: "Your private quest invitation",
    title: "Before the signal opens",
    intro: "First name and you're in. The game places you in the same team automatically.",
    firstName: "First name",
    phone: "WhatsApp for updates — optional",
    consent: "I consent to encrypted storage of registration details, messages and photos until 72 hours after the quest, followed by deletion.",
    submit: "Open invitation",
    loading: "Preparing entry…",
    success: "Your entry is open",
    assigned: "Your team",
    recovery: "Personal recovery key",
    recoveryNote: "Keep a screenshot. This key restores the quest on another device.",
    copy: "Copy key",
    copied: "Key copied",
    whatsapp: "WhatsApp updates — optional",
    whatsappText: "The game stays on this page. Connect WhatsApp only for updates and a return link.",
    sandbox: "Join WhatsApp",
    connect: "Connect updates",
    enter: "Enter the quest",
    ready: "Everything is ready. This screen updates automatically when the quest starts."
  }
} as const;

export function PremiumJoinRunForm({ code }: { code: string }) {
  const [language, setLanguage] = useState<Locale>("he");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState<JoinResult | null>(null);
  const [copied, setCopied] = useState(false);
  const c = copy[language];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(code)}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: form.get("firstName"),
          publicAlias: form.get("firstName"),
          phone: form.get("phone"),
          requestedTeamName: "",
          language,
          consent: form.get("consent") === "on"
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "Registration failed");
      setJoined(payload.data);
      localStorage.setItem("tlvQuestParticipantToken", payload.data.playUrl.split("/").pop());
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  async function copyRecovery() {
    if (!joined) return;
    await navigator.clipboard.writeText(joined.recoveryCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (joined) {
    return (
      <section className="join-success">
        <div className="join-success-hero">
          <img src="/visuals/quest-mark.svg" alt="" />
          <span className="flow-kicker">{c.success}</span>
          <h1>{c.assigned}:<br /><em>{joined.teamName}</em></h1>
          <p>{c.ready}</p>
        </div>

        <a className="button quest-entry-button" href={joined.playUrl}>{c.enter}<span>←</span></a>

        <div className="join-success-grid">
          <article className="whatsapp-card">
            <span>OPTIONAL / WHATSAPP</span>
            <h2>{c.whatsapp}</h2>
            <p>{c.whatsappText}</p>
            <div className="join-actions">
              {joined.sandboxJoinUrl && <a className="button button-secondary" href={joined.sandboxJoinUrl}>{c.sandbox}</a>}
              <a className="button button-secondary" href={joined.gameLinkUrl}>{c.connect}</a>
            </div>
          </article>
          <details className="recovery-card">
            <summary>{c.recovery}</summary>
            <button type="button" className="recovery-code" onClick={copyRecovery}>{joined.recoveryCode}</button>
            <p>{c.recoveryNote}</p>
            <button className="button button-secondary" type="button" onClick={copyRecovery}>{copied ? c.copied : c.copy}</button>
          </details>
        </div>
      </section>
    );
  }

  return (
    <section className="join-card">
      <div className="join-card-header">
        <div><span className="flow-kicker">{c.kicker}</span><h2>{c.title}</h2><p>{c.intro}</p></div>
        <div className="language-segment" aria-label="Language">
          <button type="button" className={language === "he" ? "active" : ""} onClick={() => setLanguage("he")}>עברית</button>
          <button type="button" className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>EN</button>
        </div>
      </div>

      <form className="join-form" onSubmit={submit} dir={language === "he" ? "rtl" : "ltr"}>
        <div className="join-form-grid">
          <label><span>01</span><div><b>{c.firstName}</b><input name="firstName" required maxLength={40} autoComplete="given-name" /></div></label>
          <label><span>02</span><div><b>{c.phone}</b><input name="phone" type="tel" autoComplete="tel" placeholder="050-0000000" /></div></label>
        </div>
        <label className="join-consent"><input name="consent" type="checkbox" required /><span>{c.consent}</span></label>
        {error && <div className="flow-error" role="alert">{error}</div>}
        <button className="button quest-entry-button" disabled={loading}>{loading ? c.loading : c.submit}<span>↗</span></button>
      </form>
    </section>
  );
}
