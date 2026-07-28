import Link from "next/link";

const features = [
  ["בלי מפעיל", "הרשמה, קבוצות, הודעות, רמזים, ניקוד וסיום מתנהלים אוטומטית."],
  ["מסע היברידי", "WhatsApp, Web App, QR, NFC, מיקום ותמונות באותה חוויה."],
  ["תחרות חיה", "לוח תוצאות בזמן אמת, בלי לחשוף מיקום מדויק או מידע אישי."]
];

export default function HomePage() {
  return (
    <main className="site-shell page">
      <section className="hero">
        <div>
          <span className="badge">Vertical Slice · נמל תל אביב</span>
          <h1>העיר הופכת למשחק.</h1>
          <p>
            מסע תחרותי בעקבות קפסולת זמן שנעלמה בנמל תל אביב. המשתתפים
            מצטרפים בקישור, מתחלקים לקבוצות ויוצאים לדרך — והמערכת מנהלת את
            הכול בעצמה.
          </p>
          <div className="actions">
            <Link className="button button-primary" href="/create">
              יצירת פיילוט
            </Link>
            <Link className="button button-secondary" href="/live/DEMO">
              תצוגת לוח חי
            </Link>
          </div>
        </div>
        <div className="hero-art" aria-label="Illustration of the TLV Quest time capsule">
          <div className="time-capsule" />
        </div>
      </section>

      <section className="grid grid-3" aria-label="Product capabilities">
        {features.map(([title, description]) => (
          <article className="card" key={title}>
            <h2>{title}</h2>
            <p className="muted">{description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
