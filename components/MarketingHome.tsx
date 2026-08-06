import Link from "next/link";
import { FreeBookingForm } from "@/components/FreeBookingForm";
import { LeadCaptureForm } from "@/components/LeadCaptureForm";
import { ScrollFilm, type ScrollFilmScene } from "@/components/ScrollFilm";
import type { MarketingRoute } from "@/lib/marketing-route";

type Locale = "he" | "en";

const copy = {
  he: {
    langLink: "/?lang=en",
    langLabel: "EN",
    resume: "המשך משחק",
    navStory: "הסיפור",
    navRoute: "המסלול",
    navStart: "התחלה",
    scrollLabel: "המשיכו לגלול",
    scenes: [
      {
        id: "city",
        chapter: "פרק 1 — העיר",
        title: "העיר היא לוח המשחק.",
        body: "לא נכנסים לעולם אחר. פשוט מתחילים לראות את תל אביב אחרת."
      },
      {
        id: "clues",
        chapter: "פרק 2 — הרמזים",
        title: "כל פרט יכול להיות רמז.",
        body: "פסל, שלט, חלון או קו על הרצפה הופכים לחלק מהעלילה."
      },
      {
        id: "system",
        chapter: "פרק 3 — המערכת",
        title: "הטלפון מריץ הכול.",
        body: "חידות, רמזים, ניקוד ולוח תוצאות מתקדמים בזמן אמת."
      },
      {
        id: "play",
        chapter: "פרק 4 — אתם",
        title: "אתם רק יוצאים לשחק.",
        body: "קישור אחד, קבוצה אחת, והעיר מתחילה לזוז סביבכם."
      }
    ] as const,
    proofEyebrow: "TLV Quest / נמל תל אביב",
    proofTitle: "לא צופים בעיר. נכנסים לתוכה.",
    proofBody:
      "הגלילה נגמרת, אבל המשחק רק מתחיל. המסלול משתמש בפרטים אמיתיים שכבר נמצאים ברחוב ומחבר אותם לחוויה אחת רציפה.",
    stopsMetric: "תחנות",
    distanceMetric: "ק״מ הליכה",
    fieldMetric: "אימות בשטח",
    fieldValue: "100%",
    routeTitle: "הפריימים שראיתם הם מקומות אמיתיים במסלול.",
    routeFallback: "תמונות המסלול יופיעו לאחר פרסום התחנות.",
    bookEyebrow: "התחילו עכשיו",
    bookTitle: "הפכו את העיר למשחק.",
    bookBody:
      "צרו משחק עצמאי וקבלו מיד קישור משתתפים, קישור ניהול ולוח תוצאות חי.",
    freeBadge: "חינם · לזמן מוגבל",
    freeNote: "עד שלושה משחקים לכל נרשם",
    bigEvent: "מארגנים יום הולדת, ערב חברה או אירוע גדול?",
    bigEventCta: "בקשו משחק מותאם",
    footer: "נוצר בתל אביב. משוחק בעולם האמיתי."
  },
  en: {
    langLink: "/",
    langLabel: "עב",
    resume: "Resume game",
    navStory: "The story",
    navRoute: "The route",
    navStart: "Start",
    scrollLabel: "Keep scrolling",
    scenes: [
      {
        id: "city",
        chapter: "Chapter 1 — The city",
        title: "The city is the game board.",
        body: "You do not enter another world. You start seeing Tel Aviv differently."
      },
      {
        id: "clues",
        chapter: "Chapter 2 — The clues",
        title: "Every detail can be a clue.",
        body: "A sculpture, sign, window or line on the ground becomes part of the plot."
      },
      {
        id: "system",
        chapter: "Chapter 3 — The system",
        title: "The phone runs everything.",
        body: "Riddles, hints, scoring and the leaderboard advance in real time."
      },
      {
        id: "play",
        chapter: "Chapter 4 — You",
        title: "You just go out and play.",
        body: "One link, one group, and the city begins moving around you."
      }
    ] as const,
    proofEyebrow: "TLV Quest / Tel Aviv Port",
    proofTitle: "Do not watch the city. Enter it.",
    proofBody:
      "The scroll ends, but the game is only beginning. The route uses real details already present in the street and connects them into one continuous experience.",
    stopsMetric: "Stops",
    distanceMetric: "Km on foot",
    fieldMetric: "Field verified",
    fieldValue: "100%",
    routeTitle: "The frames you saw are real places on the route.",
    routeFallback: "Route photography will appear when stops are published.",
    bookEyebrow: "Start now",
    bookTitle: "Turn the city into a game.",
    bookBody:
      "Create a self-guided game and instantly receive participant, management and live leaderboard links.",
    freeBadge: "Free · limited time",
    freeNote: "Up to three games per person",
    bigEvent: "Planning a birthday, company evening or larger event?",
    bigEventCta: "Request a custom quest",
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

  const photoCandidates = [
    route?.heroPhoto
      ? {
          url: route.heroPhoto,
          alt: route.title[locale] ?? route.title.he ?? route.title.en ?? "TLV Quest"
        }
      : null,
    ...(route?.stops ?? [])
      .filter((stop) => stop.photo)
      .map((stop) => ({ url: stop.photo as string, alt: stop.name }))
  ].filter((photo): photo is { url: string; alt: string } => Boolean(photo));

  const photos = photoCandidates.filter(
    (photo, index, all) => all.findIndex((candidate) => candidate.url === photo.url) === index
  );

  const scenes: ScrollFilmScene[] = c.scenes.map((scene, index) => {
    const photo = photos.length > 0 ? photos[index % photos.length] : null;
    return {
      ...scene,
      image: photo?.url ?? null,
      alt: photo?.alt ?? ""
    };
  });

  const distance = route ? (route.metres / 1000).toFixed(1) : "—";
  const routePhotos = (route?.stops ?? []).filter((stop) => stop.photo).slice(0, 5);

  return (
    <main className="mk" dir={rtl ? "rtl" : "ltr"} id="top">
      <header className="mk-header">
        <a className="mk-logo" href="#top" aria-label="TLV Quest">
          TLV<span>QUEST</span>
        </a>

        <nav className="mk-header-nav" aria-label={rtl ? "ניווט" : "Navigation"}>
          <a href="#story">{c.navStory}</a>
          <a href="#route">{c.navRoute}</a>
          <a href="#book">{c.navStart}</a>
        </nav>

        <div className="mk-header-actions">
          <Link href="/resume">{c.resume}</Link>
          <Link className="mk-lang" href={c.langLink}>
            {c.langLabel}
          </Link>
        </div>
      </header>

      <div id="story">
        <ScrollFilm scenes={scenes} scrollLabel={c.scrollLabel} />
      </div>

      <section className="mk-proof" id="route">
        <div className="mk-proof-copy">
          <p>{c.proofEyebrow}</p>
          <h2>{c.proofTitle}</h2>
          <span>{c.proofBody}</span>
        </div>

        <div className="mk-metrics">
          <div>
            <strong>{route?.stops.length ?? "—"}</strong>
            <span>{c.stopsMetric}</span>
          </div>
          <div>
            <strong>{distance}</strong>
            <span>{c.distanceMetric}</span>
          </div>
          <div>
            <strong>{c.fieldValue}</strong>
            <span>{c.fieldMetric}</span>
          </div>
        </div>

        <div className="mk-route-head">
          <h3>{c.routeTitle}</h3>
        </div>

        {routePhotos.length > 0 ? (
          <div className="mk-route-strip">
            {routePhotos.map((stop, index) => (
              <figure key={stop.slug}>
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
          <p className="mk-empty">{c.routeFallback}</p>
        )}
      </section>

      <section className="mk-book" id="book">
        <div className="mk-book-copy">
          <p>{c.bookEyebrow}</p>
          <h2>{c.bookTitle}</h2>
          <span>{c.bookBody}</span>
          <div className="mk-book-meta">
            <strong>{c.freeBadge}</strong>
            <small>{c.freeNote}</small>
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
            <p className="mk-empty">{c.routeFallback}</p>
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
          TLV<span>QUEST</span>
        </a>
        <p>{c.footer}</p>
        <small>© 2026</small>
      </footer>
    </main>
  );
}
