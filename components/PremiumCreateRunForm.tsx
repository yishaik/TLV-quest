"use client";

import { useEffect, useMemo, useState } from "react";

type CreatedRun = {
  publicCode: string;
  joinUrl: string;
  manageUrl: string;
  liveUrl: string;
  route?: { slug: string; title: Record<string, unknown>; version: number };
};
type Preset = "intimate" | "family" | "event";
type TeamMode = "automatic" | "preassigned" | "solo";
type PublishedRoute = {
  slug: string;
  title: Record<string, unknown>;
  description: Record<string, unknown>;
  version: number;
  checkpointCount: number;
  releaseName: string | null;
};

type Config = {
  templateSlug: string;
  scheduledAt: string;
  localeDefault: "he" | "en";
  preset: Preset;
  teamMode: TeamMode;
  desiredTeamSize: number;
  maxParticipants: number;
  maxTeams: number;
  routeMode: "circular" | "linear" | "free";
  startMode: "scheduled" | "manual" | "rolling";
  scoringMode: "combined" | "completion" | "time";
  graceMinutes: number;
  organizerEmail: string;
  organizerPhone: string;
  routeLength: "short" | "full";
  accessibilityMode: "regular" | "accessible";
};

const presets = {
  intimate: {
    label: "זוג / חברים",
    note: "2–6 משתתפים · קצב אינטימי",
    maxParticipants: 6,
    desiredTeamSize: 3,
    maxTeams: 2
  },
  family: {
    label: "משפחה",
    note: "4–12 משתתפים · איזון ונגישות",
    maxParticipants: 12,
    desiredTeamSize: 4,
    maxTeams: 3
  },
  event: {
    label: "אירוע / צוות",
    note: "10–30 משתתפים · מרוץ רב־צוותי",
    maxParticipants: 30,
    desiredTeamSize: 5,
    maxTeams: 8
  }
} as const;

const teamChoices: Array<{ value: TeamMode; title: string; note: string }> = [
  {
    value: "automatic",
    title: "חלוקה חכמה",
    note: "המערכת מאזנת את המשתתפים אוטומטית בזמן ההרשמה."
  },
  {
    value: "preassigned",
    title: "צוותים מוכנים",
    note: "המשתתפים מזינים שם צוות שנקבע מראש."
  },
  {
    value: "solo",
    title: "מרוץ יחידים",
    note: "כל משתתף מקבל מסלול וניקוד עצמאי."
  }
];

const textValue = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

