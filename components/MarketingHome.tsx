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
      ["#city", "פרק 1", "העיר"],
      ["#play", "פרק 2", "המשחק"],
      ["#route", "פרק 3", "המסלול"]
    ] as const,
    resume: "המשך משחק",
    kicker: "משחק חקירה עצמאי בנמל תל אביב",
    titleA: "תל אביב",
    titleB: "משאירה רמזים.",
    lede:
      "אתם מביאים את האנשים. העיר מספקת את הסיפור. TLV Quest הופך רחובות, פסלים ומבנים למשחק חי שמתקדם דרך הטלפון.",
    cta: "צרו משחק חינם",
    ctaSub: "בלי תשלום ובלי תיאום. קישור המשחק נוצר מיד.",
    scroll: "גלו איך זה עובד",
    heroTag: "הנמל / תל אביב / עכשיו",
    cityEyebrow: "פרק 1 — העיר",
    cityTitle: "לוח המשחק כבר בנוי.",
    cityBody:
      "לא צריך תפאורה, מפעיל או אפליקציה להורדה. כל פרט בסביבה יכול להפוך לרמז, וכל תחנה דוחפת את הקבוצה עמוק יותר לתוך הסיפור.",
    factStops: "תחנות במסלול",
    factDistance: "ק״מ הליכה",
    factField: "אימות בשטח",
    factFieldValue: "כל תחנה",
    playEyebrow: "פרק 2 — המשחק",
    playTitle: "שלושה צעדים. אפס תפעול.",
    how: [
      ["יוצרים משחק", "בוחרים גודל קבוצה ומספר תחנות. הקישורים נוצרים מיד."],
      ["משתפים את המשתתפים", "כל אחד מצטרף מהטלפון. אין התקנה ואין חשבון חדש."],
      ["יוצאים לחקור", "חידות, רמזים, ניקוד ולוח תוצאות מתקדמים אוטומטית."]
    ] as const,
    routeEyebrow: "פרק 3 — המסלול",
    routeTitle: "הסיפור כתוב על העיר עצמה.",
    routeBody:
      "התחנות אינן רק רקע לתמונה. צריך להתבונן, להתקרב ולחבר בין פרטים אמיתיים כדי להתקדם.",
    routeFallback: "תמונות המסלול יופיעו כאן לאחר פרסום התחנות.",
    bookEyebrow: "התחילו עכשיו",
    bookTitle: "העיר מחכה לקבוצה שלכם.",
    bookBody:
      "צרו משחק עצמאי בנמל תל אביב וקבלו מיד קישור הצטרפות, קישור ניהול ולוח תוצאות חי.",
    freeBadge: "חינם · לזמן מוגבל",
    freeNote: "עד שלושה משחקים לכל נרשם",
    bigEvent: "מארגנים יום הולדת, ערב חברה או אירוע גדול?",
    bigEventCta: "בנו לנו משחק מותאם",
    footerLine: "נוצר בתל אביב. משוחק בעולם האמיתי.",
    mobileCta: "צרו משחק"
  },
  en: {
    langLink: "/",
    langLabel: "עב",
    navLabel: "Page navigation",
    nav: [
      ["#city", "Ch. 1", "The city"],
      ["#play", "Ch. 2", "The game"],
      ["#route", "Ch. 3", "The route"]
    ] as const,
    resume: "Resume game",
    kicker: "A self-guided investigation at Tel Aviv Port",
    titleA: "Tel Aviv",
    titleB: "leaves clues.",
    lede:
      "You bring the people. The city provides the story. TLV Quest turns streets, sculptures and buildings into a live game that runs through your phone.",
    cta: "Create a free game",
    ctaSub: "No payment and no scheduling. Your game links appear instantly.",
    scroll: "See how it works",
    heroTag: "The port / Tel Aviv / Now",
    cityEyebrow: "Chapter 1 — The city",
    cityTitle: "The game board already exists.",
    cityBody:
      "No scenery, host or download required. Every detail in the environment can become a clue, and every stop pulls the team further into the story.",
    factStops: "Stops on the route",
    factDistance: "Kilometres on foot",
    factField: "Field verification",
    factFieldValue: "Every stop",
    playEyebrow: "Chapter 2 — The game",
    playTitle: "Three steps. Zero operations.",
    how: [
      ["Create the game", "Choose group size and route length. The links are generated immediately."],
      ["Share with the players", "Everyone joins on their phone. No installation and no new account."],
      ["Go investigate", "Riddles, hints, scoring and the live leaderboard advance automatically."]
    ] as const,
    routeEyebrow: "Chapter 3 — The route",
    routeTitle: "The story is written on the city itself.",
    routeBody:
      "The stops are not photo backdrops. Players must look closer, move around and connect real details to advance.",
    routeFallback: "Route photography will appear here when stops are published.",
    bookEyebrow: "Start now",
    bookTitle: "The city is waiting for your team.",
    bookBody:
      "Create a self-guided Tel Aviv Port game and instantly receive a participant link, management link and live leaderboard.",
    freeBadge: "Free · limited time",
    freeNote: "Up to three games per person",
    bigEvent: "Planning a birthday, company evening or larger event?",
    bigEventCta: "Build us a custom quest",
    footerLine: "Created in Tel Aviv. Played in the real world.",
    mobileCta: "Create game"
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
  const photoStops = (route?.stops ?? []).filter((stop) => stop.photo).slice(0, 6);
  const distance = route ? (route.metres / 1000).toFixed(1) : "—";

  return (
    <main className="mk" dir={rtl ? "rtl" : "ltr"}>
      <header className="mk-topbar">
        <a className="mk-logo" href="#top" aria-label="TLV Quest">
          <span>TLV</span> QUEST
        </a>

        <nav className="mk-nav" aria-label={c.navLabel}>
          {c.nav.map(([href, chapter, label]) => (
            <a key={href} href={href}>
              <small>{chapter}</small>
              <span>{label}</span>
            </a>
          ))}
        </nav>

        <div className="mk-top-actions">
          <Link className="mk-resume" href="/resume">
            {c.resume} ↗
          </Link>
          <Link className="mk-lang" href={c.langLink}>
            {c.langLabel}
          </Link>
        </div>
      </header>

      <section className="mk-hero" id="top">
        <div className="mk-hero-copy">
          <p className="mk-kicker">{c.kicker}</p>
          <h1>
            <span>{c.titleA}</span>
            <strong>{c.titleB}</strong>
          </h1>
          <p className="mk-lede">{c.lede}</p>
          <div className="mk-hero-actions">
            <a className="mk-primary" href="#book">
              {c.cta} <span aria-hidden="true">↗</span>
            </a>
            <small>{c.ctaSub}</small>
          </div>
        </div>

        <div className={`mk-hero-media${route?.heroPhoto ? " has-photo" : ""}`}>
          {route?.heroPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={route.heroPhoto} alt="" fetchPriority="high" />
          ) : (
            <div className="mk-hero-placeholder" aria-hidden="true">
              <span>32°05′N</span>
              <strong>TLV</strong>
              <span>34°46′E</span>
            </div>
          )}
          <span className="mk-media-tag">{c.heroTag}</span>
          <span className="mk-media-mark" aria-hidden="true">+</span>
        </div>

        <a className="mk-scroll" href="#city">
          <span>{c.scroll}</span>
          <span aria-hidden="true">↓</span>
        </a>
      </section>

      <section className="mk-chapter mk-city" id="city">
        <div className="mk-chapter-head">
          <p>{c.cityEyebrow}</p>
          <span aria-hidden="true">01</span>
        </div>
        <div className="mk-statement">
          <h2>{c.cityTitle}</h2>
          <p>{c.cityBody}</p>
        </div>
        <div className="mk-facts">
          <div>
            <strong>{route?.stops.length ?? "—"}</strong>
            <span>{c.factStops}</span>
          </div>
          <div>
            <strong>{distance}</strong>
            <span>{c.factDistance}</span>
          </div>
          <div>
            <strong>{c.factFieldValue}</strong>
            <span>{c.factField}</span>
          </div>
        </div>
      </section>

      <section className="mk-chapter mk-play" id="play">
        <div className="mk-chapter-head">
          <p>{c.playEyebrow}</p>
          <span aria-hidden="true">02</span>
        </div>
        <h2>{c.playTitle}</h2>
        <div className="mk-steps">
          {c.how.map(([title, text], index) => (
            <article key={title}>
              <span className="mk-step-number">0{index + 1}</span>
              <h3>{title}</h3>
              <p>{text}</p>
              <span className="mk-step-arrow" aria-hidden="true">↗</span>
            </article>
          ))}
        </div>
      </section>

      <section className="mk-chapter mk-route" id="route">
        <div className="mk-chapter-head">
          <p>{c.routeEyebrow}</p>
          <span aria-hidden="true">03</span>
        </div>
        <div className="mk-route-intro">
          <h2>{c.routeTitle}</h2>
          <p>{c.routeBody}</p>
        </div>

        {photoStops.length > 0 ? (
          <div className="mk-gallery" aria-label={rtl ? "תחנות במסלול" : "Route stops"}>
            {photoStops.map((stop, index) => (
              <figure key={stop.slug} className={index === 0 ? "mk-gallery-featured" : undefined}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={stop.photo ?? ""} alt={stop.name} loading="lazy" />
                <figcaption>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{stop.name}</strong>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="mk-gallery-empty">{c.routeFallback}</p>
        )}
      </section>

      <section className="mk-book" id="book">
        <div className="mk-book-copy">
          <p className="mk-book-eyebrow">{c.bookEyebrow}</p>
          <h2>{c.bookTitle}</h2>
          <p>{c.bookBody}</p>
          <div className="mk-book-meta">
            <strong>{c.freeBadge}</strong>
            <span>{c.freeNote}</span>
          </div>
        </div>

        <div className="mk-book-form">
          {route ? (
            <FreeBookingForm
              locale={locale}
              templateSlug={route.slug}
              checkpointCount={route.stops.length}
            />
          ) : (
            <p className="mk-gallery-empty">{c.routeFallback}</p>
          )}
        </div>

        <details className="mk-lead">
          <summary>
            <span>{c.bigEvent}</span>
            <strong>{c.bigEventCta} ↗</strong>
          </summary>
          <LeadCaptureForm locale={locale} />
        </details>
      </section>

      <footer className="mk-footer">
        <a className="mk-logo" href="#top">
          <span>TLV</span> QUEST
        </a>
        <p>{c.footerLine}</p>
        <div>
          <Link href="/resume">{c.resume} ↗</Link>
          <small>© 2026 TLV Quest</small>
        </div>
      </footer>

      <a className="mk-mobile-cta" href="#book">
        {c.mobileCta} <span aria-hidden="true">↗</span>
      </a>
    </main>
  );
}
