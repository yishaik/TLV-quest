"use client";

import { FormEvent, useState } from "react";

type CreatedRun = {
  publicCode: string;
  joinUrl: string;
  manageUrl: string;
  liveUrl: string;
};

export function CreateRunForm({ inviteToken }: { inviteToken: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedRun | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inviteToken,
          scheduledAt: form.get("scheduledAt") || null,
          routeMode: form.get("routeMode"),
          startMode: form.get("startMode"),
          scoringMode: form.get("scoringMode"),
          teamMode: form.get("teamMode"),
          localeDefault: form.get("localeDefault"),
          maxParticipants: Number(form.get("maxParticipants")),
          maxTeams: Number(form.get("maxTeams")),
          desiredTeamSize: Number(form.get("desiredTeamSize")),
          graceMinutes: Number(form.get("graceMinutes")),
          organizerEmail: form.get("organizerEmail"),
          organizerPhone: form.get("organizerPhone"),
          settings: {
            routeLength: form.get("routeLength"),
            accessibilityMode: form.get("accessibilityMode"),
            boardVisibility: form.get("boardVisibility"),
            whatsappRequirement: form.get("whatsappRequirement")
          }
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "יצירת המשחק נכשלה");
      }
      setCreated(payload.data);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "שגיאה לא צפויה");
    } finally {
      setLoading(false);
    }
  }

  if (created) {
    return (
      <div className="grid">
        <div className="success">
          המשחק נוצר. שמרו את קישור הניהול במקום בטוח — לא ניתן לשחזר אותו
          לאחר מחיקת הנתונים.
        </div>
        <div className="card">
          <h2>קוד משחק: {created.publicCode}</h2>
          <p className="field-label">קישור הרשמה</p>
          <div className="code">{created.joinUrl}</div>
          <p className="field-label">קישור ניהול סודי</p>
          <div className="code">{created.manageUrl}</div>
          <p className="field-label">לוח חי</p>
          <div className="code">{created.liveUrl}</div>
          <div className="actions">
            <a className="button button-primary" href={created.manageUrl}>
              מעבר לניהול
            </a>
            <a className="button button-secondary" href={created.joinUrl}>
              בדיקת הרשמה
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form className="card form-grid" onSubmit={submit}>
      {!inviteToken && (
        <div className="error">
          חסר קישור הזמנה תקף. יצירת משחק בפיילוט זמינה רק דרך הזמנה חד־פעמית.
        </div>
      )}

      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="scheduledAt">מועד המשחק</label>
          <input id="scheduledAt" name="scheduledAt" type="datetime-local" />
        </div>
        <div className="field">
          <label htmlFor="localeDefault">שפת ברירת מחדל</label>
          <select id="localeDefault" name="localeDefault" defaultValue="he">
            <option value="he">עברית</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="teamMode">מבנה תחרות</label>
          <select id="teamMode" name="teamMode" defaultValue="automatic">
            <option value="automatic">חלוקה אוטומטית</option>
            <option value="preassigned">קבוצות מוכנות</option>
            <option value="solo">יחידים</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="desiredTeamSize">גודל קבוצה רצוי</label>
          <input id="desiredTeamSize" name="desiredTeamSize" type="number" min="1" max="8" defaultValue="4" />
        </div>
      </div>

      <div className="grid grid-3">
        <div className="field">
          <label htmlFor="routeMode">מבנה מסלול</label>
          <select id="routeMode" name="routeMode" defaultValue="circular">
            <option value="circular">מעגלי</option>
            <option value="linear">קווי</option>
            <option value="free">חופשי</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="startMode">התחלה</label>
          <select id="startMode" name="startMode" defaultValue="scheduled">
            <option value="scheduled">מתוזמנת</option>
            <option value="manual">ידנית</option>
            <option value="rolling">מתגלגלת</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="scoringMode">ניקוד</label>
          <select id="scoringMode" name="scoringMode" defaultValue="combined">
            <option value="combined">משולב</option>
            <option value="completion">השלמה</option>
            <option value="time">זמן</option>
          </select>
        </div>
      </div>

      <details>
        <summary className="field-label">הגדרות מתקדמות</summary>
        <div className="form-grid" style={{ marginTop: 18 }}>
          <div className="grid grid-3">
            <div className="field">
              <label htmlFor="maxParticipants">משתתפים מרביים</label>
              <input id="maxParticipants" name="maxParticipants" type="number" min="1" max="30" defaultValue="30" />
            </div>
            <div className="field">
              <label htmlFor="maxTeams">קבוצות מרביות</label>
              <input id="maxTeams" name="maxTeams" type="number" min="1" max="10" defaultValue="10" />
            </div>
            <div className="field">
              <label htmlFor="graceMinutes">חלון הצטרפות מאוחרת</label>
              <input id="graceMinutes" name="graceMinutes" type="number" min="0" max="120" defaultValue="10" />
            </div>
          </div>

          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="routeLength">אורך</label>
              <select id="routeLength" name="routeLength" defaultValue="short">
                <option value="short">קצר · Vertical Slice</option>
                <option value="full">מלא</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="accessibilityMode">נגישות</label>
              <select id="accessibilityMode" name="accessibilityMode" defaultValue="regular">
                <option value="regular">רגיל</option>
                <option value="accessible">נגיש</option>
              </select>
            </div>
          </div>

          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="boardVisibility">לוח חי</label>
              <select id="boardVisibility" name="boardVisibility" defaultValue="ranking_status">
                <option value="ranking">דירוג בלבד</option>
                <option value="ranking_status">דירוג וסטטוס</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="whatsappRequirement">WhatsApp</label>
              <select id="whatsappRequirement" name="whatsappRequirement" defaultValue="one_per_team">
                <option value="all">חובה לכולם</option>
                <option value="one_per_team">אחד לפחות בקבוצה</option>
                <option value="optional">אופציונלי</option>
              </select>
            </div>
          </div>
        </div>
      </details>

      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="organizerEmail">אימייל מארגן</label>
          <input id="organizerEmail" name="organizerEmail" type="email" autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="organizerPhone">טלפון מארגן</label>
          <input id="organizerPhone" name="organizerPhone" type="tel" autoComplete="tel" />
        </div>
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      <button className="button button-primary" disabled={loading || !inviteToken}>
        {loading ? "יוצר משחק…" : "יצירת המשחק"}
      </button>
    </form>
  );
}
