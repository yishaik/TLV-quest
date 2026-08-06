import Link from "next/link";
import { FreeBookingForm } from "@/components/FreeBookingForm";
import { LeadCaptureForm } from "@/components/LeadCaptureForm";
import type { MarketingRoute } from "@/lib/marketing-route";

type Locale = "he" | "en";

const copy = {
  he: {
    langLink: "/?lang=en",
    langLabel: "EN",
    navLabel: "ניווט בעמוד",
    nav: [
      ["#model", "01", "הרעיון"],
      ["#work", "02", "המשחק"],
      ["#terms", "03", "המסלול"],
      ["#questions", "04", "שאלות"]
    ] as const,
    apply: "צרו משחק ←",
    resume: "המשך משחק",
    heroKicker: "משחק רחוב עצמאי · נמל תל אביב",
    heroA: "העיר היתה כאן",
    heroB: "כל הזמן.",
    heroSub: "פשוט עוד לא שיחקתם בה.",
    heroBody:
      "TLV Quest הופך רחובות, מבנים ופרטים אמיתיים למשחק חקירה חי שמתקדם דרך הטלפון.",
    heroCta: "צרו משחק חינם",
    heroAside: "בלי אפליקציה. בלי מפעיל. בלי תיאום.",
    revealLabel: "העיר / נחשפת",
    manifesto: ["מוצאים את הרמז.", "פותרים את העיר.", "מתקדמים יחד."],
    manifestoBody:
      "קבוצה אחת, טלפון אחד ומסלול שהעיר עצמה כתבה. כל תחנה דורשת להסתכל אחרת על המקום שבו אתם כבר עומדים.",
    modelKicker: "פרק 01 · הרעיון",
    modelTitle: "הרחוב הוא הממשק.",
    modelBody:
      "אין תפאורה ואין מסכים שמחליפים את העולם האמיתי. המשחק משתמש במה שכבר נמצא סביבכם: כתובות, פסלים, מבנים, קווי חוף וסיפורים מקומיים.",
    stops: "תחנות",
    distance: "ק״מ",
    verified: "מאומת בשטח",
    verifiedValue: "הכול",
    workKicker: "פרק 02 · המשחק",
    workTitle: "כל מה שצריך כדי לצאת לדרך, במערכת אחת.",
    workItems: [
      ["יוצרים", "שם, אימייל, גודל קבוצה ומספר תחנות. קישורי המשחק נוצרים מיד."],
      ["משתפים", "המשתתפים נכנסים מהטלפון. אין הורדה, הרשמה או הכנה מוקדמת."],
      ["משחקים", "חידות, רמזים, ניקוד ולוח תוצאות מתקדמים אוטומטית." ]
    ] as const,
    zero: "0",
    zeroLabel: "מפעילים שצריך להזמין",
    termsKicker: "פרק 03 · המסלול",
    termsTitle: "לא רק לראות את תל אביב. לקרוא אותה.",
    termsBody:
      "המסלול בנוי מפרטים אמיתיים שנבדקו בשטח. התשובות אינן בתוך האפליקציה — הן מחכות ברחוב.",
    routeFallback: "תמונות המסלול יוצגו לאחר פרסום התחנות.",
    termsFacts: ["משחק עצמאי", "עד 30 משתתפים", "כ־90 דקות", "טלפון אחד לכל צוות"] as const,
    questionsKicker: "פרק 04 · שאלות",
    questionsTitle: "נשאל לפני שמתחילים.",
    faq: [
      ["צריך להוריד אפליקציה?", "לא. המשחק פועל בדפדפן ונפתח מקישור רגיל."],
      ["צריך לתאם שעה מראש?", "לא. יוצרים משחק ומקבלים את הקישורים מיד."],
      ["כמה אנשים יכולים לשחק?", "המשחק העצמאי מתאים לקבוצות של עד 30 משתתפים."],
      ["מה קורה אם נתקעים?", "בכל תחנה קיימים רמזים, והמערכת ממשיכה לנהל ניקוד והתקדמות." ]
    ] as const,
    applicationKicker: "הבקשה",
    applicationTitle: "ספרו לנו מי יוצא לחפש.",
    applicationBody:
      "צרו משחק חינם וקבלו מיד קישור למשתתפים, קישור ניהול ולוח תוצאות חי.",
    freeBadge: "חינם · לזמן מוגבל",
    freeNote: "עד שלושה משחקים לכל נרשם",
    bigEvent: "אירוע גדול, יום הולדת או ערב חברה?",
    bigEventCta: "בקשת משחק מותאם",
    footer: "TLV QUEST · נוצר בתל אביב · משוחק בעולם האמיתי"
  },
  en: {
    langLink: "/",
    langLabel: "עב",
    navLabel: "Page navigation",
    nav: [
      ["#model", "01", "The model"],
      ["#work", "02", "The game"],
      ["#terms", "03", "The route"],
      ["#questions", "04", "Questions"]
    ] as const,
    apply: "Create a game →",
    resume: "Resume game",
    heroKicker: "A self-guided street game · Tel Aviv Port",
    heroA: "The city was here",
    heroB: "all along.",
    heroSub: "You just had not played it yet.",
    heroBody:
      "TLV Quest turns streets, buildings and real-world details into a live investigation that runs through your phone.",
    heroCta: "Create a free game",
    heroAside: "No app. No host. No scheduling.",
    revealLabel: "The city / revealed",
    manifesto: ["Find the clue.", "Solve the city.", "Move together."],
    manifestoBody:
      "One team, one phone and a route written by the city itself. Every stop asks you to see the place you are already standing in differently.",
    modelKicker: "Chapter 01 · The model",
    modelTitle: "The street is the interface.",
    modelBody:
      "There is no scenery and no screen replacing the real world. The game uses what is already around you: signs, sculptures, buildings, coastline and local stories.",
    stops: "Stops",
    distance: "KM",
    verified: "Field verified",
    verifiedValue: "All of it",
    workKicker: "Chapter 02 · The game",
    workTitle: "Everything needed to head out, in one system.",
    workItems: [
      ["Create", "Name, email, group size and route length. The game links appear immediately."],
      ["Share", "Players join from their phones. No download, account or advance setup."],
      ["Play", "Riddles, hints, scoring and the live leaderboard advance automatically."]
    ] as const,
    zero: "0",
    zeroLabel: "Hosts you need to book",
    termsKicker: "Chapter 03 · The route",
    termsTitle: "Do not just see Tel Aviv. Read it.",
    termsBody:
      "The route is built from real details verified in the field. The answers are not inside the app — they are waiting in the street.",
    routeFallback: "Route photography will appear after stops are published.",
    termsFacts: ["Self-guided", "Up to 30 players", "About 90 minutes", "One phone per team"] as const,
    questionsKicker: "Chapter 04 · Questions",
    questionsTitle: "Asked before you begin.",
    faq: [
      ["Do we need to install an app?", "No. The game runs in the browser and opens from a normal link."],
      ["Do we need to schedule a time?", "No. Create a game and receive the links immediately."],
      ["How many people can play?", "The self-guided game supports groups of up to 30 participants."],
      ["What happens if we get stuck?", "Hints are available at every stop, while the system keeps scoring and progress running."]
    ] as const,
    applicationKicker: "The application",
    applicationTitle: "Tell us who is going looking.",
    applicationBody:
      "Create a free game and instantly receive a participant link, management link and live leaderboard.",
    freeBadge: "Free · limited time",
    freeNote: "Up to three games per person",
    bigEvent: "A larger event, birthday or company evening?",
    bigEventCta: "Request a custom quest",
    footer: "TLV QUEST · CREATED IN TEL AVIV · PLAYED IN THE REAL WORLD"
  }
} as const;

