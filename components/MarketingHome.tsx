import Link from "next/link";
import { heroImage, phoneImage, storyImage } from "@/lib/marketing-assets";

type Locale = "he" | "en";

type Copy = {
  nav: string[];
  cta: string;
  heroEyebrow: string;
  heroTitle: React.ReactNode;
  heroText: string;
  heroSecondary: string;
  facts: string[];
  transitionTitle: string;
  transitionText: string;
  whyTitle: string;
  why: Array<[string, string, string]>;
  storyEyebrow: string;
  storyTitle: string;
  storyParagraphs: string[];
  storyHighlight: string;
  howTitle: string;
  how: Array<[string, string]>;
  awaitsTitle: string;
  awaits: Array<[string, string]>;
  audienceTitle: string;
  audience: Array<[string, string]>;
  detailsTitle: string;
  details: Array<[string, string]>;
  faqTitle: string;
  faq: Array<[string, string]>;
  privateEyebrow: string;
  privateTitle: string;
  privateText: string;
  privatePoints: string[];
  finalTitle: string;
  finalText: string;
  contact: string;
};

const copy: Record<Locale, Copy> = {
  he: {
    nav: ["איך זה עובד", "הסיפור", "מה מחכה לכם", "למי זה מתאים", "שאלות נפוצות"],
    cta: "צאו למסע",
    heroEyebrow: "הרפתקה אורבנית חיה בנמל תל אביב",
    heroTitle: <>הנמל מסתיר סיפור.<br />אתם צריכים לפתוח אותו.</>,
    heroText: "אספו את האנשים שלכם וצאו למסע בין הרציפים, המנוף והמגדלור. חפשו רמזים בעולם האמיתי, פענחו קודים, השלימו משימות וגלו מה מסתתר בתוך קפסולת הזמן של הנמל.",
    heroSecondary: "גלו איך זה עובד",
    facts: ["60–90 דקות", "בנמל תל אביב", "לזוגות ולקבוצות", "בלי להוריד אפליקציה"],
    transitionTitle: "לא עוד סיור. לא עוד חדר בריחה.",
    transitionText: "זה הנמל שאתם מכירים — רק שהפעם כל שלט, מבנה ופרט קטן עשויים להיות חלק מהמשחק.",
    whyTitle: "העולם האמיתי הוא לוח המשחק שלכם",
    why: [
      ["◎", "רמזים בעולם האמיתי", "תצטרכו להרים את הראש, למצוא פרטים נסתרים ולהשתמש בנמל עצמו כדי להתקדם."],
      ["⌁", "חידות שלא עוצרות את הקצב", "קודים, תצפיות, צילום ופענוח שנועדו לגרום לכם לחשוב — בלי להרוס את האנרגיה."],
      ["✦", "סיפור שמתגלה בדרך", "כל תחנה חושפת עוד חלק מהתעלומה. רק כשתחברו הכול תוכלו לפתוח את קפסולת הזמן."],
      ["↗", "חוויה שעושים יחד", "תתווכחו, תפספסו משהו ברור, תמצאו אותו ברגע האחרון ותחגגו כאילו הצלתם את העיר."],
    ],
    storyEyebrow: "המשימה שלכם",
    storyTitle: "קפסולת הזמן של נמל תל אביב",
    storyParagraphs: [
      "לפני עשרות שנים הושאר בנמל מסר שנועד להיפתח בעתיד. הזמן עבר, הנמל השתנה — והמפתח לקפסולה התפזר בין המבנים, הסיפורים והסמלים שנותרו מאחור.",
      "עכשיו הרמזים התעוררו מחדש. כדי להשלים את המסע תצטרכו לעקוב אחרי הסימנים, לחשוף את הקודים ולחבר בין הנמל שהיה, הנמל של היום והסיפור שמחכה להתגלות.",
    ],
    storyHighlight: "הנמל הוא המפה. הפרטים הם הרמזים. אתם החוקרים.",
    howTitle: "פותחים קישור. מרימים את הראש. יוצאים לדרך.",
    how: [
      ["01", "אוספים את הקבוצה — מגיעים לנמל עם האנשים שאיתם תרצו לפתור, להתחרות ולצחוק."],
      ["02", "נכנסים למשחק — פותחים קישור בנייד. אין הורדה ואין הרשמה מסובכת."],
      ["03", "מקבלים משימה — סיפור קצר, רמז למיקום ואתגר בעולם האמיתי."],
      ["04", "פותרים ומתקדמים — חידות, צילום, מיקום וקודים פותחים את התחנה הבאה."],
      ["05", "פותחים את הקפסולה — מחברים את כל הרמזים ומגלים אם פיצחתם את הסיפור."],
    ],
    awaitsTitle: "רק כדי שתבינו לאן אתם נכנסים",
    awaits: [
      ["חידות תצפית", "הפתרון נמצא מולכם — אם תסתכלו על הדבר הנכון."],
      ["קודים נסתרים", "מספרים, סמלים ומסרים שמתחבאים בסביבה."],
      ["משימות צילום", "לפעמים תצטרכו להוכיח שמצאתם את המקום הנכון."],
      ["אימותי מיקום", "אי אפשר לפתור את כל המסלול מהספה."],
      ["רמזים חכמים", "אפשר לקבל עזרה, אבל היא עשויה לעלות בנקודות."],
      ["ניקוד חי", "עקבו אחרי ההתקדמות ונסו לסיים מעל כולם."],
    ],
    audienceTitle: "בילוי למי שמחפש משהו קצת אחר",
    audience: [
      ["חברים", "במקום עוד ישיבה בבית קפה — תנועה, תחרות ורגעים שתדברו עליהם אחר כך."],
      ["זוגות", "דייט עם משימה. פחות 'מה עושים עכשיו?', יותר סיפור, תנועה וצחוק."],
      ["משפחות", "הליכה, חשיבה ושיתוף פעולה שמתאימים במיוחד לילדים גדולים ולבני נוער."],
      ["אירועים וקבוצות", "ימי הולדת, קבוצות נוער וצוותים שרוצים פעילות עם מטרה ואנרגיה."],
    ],
    detailsTitle: "לפני שיוצאים לדרך",
    details: [
      ["משך", "כ־60–90 דקות"], ["מיקום", "נמל תל אביב והסביבה"], ["קבוצה מומלצת", "2–6 משתתפים"],
      ["מה להביא", "טלפון טעון ונעליים נוחות"], ["קושי", "נגיש למתחילים, מספק גם לפותרי חידות"], ["שפות", "עברית או אנגלית"],
    ],
    faqTitle: "שאלות לפני שמתחילים",
    faq: [
      ["צריך להוריד אפליקציה?", "לא. המשחק נפתח ישירות בדפדפן בנייד, והודעות חשובות מגיעות גם ב־WhatsApp."],
      ["אפשר לשחק בזוג?", "כן. המשחק מתאים לזוגות, משפחות וקבוצות. קבוצות גדולות יכולות להתחלק לצוותים ולהתחרות."],
      ["צריך להיות טובים בחידות?", "לא. האתגרים מגוונים, נגישים ומבוססים על שיתוף פעולה ותשומת לב לסביבה."],
      ["מה קורה אם נתקעים?", "אפשר לבקש רמז בכל תחנה. הוא יעזור להתקדם, אך עשוי להפחית מהניקוד."],
      ["המשחק מתאים לילדים?", "החוויה מתאימה במיוחד לבני נוער ולמשפחות עם ילדים גדולים."],
      ["אפשר לשחק באנגלית?", "כן. בוחרים עברית או אנגלית לפני תחילת המשחק."],
    ],
    privateEyebrow: "רוצים את הנמל לעצמכם?",
    privateTitle: "אירוע פרטי עם קצת יותר אקשן",
    privateText: "יום הולדת, פעילות צוות, קבוצה משפחתית או מפגש חברים — פתחו הרצה פרטית, חלקו את המשתתפים לצוותים ועקבו אחרי המרוץ בזמן אמת.",
    privatePoints: ["הרצה פרטית", "מספר צוותים", "לוח תוצאות חי", "זמן התחלה מתואם"],
    finalTitle: "מוכנים לראות את נמל תל אביב אחרת?",
    finalText: "אספו את הקבוצה, טענו את הטלפון וצאו למצוא את הסיפור שמסתתר בין הרציפים.",
    contact: "משחק פרטי",
  },
  en: {
    nav: ["How it works", "The story", "What awaits", "Who it’s for", "FAQ"],
    cta: "Start the quest",
    heroEyebrow: "A live urban adventure at Tel Aviv Port",
    heroTitle: <>The port is hiding a story.<br />You have to unlock it.</>,
    heroText: "Gather your people and set out across the boardwalk, the historic crane and the lighthouse. Find real-world clues, crack hidden codes, complete missions and uncover the secret inside the port’s lost time capsule.",
    heroSecondary: "See how it works",
    facts: ["60–90 minutes", "Tel Aviv Port", "For pairs and groups", "No app download"],
    transitionTitle: "Not another tour. Not another escape room.",
    transitionText: "It is the port you already know — except this time, every sign, structure and overlooked detail could be part of the game.",
    whyTitle: "The real world is your game board",
    why: [
      ["◎", "Real-world clues", "Look up, notice hidden details and use the port itself to move forward."],
      ["⌁", "Puzzles that keep moving", "Codes, observations, photography and decoding designed to challenge without killing the pace."],
      ["✦", "A story that unfolds", "Every checkpoint reveals another piece. Connect them all to unlock the time capsule."],
      ["↗", "Built to be shared", "Debate, miss something obvious, find it at the last second and celebrate like you saved the city."],
    ],
    storyEyebrow: "Your mission",
    storyTitle: "The Tel Aviv Port Time Capsule",
    storyParagraphs: [
      "Decades ago, a message was left at the port to be opened in the future. Time passed, the waterfront changed, and the key was scattered among the structures, stories and symbols left behind.",
      "Now the clues have resurfaced. Follow the signs, uncover the codes and connect the port that once was, the port you see today and the story still waiting to be discovered.",
    ],
    storyHighlight: "The port is your map. The details are your clues. You are the investigators.",
    howTitle: "Open the link. Look up. Start exploring.",
    how: [
      ["01", "Gather your team — meet at the port with the people you want beside you."],
      ["02", "Enter the game — open a mobile link. No download and no complicated account."],
      ["03", "Receive a mission — a short story, a location hint and a real-world challenge."],
      ["04", "Solve and progress — puzzles, photos, location and codes unlock the next stop."],
      ["05", "Open the capsule — connect every clue and discover whether you cracked the story."],
    ],
    awaitsTitle: "Just so you know what you’re getting into",
    awaits: [
      ["Observation puzzles", "The answer is in front of you — if you look at the right thing."],
      ["Hidden codes", "Numbers, symbols and messages embedded in the environment."],
      ["Photo missions", "Sometimes you need to prove that you found the right place."],
      ["Location challenges", "There is no solving the entire route from your sofa."],
      ["Smart hints", "Ask for help when stuck, but be ready to sacrifice points."],
      ["Live scoring", "Track progress and try to reach the finish above everyone else."],
    ],
    audienceTitle: "For anyone looking for something different",
    audience: [
      ["Friends", "Swap another café meetup for movement, competition and stories worth retelling."],
      ["Couples", "A date with a mission. Less 'what now?', more story, movement and laughter."],
      ["Families", "Walking, puzzles and teamwork, especially suited to older children and teenagers."],
      ["Groups and events", "Birthdays, youth groups and teams looking for an activity with purpose and energy."],
    ],
    detailsTitle: "Before you set out",
    details: [
      ["Duration", "About 60–90 minutes"], ["Location", "Tel Aviv Port and waterfront"], ["Recommended team", "2–6 participants"],
      ["Bring", "A charged phone and comfortable shoes"], ["Difficulty", "Approachable, with enough challenge for puzzle fans"], ["Languages", "Hebrew or English"],
    ],
    faqTitle: "Questions before you start",
    faq: [
      ["Do I need to download an app?", "No. The quest runs directly in your mobile browser, with important updates also available through WhatsApp."],
      ["Can two people play?", "Yes. It works for couples, families and groups. Larger groups can split into competing teams."],
      ["Do I need to be good at puzzles?", "No. The challenges are varied, approachable and built around teamwork and awareness."],
      ["What if we get stuck?", "Request a hint at any checkpoint. It will help, although it may reduce your score."],
      ["Is it suitable for children?", "The experience is especially suitable for teenagers and families with older children."],
      ["Can we play in English?", "Yes. Select Hebrew or English before the quest begins."],
    ],
    privateEyebrow: "Want the port to yourselves?",
    privateTitle: "A private event with more action",
    privateText: "Plan a birthday, team activity, family gathering or private group quest. Split into teams and follow the race through a live leaderboard.",
    privatePoints: ["Private session", "Multiple teams", "Live leaderboard", "Coordinated start"],
    finalTitle: "Ready to see Tel Aviv Port differently?",
    finalText: "Gather your team, charge your phone and uncover the story hidden along the waterfront.",
    contact: "Private quest",
  },
};

