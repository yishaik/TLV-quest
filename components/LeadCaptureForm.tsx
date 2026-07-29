"use client";

import { FormEvent, useState } from "react";

type Locale = "he" | "en";

const copy = {
  he: {
    name: "שם",
    email: "אימייל",
    phone: "טלפון",
    event: "סוג האירוע",
    participants: "מספר משתתפים משוער",
    date: "תאריך מועדף",
    message: "מה חשוב שנדע?",
    submit: "בקשת הזמנה פרטית",
    sending: "שולח בקשה…",
    success: "הבקשה התקבלה. נחזור אליכם עם הצעה מותאמת.",
    error: "לא הצלחנו לשלוח את הבקשה. נסו שוב בעוד רגע.",
    events: ["יום הולדת", "צוות / חברה", "משפחה", "זוג / חברים", "אחר"]
  },
  en: {
    name: "Name",
    email: "Email",
    phone: "Phone",
    event: "Event type",
    participants: "Estimated participants",
    date: "Preferred date",
    message: "Anything we should know?",
    submit: "Request a private quest",
    sending: "Sending…",
    success: "Your request is in. We will return with a tailored proposal.",
    error: "We could not send the request. Please try again shortly.",
    events: ["Birthday", "Company / team", "Family", "Couple / friends", "Other"]
  }
} as const;

export function LeadCaptureForm({ locale }: { locale: Locale }) {
  const c = copy[locale];
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setSuccess(false);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          phone: form.get("phone"),
          eventType: form.get("eventType"),
          estimatedParticipants: Number(form.get("estimatedParticipants")) || null,
          preferredDate: form.get("preferredDate") || null,
          message: form.get("message"),
          website: form.get("website"),
          locale
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? c.error);
      setSuccess(true);
      setMessage(c.success);
      event.currentTarget.reset();
    } catch (errorValue) {
      setMessage(errorValue instanceof Error ? errorValue.message : c.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="lead-form" onSubmit={submit}>
      <div className="lead-form-grid">
        <label><span>{c.name}</span><input name="name" required minLength={2} maxLength={120} autoComplete="name" /></label>
        <label><span>{c.email}</span><input name="email" required type="email" maxLength={254} autoComplete="email" /></label>
        <label><span>{c.phone}</span><input name="phone" type="tel" maxLength={40} autoComplete="tel" /></label>
        <label><span>{c.event}</span><select name="eventType" defaultValue=""><option value="" disabled>—</option>{c.events.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>{c.participants}</span><input name="estimatedParticipants" type="number" min={1} max={500} inputMode="numeric" /></label>
        <label><span>{c.date}</span><input name="preferredDate" type="date" /></label>
      </div>
      <label className="lead-form-message"><span>{c.message}</span><textarea name="message" maxLength={1500} rows={4} /></label>
      <label className="lead-form-honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      <button className="button marketing-button lead-submit" disabled={busy}>{busy ? c.sending : c.submit}</button>
      {message && <p className={success ? "lead-result success" : "lead-result error"} role="status">{message}</p>}
    </form>
  );
}