export function MarketingHome({
  locale,
  route
}: {
  locale: Locale;
  route: MarketingRoute | null;
}) {
  const c = copy[locale];
  const rtl = locale === "he";
  const photoStops = (route?.stops ?? []).filter((stop) => stop.photo);
  const coverPhoto = route?.heroPhoto ?? photoStops[0]?.photo ?? null;
  const secondaryPhoto = photoStops[1]?.photo ?? photoStops[0]?.photo ?? null;
  const distance = route ? (route.metres / 1000).toFixed(1) : "—";

  return (
    <main className="pq" dir={rtl ? "rtl" : "ltr"}>
      <header className="pq-header">
        <a className="pq-logo" href="#top" aria-label="TLV Quest home">
          TLV<span>Q</span>
        </a>

        <nav className="pq-nav" aria-label={c.navLabel}>
          {c.nav.map(([href, number, label]) => (
            <a key={href} href={href}>
              <small>{number}</small>
              <span>{label}</span>
            </a>
          ))}
        </nav>

        <div className="pq-header-actions">
          <Link href="/resume">{c.resume}</Link>
          <Link href={c.langLink}>{c.langLabel}</Link>
          <a className="pq-apply-link" href="#apply">{c.apply}</a>
        </div>
      </header>

      <section className="pq-hero" id="top">
        <div className="pq-hero-topline">
          <span>{c.heroKicker}</span>
          <span>32°05′N / 34°46′E</span>
        </div>

        <div className="pq-hero-title">
          <h1>
            <span>{c.heroA}</span>
            <strong>{c.heroB}</strong>
          </h1>
          <p>{c.heroSub}</p>
        </div>

        <div className="pq-hero-bottom">
          <p>{c.heroBody}</p>
          <div>
            <a href="#apply">{c.heroCta} <span aria-hidden="true">↗</span></a>
            <small>{c.heroAside}</small>
          </div>
        </div>

        <div className="pq-orbit pq-orbit-one" aria-hidden="true" />
        <div className="pq-orbit pq-orbit-two" aria-hidden="true" />
      </section>

      <section className="pq-reveal" aria-label={c.revealLabel}>
        <div className="pq-reveal-copy">
          <span>{c.revealLabel}</span>
          <strong>TLV</strong>
          <span>QUEST</span>
        </div>
        <div className={`pq-reveal-media${coverPhoto ? " has-photo" : ""}`}>
          {coverPhoto && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverPhoto} alt="" loading="eager" />
          )}
          <div className="pq-scanline" aria-hidden="true" />
        </div>
      </section>

      <section className="pq-manifesto">
        <div className="pq-manifesto-lines">
          {c.manifesto.map((line, index) => (
            <p key={line} style={{ "--line": index } as React.CSSProperties}>{line}</p>
          ))}
        </div>
        <p className="pq-manifesto-body">{c.manifestoBody}</p>
      </section>

      <section className="pq-section pq-model" id="model">
        <div className="pq-section-index">
          <span>01</span>
          <p>{c.modelKicker}</p>
        </div>

        <div className="pq-model-copy">
          <h2>{c.modelTitle}</h2>
          <p>{c.modelBody}</p>
        </div>

        <div className="pq-model-visual">
          <div className="pq-map-grid" aria-hidden="true">
            <span className="pq-map-point point-a" />
            <span className="pq-map-point point-b" />
            <span className="pq-map-point point-c" />
            <span className="pq-map-path" />
          </div>
          <div className="pq-model-facts">
            <div><strong>{route?.stops.length ?? "—"}</strong><span>{c.stops}</span></div>
            <div><strong>{distance}</strong><span>{c.distance}</span></div>
            <div><strong>{c.verifiedValue}</strong><span>{c.verified}</span></div>
          </div>
        </div>
      </section>

      <section className="pq-section pq-work" id="work">
        <div className="pq-section-index">
          <span>02</span>
          <p>{c.workKicker}</p>
        </div>

        <div className="pq-work-heading">
          <h2>{c.workTitle}</h2>
          <div className="pq-zero">
            <strong>{c.zero}</strong>
            <span>{c.zeroLabel}</span>
          </div>
        </div>

        <div className="pq-work-list">
          {c.workItems.map(([title, body], index) => (
            <article key={title}>
              <span>0{index + 1}</span>
              <h3>{title}</h3>
              <p>{body}</p>
              <b aria-hidden="true">↗</b>
            </article>
          ))}
        </div>
      </section>

      <section className="pq-section pq-terms" id="terms">
        <div className="pq-section-index">
          <span>03</span>
          <p>{c.termsKicker}</p>
        </div>

        <div className="pq-terms-copy">
          <h2>{c.termsTitle}</h2>
          <p>{c.termsBody}</p>
          <ul>
            {c.termsFacts.map((fact) => <li key={fact}>{fact}</li>)}
          </ul>
        </div>

        <div className="pq-terms-media">
          {secondaryPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={secondaryPhoto} alt="" loading="lazy" />
          ) : (
            <p>{c.routeFallback}</p>
          )}
          <span aria-hidden="true">+</span>
          <span aria-hidden="true">+</span>
        </div>
      </section>

      <section className="pq-section pq-questions" id="questions">
        <div className="pq-section-index">
          <span>04</span>
          <p>{c.questionsKicker}</p>
        </div>

        <h2>{c.questionsTitle}</h2>
        <div className="pq-faq">
          {c.faq.map(([question, answer], index) => (
            <details key={question} open={index === 0}>
              <summary>
                <span>{question}</span>
                <b aria-hidden="true">+</b>
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="pq-application" id="apply">
        <div className="pq-application-copy">
          <p>{c.applicationKicker}</p>
          <h2>{c.applicationTitle}</h2>
          <span>{c.applicationBody}</span>
          <div>
            <strong>{c.freeBadge}</strong>
            <small>{c.freeNote}</small>
          </div>
        </div>

        <div className="pq-application-form">
          {route ? (
            <FreeBookingForm
              locale={locale}
              templateSlug={route.slug}
              checkpointCount={route.stops.length}
            />
          ) : (
            <p>{c.routeFallback}</p>
          )}
        </div>

        <details className="pq-private">
          <summary>
            <span>{c.bigEvent}</span>
            <strong>{c.bigEventCta} ↗</strong>
          </summary>
          <LeadCaptureForm locale={locale} />
        </details>
      </section>

      <footer className="pq-footer">
        <span>{c.footer}</span>
        <span>© 2026</span>
      </footer>

      <a className="pq-mobile-apply" href="#apply">{c.apply}</a>
    </main>
  );
}