export function MarketingHome({ locale }: { locale: Locale }) {
  const c = copy[locale];
  const rtl = locale === "he";
  return (
    <main className="marketing-page" dir={rtl ? "rtl" : "ltr"}>
      <header className="marketing-nav">
        <Link className="marketing-logo" href={locale === "he" ? "/" : "/?lang=en"}><span>Q</span> TLV QUEST</Link>
        <nav>{c.nav.map((item, index) => <a key={item} href={["#how", "#story", "#awaits", "#audience", "#faq"][index]}>{item}</a>)}</nav>
        <div className="marketing-nav-actions">
          <Link className="language-switch" href={locale === "he" ? "/?lang=en" : "/"}>{locale === "he" ? "EN" : "עברית"}</Link>
          <Link className="button marketing-button" href="/create">{c.cta}</Link>
        </div>
      </header>

      <section className="marketing-hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(247,240,230,.98) 0%, rgba(247,240,230,.87) 39%, rgba(19,41,75,.08) 66%), url(${heroImage})` }}>
        <div className="marketing-hero-copy">
          <span className="marketing-eyebrow">{c.heroEyebrow}</span>
          <h1>{c.heroTitle}</h1>
          <p>{c.heroText}</p>
          <div className="marketing-actions">
            <Link className="button marketing-button" href="/create">{c.cta}</Link>
            <a className="button marketing-button-secondary" href="#how">{c.heroSecondary}</a>
          </div>
          <div className="marketing-facts">{c.facts.map((fact) => <span key={fact}>✓ {fact}</span>)}</div>
        </div>
      </section>

      <section className="marketing-transition"><h2>{c.transitionTitle}</h2><p>{c.transitionText}</p></section>
      <section className="marketing-section"><div className="marketing-heading"><span>TLV QUEST</span><h2>{c.whyTitle}</h2></div><div className="marketing-feature-grid">{c.why.map(([icon,title,text]) => <article key={title}><b>{icon}</b><h3>{title}</h3><p>{text}</p></article>)}</div></section>
      <section className="marketing-story" id="story"><div className="marketing-story-image"><img src={storyImage} alt="TLV Quest players uncovering a clue at Tel Aviv Port" /></div><div className="marketing-story-copy"><span className="marketing-eyebrow">{c.storyEyebrow}</span><h2>{c.storyTitle}</h2>{c.storyParagraphs.map((p) => <p key={p}>{p}</p>)}<blockquote>{c.storyHighlight}</blockquote><Link className="button marketing-button" href="/create">{c.cta}</Link></div></section>
      <section className="marketing-how" id="how"><div className="marketing-how-copy"><span className="marketing-eyebrow">TLV QUEST</span><h2>{c.howTitle}</h2><div className="marketing-steps">{c.how.map(([n,t]) => <div key={n}><strong>{n}</strong><p>{t}</p></div>)}</div></div><div className="marketing-phone"><img src={phoneImage} alt="TLV Quest mobile game interface at Tel Aviv Port" /></div></section>
      <section className="marketing-section marketing-dark" id="awaits"><div className="marketing-heading"><span>THE EXPERIENCE</span><h2>{c.awaitsTitle}</h2></div><div className="marketing-awaits-grid">{c.awaits.map(([title,text],i) => <article key={title}><span>{String(i+1).padStart(2,"0")}</span><h3>{title}</h3><p>{text}</p></article>)}</div></section>
      <section className="marketing-section" id="audience"><div className="marketing-heading"><span>FOR YOUR PEOPLE</span><h2>{c.audienceTitle}</h2></div><div className="marketing-audience-grid">{c.audience.map(([title,text]) => <article key={title}><h3>{title}</h3><p>{text}</p></article>)}</div></section>
      <section className="marketing-details"><h2>{c.detailsTitle}</h2><div>{c.details.map(([label,value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div></section>
      <section className="marketing-private"><div><span className="marketing-eyebrow">{c.privateEyebrow}</span><h2>{c.privateTitle}</h2><p>{c.privateText}</p><div className="marketing-private-points">{c.privatePoints.map((point) => <span key={point}>✓ {point}</span>)}</div></div><Link className="button marketing-light-button" href="/create">{c.contact}</Link></section>
      <section className="marketing-section marketing-faq" id="faq"><div className="marketing-heading"><span>FAQ</span><h2>{c.faqTitle}</h2></div><div>{c.faq.map(([q,a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div></section>
      <section className="marketing-final"><h2>{c.finalTitle}</h2><p>{c.finalText}</p><div className="marketing-actions"><Link className="button marketing-button" href="/create">{c.cta}</Link><Link className="button marketing-button-secondary" href="/create">{c.contact}</Link></div></section>
      <footer className="marketing-footer"><div className="marketing-logo"><span>Q</span> TLV QUEST</div><p>{rtl ? "הרפתקת חידות חיה שהופכת מקומות אמיתיים לסיפורים שאפשר לשחק." : "A live urban adventure that turns real places into stories you can play."}</p><small>© TLV Quest · {rtl ? "נוצר בתל אביב. משוחק בעולם האמיתי." : "Created in Tel Aviv. Played in the real world."}</small></footer>
      <Link className="marketing-sticky-cta" href="/create">{c.cta}</Link>
    </main>
  );
}
