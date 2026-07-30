import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="page narrow">
      <span className="badge">OFFLINE</span>
      <h1 className="page-title">האות נקטע / Signal interrupted</h1>
      <p>
        אם המסע כבר פתוח בלשונית אחרת, אפשר להמשיך לראות את התחנה האחרונה
        שנשמרה. פעולות חדשות יישלחו רק לאחר שהחיבור יחזור.
      </p>
      <p>
        If your quest is already open in another tab, its last saved checkpoint
        remains visible. New actions require a connection.
      </p>
      <Link className="button button-primary" href="/resume">
        ניסיון חיבור מחדש / Reconnect
      </Link>
    </main>
  );
}