export function PremiumCreateRunForm({ inviteToken }: { inviteToken: string }) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [routesLoading, setRoutesLoading] = useState(true);
  const [routes, setRoutes] = useState<PublishedRoute[]>([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [created, setCreated] = useState<CreatedRun | null>(null);
  const [config, setConfig] = useState<Config>({
    templateSlug: "",
    scheduledAt: "",
    localeDefault: "he",
    preset: "intimate",
    teamMode: "automatic",
    desiredTeamSize: 3,
    maxParticipants: 6,
    maxTeams: 2,
    routeMode: "circular",
    startMode: "manual",
    scoringMode: "combined",
    graceMinutes: 10,
    organizerEmail: "",
    organizerPhone: "",
    routeLength: "short",
    accessibilityMode: "regular"
  });

  const selectedRoute = useMemo(
    () => routes.find((route) => route.slug === config.templateSlug) ?? null,
    [config.templateSlug, routes]
  );

  useEffect(() => {
    let active = true;
    void fetch("/api/routes", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error?.message ?? "טעינת המסלולים נכשלה");
        }
        if (!active) return;
        const publishedRoutes = payload.data as PublishedRoute[];
        setRoutes(publishedRoutes);
        setConfig((current) => ({
          ...current,
          templateSlug:
            publishedRoutes.some((route) => route.slug === current.templateSlug)
              ? current.templateSlug
              : publishedRoutes[0]?.slug ?? ""
        }));
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "טעינת המסלולים נכשלה");
        }
      })
      .finally(() => {
        if (active) setRoutesLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const update = <K extends keyof Config>(key: K, value: Config[K]) =>
    setConfig((current) => ({ ...current, [key]: value }));

  function selectPreset(preset: Preset) {
    const values = presets[preset];
    setConfig((current) => ({
      ...current,
      preset,
      maxParticipants: values.maxParticipants,
      desiredTeamSize: values.desiredTeamSize,
      maxTeams: values.maxTeams
    }));
  }

  async function createRun() {
    if (!inviteToken) {
      setError(
        "קישור ההזמנה חסר או אינו תקף. יש לפתוח את האשף דרך הקישור האישי שקיבלתם."
      );
      return;
    }
    if (!config.templateSlug) {
      setError("יש לבחור מסלול שפורסם.");
      return;
    }
    if (!config.organizerEmail.trim() && !config.organizerPhone.trim()) {
      setError("יש להזין לפחות אימייל או טלפון של המארגן.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inviteToken,
          templateSlug: config.templateSlug,
          scheduledAt: config.scheduledAt || null,
          routeMode: config.routeMode,
          startMode: config.scheduledAt ? "scheduled" : config.startMode,
          scoringMode: config.scoringMode,
          teamMode: config.teamMode,
          localeDefault: config.localeDefault,
          maxParticipants: config.maxParticipants,
          maxTeams: config.maxTeams,
          desiredTeamSize: config.desiredTeamSize,
          graceMinutes: config.graceMinutes,
          organizerEmail: config.organizerEmail,
          organizerPhone: config.organizerPhone,
          settings: {
            routeLength: config.routeLength,
            accessibilityMode: config.accessibilityMode,
            boardVisibility: "ranking_status",
            whatsappRequirement: "one_per_team",
            experiencePreset: config.preset
          }
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "יצירת המשחק נכשלה");
      }
      setCreated(payload.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "שגיאה לא צפויה");
    } finally {
      setBusy(false);
    }
  }

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1600);
  }

  if (created) {
    const shareText = `TLV Quest · קוד ${created.publicCode}\nהצטרפות למשחק: ${created.joinUrl}`;
    return (
      <section className="creation-success">
        <div className="creation-success-hero">
          <img src="/visuals/quest-mark.svg" alt="" width="72" height="72" />
          <span className="flow-kicker">ההרצה נוצרה</span>
          <h1>האות מוכן לשידור.</h1>
          <p>
            {created.route && (
              <>
                {textValue(created.route.title.he, textValue(created.route.title.en))} · v
                {created.route.version} · {" "}
              </>
            )}
            קוד המשחק: <strong>{created.publicCode}</strong>
          </p>
        </div>

        <div className="link-pack">
          <article className="link-card">
            <span>01 / PARTICIPANTS</span>
            <h2>הזמנת משתתפים</h2>
            <p>זהו הקישור היחיד שצריך לשלוח לקבוצה. כל משתתף נרשם בנפרד.</p>
            <code>{created.joinUrl}</code>
            <div className="link-card-actions">
              <button
                className="button button-primary"
                onClick={() => copy("join", created.joinUrl)}
              >
                {copied === "join" ? "הועתק" : "העתקת קישור"}
              </button>
              <a
                className="button button-secondary"
                href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noreferrer"
              >
                שיתוף ב־WhatsApp
              </a>
            </div>
          </article>

          <article className="link-card">
            <span>02 / CONTROL</span>
            <h2>חדר הבקרה הסודי</h2>
            <p>הקישור כולל הרשאת ניהול. אין להעביר אותו למשתתפים.</p>
            <code>{created.manageUrl}</code>
            <div className="link-card-actions">
              <a className="button button-primary" href={created.manageUrl}>
                כניסה לחדר הבקרה
              </a>
              <button
                className="button button-secondary"
                onClick={() => copy("manage", created.manageUrl)}
              >
                {copied === "manage" ? "הועתק" : "שמירת קישור"}
              </button>
            </div>
          </article>

          <article className="link-card">
            <span>03 / LIVE</span>
            <h2>מסך המרוץ</h2>
            <p>אפשר לפתוח על טלוויזיה, מקרן או טלפון נוסף. הוא אינו חושף פתרונות.</p>
            <code>{created.liveUrl}</code>
            <div className="link-card-actions">
              <a
                className="button button-primary"
                href={created.liveUrl}
                target="_blank"
                rel="noreferrer"
              >
                פתיחת לוח חי
              </a>
              <button
                className="button button-secondary"
                onClick={() => copy("live", created.liveUrl)}
              >
                {copied === "live" ? "הועתק" : "העתקת קישור"}
              </button>
            </div>
          </article>
        </div>
      </section>
    );
  }

  return (
    <section className="create-flow">
      <div className="create-intro">
        <div>
          <span className="flow-kicker">Organizer setup</span>
          <h1>בונים את ערב המסע.</h1>
          <p>
            בוחרים מסלול שפורסם, אופי קבוצה ומועד. ההרצה מקבלת snapshot של הגרסה
            הפעילה ואינה משתנה אחרי יצירתה.
          </p>
        </div>
        <div className="wizard-progress" aria-label={`שלב ${step} מתוך 3`}>
          {[1, 2, 3].map((number) => (
            <span key={number} className={number <= step ? "active" : ""} />
          ))}
        </div>
      </div>

      <div className="wizard-panel">
        {step === 1 && (
          <div className="wizard-section">
            <div className="wizard-section-header">
              <span>01</span>
              <div>
                <h2>איזה מסלול יוצא לדרך?</h2>
                <p>רק מסלולים עם גרסה פעילה שפורסמה מופיעים כאן.</p>
              </div>
            </div>

            {routesLoading ? (
              <div className="muted">טוען מסלולים שפורסמו…</div>
            ) : routes.length === 0 ? (
              <div className="flow-error">אין כרגע מסלול שפורסם וזמין להרצה.</div>
            ) : (
              <div className="preset-grid">
                {routes.map((route) => (
                  <button
                    type="button"
                    key={route.slug}
                    className={`preset-card ${config.templateSlug === route.slug ? "active" : ""}`}
                    onClick={() => update("templateSlug", route.slug)}
                  >
                    <span>V{route.version} · {route.checkpointCount} STOPS</span>
                    <h3>{textValue(route.title.he, textValue(route.title.en, route.slug))}</h3>
                    <p>{textValue(route.description.he, textValue(route.description.en))}</p>
                  </button>
                ))}
              </div>
            )}

            <div className="wizard-section-header" style={{ marginTop: 30 }}>
              <span>＋</span>
              <div>
                <h2>מתי ומי יוצאים?</h2>
                <p>בחרו אופי אירוע ומועד. אפשר להשאיר את המועד פתוח ולהתחיל ידנית.</p>
              </div>
            </div>
            <div className="preset-grid">
              {(Object.keys(presets) as Preset[]).map((preset) => (
                <button
                  type="button"
                  key={preset}
                  className={`preset-card ${config.preset === preset ? "active" : ""}`}
                  onClick={() => selectPreset(preset)}
                >
                  <span>{preset.toUpperCase()}</span>
                  <h3>{presets[preset].label}</h3>
                  <p>{presets[preset].note}</p>
                </button>
              ))}
            </div>
            <div className="wizard-grid" style={{ marginTop: 24 }}>
              <label className="wizard-field">
                <span>מועד המשחק</span>
                <input
                  type="datetime-local"
                  value={config.scheduledAt}
                  onChange={(event) => update("scheduledAt", event.target.value)}
                />
              </label>
              <label className="wizard-field">
                <span>שפת ברירת מחדל</span>
                <select
                  value={config.localeDefault}
                  onChange={(event) =>
                    update("localeDefault", event.target.value === "en" ? "en" : "he")
                  }
                >
                  <option value="he">עברית</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="wizard-section">
            <div className="wizard-section-header">
              <span>02</span>
              <div>
                <h2>איך מתחרים?</h2>
                <p>החלוקה החכמה מומלצת לרוב ההרצות.</p>
              </div>
            </div>
            <div className="choice-grid">
              {teamChoices.map((choice) => (
                <button
                  type="button"
                  key={choice.value}
                  className={`choice-card ${config.teamMode === choice.value ? "active" : ""}`}
                  onClick={() => update("teamMode", choice.value)}
                >
                  <span>{choice.value.toUpperCase()}</span>
                  <h3>{choice.title}</h3>
                  <p>{choice.note}</p>
                </button>
              ))}
            </div>
            <div className="wizard-grid" style={{ marginTop: 24 }}>
              <label className="wizard-field">
                <span>מספר משתתפים מרבי</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={config.maxParticipants}
                  onChange={(event) => update("maxParticipants", Number(event.target.value))}
                />
              </label>
              <label className="wizard-field">
                <span>גודל צוות רצוי</span>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={config.desiredTeamSize}
                  onChange={(event) => update("desiredTeamSize", Number(event.target.value))}
                />
              </label>
            </div>
            <details className="advanced-panel">
              <summary>הגדרות מסלול מתקדמות</summary>
              <div className="wizard-grid">
                <label className="wizard-field">
                  <span>מבנה מסלול</span>
                  <select
                    value={config.routeMode}
                    onChange={(event) =>
                      update("routeMode", event.target.value as Config["routeMode"])
                    }
                  >
                    <option value="circular">מעגלי</option>
                    <option value="linear">קווי</option>
                    <option value="free">חופשי</option>
                  </select>
                </label>
                <label className="wizard-field">
                  <span>ניקוד</span>
                  <select
                    value={config.scoringMode}
                    onChange={(event) =>
                      update("scoringMode", event.target.value as Config["scoringMode"])
                    }
                  >
                    <option value="combined">זמן + דיוק</option>
                    <option value="completion">השלמה</option>
                    <option value="time">זמן</option>
                  </select>
                </label>
                <label className="wizard-field">
                  <span>נגישות</span>
                  <select
                    value={config.accessibilityMode}
                    onChange={(event) =>
                      update(
                        "accessibilityMode",
                        event.target.value as Config["accessibilityMode"]
                      )
                    }
                  >
                    <option value="regular">מסלול רגיל</option>
                    <option value="accessible">חלופות נגישות</option>
                  </select>
                </label>
                <label className="wizard-field">
                  <span>חלון הצטרפות מאוחרת</span>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={config.graceMinutes}
                    onChange={(event) => update("graceMinutes", Number(event.target.value))}
                  />
                </label>
              </div>
            </details>
          </div>
        )}

        {step === 3 && (
          <div className="wizard-section">
            <div className="wizard-section-header">
              <span>03</span>
              <div>
                <h2>מי מחזיק את המפתח?</h2>
                <p>הפרטים מוצפנים ומשמשים רק לתפעול ההרצה.</p>
              </div>
            </div>
            <div className="wizard-grid">
              <label className="wizard-field">
                <span>אימייל מארגן</span>
                <input
                  type="email"
                  value={config.organizerEmail}
                  onChange={(event) => update("organizerEmail", event.target.value)}
                  autoComplete="email"
                />
              </label>
              <label className="wizard-field">
                <span>טלפון מארגן</span>
                <input
                  type="tel"
                  value={config.organizerPhone}
                  onChange={(event) => update("organizerPhone", event.target.value)}
                  autoComplete="tel"
                />
              </label>
            </div>
            <div className="wizard-summary">
              <div>
                <span>מסלול</span>
                <strong>
                  {selectedRoute
                    ? textValue(
                        selectedRoute.title.he,
                        textValue(selectedRoute.title.en, selectedRoute.slug)
                      )
                    : "לא נבחר"}
                </strong>
              </div>
              <div>
                <span>סוג הרצה</span>
                <strong>{presets[config.preset].label}</strong>
              </div>
              <div>
                <span>תחרות</span>
                <strong>
                  {teamChoices.find((choice) => choice.value === config.teamMode)?.title}
                </strong>
              </div>
              <div>
                <span>קיבולת</span>
                <strong>עד {config.maxParticipants} משתתפים</strong>
              </div>
            </div>
            {!inviteToken && (
              <div className="flow-error" style={{ marginTop: 20 }}>
                חסר קישור הזמנה תקף. פתחו מחדש את הקישור האישי שקיבלתם.
              </div>
            )}
            {error && (
              <div className="flow-error" style={{ marginTop: 20 }} role="alert">
                {error}
              </div>
            )}
          </div>
        )}

        <div className="wizard-nav">
          <button
            className="button button-secondary"
            type="button"
            disabled={step === 1 || busy}
            onClick={() => {
              setError("");
              setStep((current) => Math.max(1, current - 1));
            }}
          >
            חזרה
          </button>
          {step < 3 ? (
            <button
              className="button button-primary"
              type="button"
              disabled={step === 1 && (!config.templateSlug || routesLoading)}
              onClick={() => {
                setError("");
                setStep((current) => Math.min(3, current + 1));
              }}
            >
              המשך
            </button>
          ) : (
            <button
              className="button button-primary"
              type="button"
              disabled={busy || !inviteToken || !config.templateSlug}
              onClick={createRun}
            >
              {busy ? "יוצר את ההרצה…" : "יצירת ההרצה"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
