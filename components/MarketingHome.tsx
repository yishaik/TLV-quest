import Link from "next/link";
import { FreeBookingForm } from "@/components/FreeBookingForm";
import { LeadCaptureForm } from "@/components/LeadCaptureForm";
import type { MarketingRoute } from "@/lib/marketing-route";

type Locale = "he" | "en";

/**
 * One screen of selling, one screen of proof, one form. The previous page ran
 * nine sections deep and described content that had been deleted; this one is
 * deliberately short, and everything factual on it — stop names, distance,
 * photos — comes from the published route, so it cannot claim anything the
 * product does not do.
 */
const copy = {
  he: {
    langLink: "/?lang=en",
    langLabel: "EN",
    kicker: "משחק חקירה ברחובות נמל תל אביב",
    titleA: "הנמל זוכר הכול.",
    titleB: "בואו לגלות מה.",
    lede: "קבוצה אחת, טלפון אחד, שעה וחצי בין העגורן, הפסל והמגדלור. חידות שהתשובות שלהן כתובות על העיר עצמה.",
    cta: "צרו משחק חינם",
    ctaSub: "בלי תשלום, בלי תיאום — הקישורים נוצרים מיד",
    stopsLine: (n: number, km: string) =>
      `${n} תחנות · ${km} ק״מ הליכה · כל תחנה אומתה בשטח`,
    how: [
      ["צרו משחק", "שם, מייל, וכמה אתם. זהו."],
      ["שתפו קישור", "כל מי שמצטרף מקבל את החידות לטלפון."],
      ["צאו לדרך", "ניקוד, רמזים ולוח תוצאות — הכול אוטומטי."]
    ] as const,
    freeBadge: "חינם · לזמן מוגבל",
    freeNote: "עד שלושה משחקים לכל נרשם",
    bigEvent: "מארגנים אירוע גדול או ערב חברה?",
    bigEventCta: "דברו איתנו",
    resume: "כבר באמצע משחק? המשיכו מכאן",
    footer: "נוצר בתל אביב. משוחק בעולם האמיתי."
  },
  en: {
    langLink: "/",
    langLabel: "עב",
    kicker: "A street investigation game at Tel Aviv Port",
    titleA: "The port remembers everything.",
    titleB: "Come find out what.",
    lede: "One team, one phone, ninety minutes between the crane, the statue and the lighthouse. Riddles whose answers are written on the city itself.",
    cta: "Create a free game",
    ctaSub: "No payment, no scheduling — links are generated instantly",
    stopsLine: (n: number, km: string) =>
      `${n} stops · ${km} km on foot · every stop verified in the field`,
    how: [
      ["Create a game", "Name, email, group size. That's it."],
      ["Share a link", "Everyone who joins gets the riddles on their phone."],
      ["Head out", "Scoring, hints and a live leaderboard — all automatic."]
    ] as const,
    freeBadge: "Free · limited time",
    freeNote: "Up to three games per person",
    bigEvent: "Planning a company evening or a big event?",
    bigEventCta: "Talk to us",
    resume: "Mid-game already? Continue here",
    footer: "Created in Tel Aviv. Played in the real world."
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

  return (
    <main className="mk" dir={rtl ? "rtl" : "ltr"}>
      <section
        className="mk-hero"
        style={
          route?.heroPhoto
            ? { backgroundImage: `url(${route.heroPhoto})` }
            : undefined
        }
      >
        <header className="mk-top">
          <span className="mk-logo">TLV QUEST</span>
          <Link className="mk-lang" href={c.langLink}>
            {c.langLabel}
          </Link>
        </header>

        <div className="mk-hero-copy">
          <span className="mk-kicker">{c.kicker}</span>
          <h1>
            {c.titleA}
            <br />
            <em>{c.titleB}</em>
          </h1>
          <p>{c.lede}</p>
          <a className="mk-cta" href="#book">
            {c.cta}
          </a>
          <span className="mk-cta-sub">{c.ctaSub}</span>
          {route && (
            <span className="mk-facts">
              {c.stopsLine(
                route.stops.length,
                (route.metres / 1000).toFixed(1)
              )}
            </span>
          )}
        </div>
      </section>

      {photoStops.length > 0 && (
        <section className="mk-strip" aria-label={rtl ? "תחנות" : "Stops"}>
          {photoStops.map((stop) => (
            <figure key={stop.slug}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={stop.photo ?? ""} alt={stop.name} loading="lazy" />
              <figcaption>{stop.name}</figcaption>
            </figure>
          ))}
        </section>
      )}

      <section className="mk-how">
        {c.how.map(([title, text], index) => (
          <div key={title}>
            <span>{index + 1}</span>
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        ))}
      </section>

      <section className="mk-book" id="book">
        <div className="mk-book-head">
          <span className="mk-badge">{c.freeBadge}</span>
          <h2>{c.cta}</h2>
          <p>{c.freeNote}</p>
        </div>
        {route && <FreeBookingForm locale={locale} templateSlug={route.slug} checkpointCount={route.stops.length} />}
        <details className="mk-lead">
          <summary>
            {c.bigEvent} <strong>{c.bigEventCta}</strong>
          </summary>
          <LeadCaptureForm locale={locale} />
        </details>
      </section>

      <footer className="mk-footer">
        <Link href="/resume">{c.resume} ↗</Link>
        <p>{c.footer}</p>
        <small>© 2026 TLV Quest</small>
      </footer>
    </main>
  );
}
