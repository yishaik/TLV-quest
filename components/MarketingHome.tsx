import Link from "next/link";
import { LeadCaptureForm } from "@/components/LeadCaptureForm";

type Locale = "he" | "en";

type Copy = {
  nav: Array<[string, string]>;
  eyebrow: string;
  title: React.ReactNode;
  intro: string;
  primary: string;
  secondary: string;
  access: string;
  facts: string[];
  manifesto: string;
  manifestoText: string;
  storyEyebrow: string;
  storyTitle: string;
  storyText: string[];
  storyQuote: string;
  chaptersTitle: string;
  chaptersText: string;
  chapters: Array<[string, string, string]>;
  momentsTitle: string;
  moments: Array<[string, string]>;
  flowTitle: string;
  flow: Array<[string, string]>;
  privateEyebrow: string;
  privateTitle: string;
  privateText: string;
  privatePoints: string[];
  faqTitle: string;
  faq: Array<[string, string]>;
  finalTitle: string;
  finalText: string;
  resume: string;
};

const copy: Record<Locale, Copy> = {
  he: {
    nav: [["הסיפור", "#story"], ["המסע", "#chapters"], ["איך זה עובד", "#flow"], ["אירוע פרטי", "#private"]],
    eyebrow: "מסע אורבני פרטי · נמל תל אביב",
    title: <>הנמל זוכר.<br /><em>אתם באים לגלות?</em></>,
    intro: "ערב אחד. קפסולת זמן שננעלה ב־1936. סדרת רמזים שהתעוררה מחדש בין הרציפים, המנוף והמגדלור. TLV Quest הופך את הנמל לסיפור חי שהקבוצה שלכם היא הדמות הראשית בו.",
    primary: "בקשת הזמנה",
    secondary: "הצצה למסע",
    access: "כבר קיבלתם קישור?",
    facts: ["60–90 דקות", "2–30 משתתפים", "עברית / English", "ללא הורדת אפליקציה"],
    manifesto: "זה לא סיור. זה לא חדר בריחה.",
    manifestoText: "הרחובות הם התפאורה, הפרטים הם המנגנון, והטלפון רק פותח דלתות. רוב הזמן תסתכלו החוצה — לא למסך.",
    storyEyebrow: "תיק 1936",
    storyTitle: "המסר שהיה אמור להיפתח בעתיד נעלם.",
    storyText: [
      "בימי הקמת הנמל הוטמנה קפסולה ובה עדויות, צילומים ומפתח לסיפור שלא הושלם. השנים עברו, המבנים השתנו, והמסלול אליה נשכח.",
      "כעת אות מסתורי מחזיר את הסימנים לחיים. כדי לפתוח את הקפסולה תצטרכו לחבר בין הנמל שהיה, הנמל של היום והפרטים שאף אחד אחר לא שם לב אליהם."
    ],
    storyQuote: "הנמל הוא המפה. האור הוא המצפן. הזמן הוא היריב.",
    chaptersTitle: "שלושה פרקים. סיפור אחד שנפתח בתנועה.",
    chaptersText: "כל תחנה משנה את הקצב: תצפית, פעולה בעולם האמיתי, רגע קבוצתי ופיסת סיפור שנשארת איתכם גם אחרי המשחק.",
    chapters: [
      ["01", "האות הראשון", "התחילו במקום שבו הים הפך לעיר. מצאו את השנה שממנה הכול יצא לדרך."],
      ["02", "צל המנוף", "סרקו, התמקמו וצרו יחד תמונה שאפשר לראות נכון רק מזווית אחת."],
      ["03", "האור האחרון", "עקבו אחרי קו האור אל המגדלור וחברו את המפתחות לפני שהחלון נסגר."]
    ],
    momentsTitle: "בנוי לרגעים שאי אפשר לייצר סביב שולחן",
    moments: [
      ["רמזים פיזיים", "שלטים, מבנים, קווי ראייה וסמלים שהופכים לחלק מממשק המשחק."],
      ["משימות צוות", "לא רק לענות נכון — לזוז, לצלם, להתווכח ולבחור יחד."],
      ["שכבת WhatsApp", "הודעות סיפור, רמזים ועדכונים מגיעים בדיוק ברגע הנכון."],
      ["מרוץ חי", "התקדמות וניקוד בזמן אמת בלי לחשוף פתרונות או מיקומים מדויקים."],
      ["מסלול דו־לשוני", "כל משתתף מקבל את החוויה בעברית או באנגלית."],
      ["ללא מפעיל", "ההרשמה, חלוקת הקבוצות, התחנות, הרמזים והסיום עובדים אוטומטית."]
    ],
    flowTitle: "מהזמנה אחת לערב שמתנהל מעצמו",
    flow: [
      ["01", "פותחים הרצה פרטית ומקבלים קישור אישי למארגן."],
      ["02", "משתפים קישור. כל משתתף נרשם ומקבל כניסה אישית למסע."],
      ["03", "המערכת מחלקת לקבוצות, מחברת WhatsApp ומכינה את כולם לזינוק."],
      ["04", "המשחק מתקדם אוטומטית; המארגן רואה חדר בקרה ולוח חי."],
      ["05", "בסיום נפתחים התוצאות, הסיפור והגלריה לזמן מוגבל."]
    ],
    privateEyebrow: "Invitation only",
    privateTitle: "הנמל מחכה לקבוצה שלכם.",
    privateText: "הפיילוט נפתח בהרצות פרטיות נבחרות. ספרו לנו מי מגיע ומתי, ונבנה עבורכם פתיחה מדויקת — מזוג ועד אירוע צוות.",
    privatePoints: ["הרצה פרטית", "מספר צוותים", "לוח חי", "התאמה לקבוצה", "עברית ואנגלית"],
    faqTitle: "לפני ששולחים את האות",
    faq: [
      ["צריך להוריד אפליקציה?", "לא. החוויה נפתחת בדפדפן הנייד ומשתלבת עם WhatsApp."],
      ["אפשר לשחק בזוג?", "כן. המשחק עובד מצוין לזוג, למשפחה ולקבוצות שמתחרות בכמה צוותים."],
      ["האם צריך מפעיל?", "לא. המערכת מנהלת הרשמה, חלוקה, התחלה, רמזים, ניקוד וסיום. למארגן נשאר חדר בקרה למקרי חירום."],
      ["מה קורה אם נתקעים?", "בכל תחנה אפשר לחשוף רמז מדורג. הוא שומר על הקצב ועשוי להפחית מעט מהניקוד."],
      ["האם זה מתאים לילדים?", "החוויה מתאימה במיוחד לבני נוער, למשפחות עם ילדים גדולים ולקבוצות מבוגרים."],
      ["מה עושים במזג אוויר בעייתי?", "לפני הרצה פרטית מתאמים חלון זמן ומדיניות דחייה בהתאם לתנאים בנמל."]
    ],
    finalTitle: "הסיפור כבר התחיל.",
    finalText: "השאירו פרטים וקבלו הזמנה להרצה פרטית של TLV Quest.",
    resume: "חזרה למסע"
  },
  en: {
    nav: [["The story", "#story"], ["The quest", "#chapters"], ["How it works", "#flow"], ["Private event", "#private"]],
    eyebrow: "A private urban quest · Tel Aviv Port",
    title: <>The port remembers.<br /><em>Will you uncover it?</em></>,
    intro: "One evening. A time capsule sealed in 1936. A trail of signals resurfacing between the docks, the crane and the lighthouse. TLV Quest turns the port into a living story with your team at its center.",
    primary: "Request an invitation",
    secondary: "Enter the story",
    access: "Already received a link?",
    facts: ["60–90 minutes", "2–30 participants", "Hebrew / English", "No app download"],
    manifesto: "Not a tour. Not an escape room.",
    manifestoText: "The waterfront is the set, overlooked details are the mechanism, and your phone only opens doors. Most of the time, you will be looking up — not down.",
    storyEyebrow: "Case 1936",
    storyTitle: "The message meant for the future disappeared.",
    storyText: [
      "When the port was founded, a capsule was sealed with evidence, photographs and the key to an unfinished story. The waterfront changed and the route was forgotten.",
      "Now a mysterious signal has brought the clues back. Connect the port that was, the port you see today and the details everyone else walks past."
    ],
    storyQuote: "The port is the map. Light is the compass. Time is the rival.",
    chaptersTitle: "Three chapters. One story unlocked in motion.",
    chaptersText: "Each checkpoint changes the rhythm: observation, a physical action, a team moment and another fragment of the mystery.",
    chapters: [
      ["01", "The first signal", "Begin where the sea became a city. Find the year that started everything."],
      ["02", "The crane’s shadow", "Scan, position yourselves and create an image that only works from one angle."],
      ["03", "The final light", "Follow the beam to the lighthouse and assemble the keys before the window closes."]
    ],
    momentsTitle: "Designed for moments a table cannot create",
    moments: [
      ["Physical clues", "Signs, structures, sight lines and symbols become part of the interface."],
      ["Team missions", "Move, photograph, debate and decide together — not merely submit answers."],
      ["WhatsApp layer", "Story beats, hints and updates arrive at exactly the right moment."],
      ["Live race", "Realtime progress without revealing solutions or precise locations."],
      ["Bilingual route", "Each participant experiences the quest in Hebrew or English."],
      ["Autonomous operation", "Registration, teams, checkpoints, hints and finishing run automatically."]
    ],
    flowTitle: "From one invitation to a self-running night",
    flow: [
      ["01", "Open a private session and receive a secure organizer link."],
      ["02", "Share one invitation. Every participant gets a personal entry to the quest."],
      ["03", "The system balances teams, connects WhatsApp and prepares the start."],
      ["04", "The quest advances automatically while the organizer sees a live control room."],
      ["05", "Results, story and gallery unlock for a limited time after the finale."]
    ],
    privateEyebrow: "Invitation only",
    privateTitle: "The port is waiting for your team.",
    privateText: "The pilot is opening through selected private sessions. Tell us who is coming and when; we will shape the right opening for a couple, family or company team.",
    privatePoints: ["Private session", "Multiple teams", "Live board", "Group adaptation", "Hebrew and English"],
    faqTitle: "Before you send the signal",
    faq: [
      ["Do I need an app?", "No. The experience opens in the mobile browser and connects with WhatsApp."],
      ["Can two people play?", "Yes. It works for a couple, a family or a larger group split into competing teams."],
      ["Does it require an operator?", "No. Registration, team balancing, start, hints, scoring and finish are automated, with emergency controls for the organizer."],
      ["What if we get stuck?", "Every checkpoint offers progressive hints that preserve the pace and may reduce the score slightly."],
      ["Is it suitable for children?", "It is best for teenagers, families with older children and adult groups."],
      ["What about bad weather?", "Private sessions include a coordinated time window and postponement policy based on port conditions."]
    ],
    finalTitle: "The story has already begun.",
    finalText: "Leave your details to receive an invitation for a private TLV Quest session.",
    resume: "Resume quest"
  }
};

