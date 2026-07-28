"use client";

import { FormEvent, useState } from "react";

type JoinResult = {
  recoveryCode: string;
  teamName: string;
  playUrl: string;
  sandboxJoinUrl: string | null;
  gameLinkUrl: string;
};

export function JoinRunForm({ code }: { code: string }) {
  const [language, setLanguage] = useState<"he" | "en">("he");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState<JoinResult | null>(null);

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
          publicAlias: form.get("publicAlias"),
          phone: form.get("phone"),
          requestedTeamName: form.get("requestedTeamName"),
          language,
          consent: form.get("consent") === "on"
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Registration failed");
      }
      setJoined(payload.data);
      localStorage.setItem("tlvQuestParticipantToken", payload.data.playUrl.split("/").pop());
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  if (joined) {
    return (
      <div className="grid">
        <div className="card">
          <span className="badge">{language === "he" ? "נרשמת בהצלחה" : "Registration complete"}</span>
          <h2>{language === "he" ? `הקבוצה שלך: ${joined.teamName}` : `Your team: ${joined.teamName}`}</h2>
          <p>
            {language === "he"
              ? "קוד השחזור שלך. שמור אותו עד סוף המשחק:"
              : "Keep this recovery code until the game ends:"}
          </p>
          <div className="code">{joined.recoveryCode}</div>
        </div>

        <div className="card">
          <h2>{language === "he" ? "חיבור WhatsApp" : "Connect WhatsApp"}</h2>
          <p className="muted">
            {language === "he"
              ? "בסנדבוקס נדרשים שני צעדים: הצטרפות לסנדבוקס ואז חיבור להרצה."
              : "The sandbox requires two steps: join the sandbox, then link this game."}
          </p>
          <div className="actions">
            {joined.sandboxJoinUrl && (
              <a className="button button-secondary" href={joined.sandboxJoinUrl} target="_blank" rel="noreferrer">
                1. {language === "he" ? "הצטרפות לסנדבוקס" : "Join sandbox"}
              </a>
            )}
            <a className="button button-primary" href={joined.gameLinkUrl} target="_blank" rel="noreferrer">
              2. {language === "he" ? "חיבור למשחק" : "Link game"}
            </a>
          </div>
        </div>

        <a className="button button-dark" href={joined.playUrl}>
          {language === "he" ? "כניסה למסע" : "Enter the quest"}
        </a>
      </div>
    );
  }

  return (
    <form className="card form-grid" onSubmit={submit}>
      <div className="field">
        <label htmlFor="language">Language / שפה</label>
        <select
          id="language"
          name="language"
          value={language}
          onChange={(event) => setLanguage(event.target.value === "en" ? "en" : "he")}
        >
          <option value="he">עברית</option>
          <option value="en">English</option>
        </select>
      </div>

      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="firstName">{language === "he" ? "שם פרטי" : "First name"}</label>
          <input id="firstName" name="firstName" required maxLength={40} autoComplete="given-name" />
        </div>
        <div className="field">
          <label htmlFor="publicAlias">{language === "he" ? "כינוי ציבורי" : "Public alias"}</label>
          <input id="publicAlias" name="publicAlias" maxLength={40} />
        </div>
      </div>

      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="phone">{language === "he" ? "מספר WhatsApp" : "WhatsApp number"}</label>
          <input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="050-0000000" />
        </div>
        <div className="field">
          <label htmlFor="requestedTeamName">{language === "he" ? "שם קבוצה, אם נקבע מראש" : "Preassigned team name"}</label>
          <input id="requestedTeamName" name="requestedTeamName" maxLength={40} />
        </div>
      </div>

      <label className="checkbox-row" htmlFor="consent">
        <input id="consent" name="consent" type="checkbox" required />
        <span>
          {language === "he"
            ? "אני מסכים לשמירת פרטי ההרשמה, ההודעות והתמונות באופן מוצפן עד 72 שעות לאחר סיום המשחק, ולאחר מכן למחיקתם."
            : "I consent to encrypted storage of registration details, messages and photos until 72 hours after the game, followed by deletion."}
        </span>
      </label>

      {error && <div className="error" role="alert">{error}</div>}
      <button className="button button-primary" disabled={loading}>
        {loading
          ? language === "he" ? "מצטרף…" : "Joining…"
          : language === "he" ? "הצטרפות למשחק" : "Join game"}
      </button>
    </form>
  );
}