export function MarketingHome({ locale }: { locale: Locale }) {
  const c = copy[locale];
  const rtl = locale === "he";

  return (
    <main className="marketing-page" dir={rtl ? "rtl" : "ltr"}>
      <header className="marketing-nav">
        <Link className="marketing-logo" href={rtl ? "/" : "/?lang=en"}>
          <img src="/visuals/quest-mark.svg" alt="" width="42" height="42" />
          <span><b>TLV QUEST</b><small>THE PORT REMEMBERS</small></span>
        </Link>
        <nav>{c.nav.map(([label, href]) => <a key={href} href={href}>{label}</a>)}</nav>
        <div className="marketing-nav-actions">
          <Link className="language-switch" href={rtl ? "/?lang=en" : "/"}>{rtl ? "EN" : "עברית"}</Link>
          <a className="button marketing-button" href="#private">{c.primary}</a>
        </div>
      </header>

      <section className="marketing-hero">
        <div className="marketing-hero-visual" aria-hidden="true"><img src="/visuals/harbor-hero.svg" alt="" /></div>
        <div className="marketing-hero-vignette" />
        <div className="marketing-hero-copy">
          <span className="marketing-eyebrow"><i />{c.eyebrow}</span>
          <h1>{c.title}</h1>
          <p>{c.intro}</p>
          <div className="marketing-actions">
            <a className="button marketing-button" href="#private">{c.primary}</a>
            <a className="button marketing-button-secondary" href="#story">{c.secondary}</a>
          </div>
          <Link className="marketing-access-link" href="/resume">{c.access} <strong>{c.resume} ↗</strong></Link>
          <div className="marketing-facts">{c.facts.map((fact) => <span key={fact}>{fact}</span>)}</div>
        </div>
        <div className="hero-coordinate" aria-hidden="true"><span>32.0969° N</span><span>34.7748° E</span></div>
      </section>

      <section className="marketing-manifesto">
        <span>TLV / 1936 / NOW</span>
        <h2>{c.manifesto}</h2>
        <p>{c.manifestoText}</p>
      </section>

      <section className="marketing-story" id="story">
        <div className="marketing-story-art"><img src="/visuals/capsule-1936.svg" alt={rtl ? "קפסולת הזמן 1936" : "The 1936 time capsule"} /><span>ARCHIVE OBJECT / 01</span></div>
        <div className="marketing-story-copy">
          <span className="marketing-eyebrow"><i />{c.storyEyebrow}</span>
          <h2>{c.storyTitle}</h2>
          {c.storyText.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <blockquote>{c.storyQuote}</blockquote>
        </div>
      </section>

      <section className="marketing-chapters" id="chapters">
        <div className="marketing-heading"><span>THE ROUTE</span><h2>{c.chaptersTitle}</h2><p>{c.chaptersText}</p></div>
        <div className="chapter-track">
          {c.chapters.map(([number, title, text], index) => (
            <article key={number}>
              <div className="chapter-number">{number}</div>
              <div className={`chapter-icon chapter-icon-${index + 1}`} aria-hidden="true" />
              <h3>{title}</h3><p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-moments">
        <div className="marketing-heading"><span>THE EXPERIENCE</span><h2>{c.momentsTitle}</h2></div>
        <div className="moment-grid">{c.moments.map(([title, text], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
      </section>

      <section className="marketing-flow" id="flow">
        <div className="marketing-flow-copy"><span className="marketing-eyebrow"><i />SYSTEM FLOW</span><h2>{c.flowTitle}</h2></div>
        <div className="marketing-flow-steps">{c.flow.map(([number, text]) => <div key={number}><strong>{number}</strong><p>{text}</p></div>)}</div>
      </section>

      <section className="marketing-private" id="private">
        <div className="marketing-private-copy">
          <span className="marketing-eyebrow"><i />{c.privateEyebrow}</span>
          <h2>{c.privateTitle}</h2>
          <p>{c.privateText}</p>
          <div className="marketing-private-points">{c.privatePoints.map((point) => <span key={point}>{point}</span>)}</div>
          <div className="private-seal" aria-hidden="true"><img src="/visuals/quest-mark.svg" alt="" /><span>PRIVATE<br />SESSION</span></div>
        </div>
        <LeadCaptureForm locale={locale} />
      </section>

      <section className="marketing-faq">
        <div className="marketing-heading"><span>FIELD NOTES</span><h2>{c.faqTitle}</h2></div>
        <div>{c.faq.map(([question, answer]) => <details key={question}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div>
      </section>

      <section className="marketing-final">
        <img src="/visuals/quest-mark.svg" alt="" width="70" height="70" />
        <h2>{c.finalTitle}</h2><p>{c.finalText}</p>
        <a className="button marketing-button" href="#private">{c.primary}</a>
      </section>

      <footer className="marketing-footer">
        <div className="marketing-logo"><img src="/visuals/quest-mark.svg" alt="" width="38" height="38" /><span><b>TLV QUEST</b><small>THE PORT REMEMBERS</small></span></div>
        <p>{rtl ? "נוצר בתל אביב. משוחק בעולם האמיתי." : "Created in Tel Aviv. Played in the real world."}</p>
        <small>© 2026 TLV Quest · Private pilot</small>
      </footer>
      <a className="marketing-sticky-cta" href="#private">{c.primary}</a>
    </main>
  );
}
