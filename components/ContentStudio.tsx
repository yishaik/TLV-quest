"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import styles from "./ContentStudio.module.css";

type VersionSummary = {
  version: number;
  status: string;
  release_name: string | null;
  checkpointCount: number;
  health: { verified: number; pending: number; attention: number };
};

type CatalogTemplate = {
  id: string;
  slug: string;
  title: Record<string, unknown>;
  active_version: number;
  versions: VersionSummary[];
};

type Health = {
  checkpoint_id: string;
  status: string;
  checklist: Record<string, unknown>;
  notes: string | null;
  verified_at: string | null;
  verified_by: string | null;
};

type Checkpoint = {
  id: string;
  slug: string;
  sequence_no: number;
  kind: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  accessibility: Record<string, unknown>;
  config: Record<string, unknown>;
  is_optional: boolean;
  is_active: boolean;
  health: Health | null;
};

type Issue = {
  code: string;
  message: string;
  checkpointId?: string;
  checkpointSlug?: string;
};

type Detail = {
  template: CatalogTemplate;
  version: {
    version: number;
    status: string;
    release_name: string | null;
    release_notes: string | null;
    theme: Record<string, unknown>;
    route_config: Record<string, unknown>;
  };
  checkpoints: Checkpoint[];
  report: {
    ok: boolean;
    errors: Issue[];
    warnings: Issue[];
    checkpointCount: number;
    unverifiedCount: number;
  };
  audit: Array<{
    id: number;
    actor_email: string | null;
    action: string;
    created_at: string;
  }>;
};

type CheckpointDraft = {
  checkpoint: Checkpoint;
  validation: string;
  hints: string;
  scoring: string;
  accessibility: string;
  healthStatus: string;
  healthNotes: string;
  checklist: Record<string, boolean>;
};

const kinds = ["text", "choice", "scan", "location", "photo", "hybrid", "finale"];
const checklistFields = [
  ["signageVisible", "השילוט קיים וקריא"],
  ["accessClear", "הגישה פתוחה"],
  ["safetyOk", "התחנה בטוחה"],
  ["lightingOk", "התאורה מספקת"],
  ["qrPresent", "QR נמצא במקום"],
  ["nfcPresent", "NFC נמצא במקום"]
] as const;

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const textValue = (value: unknown) => (typeof value === "string" ? value : "");
const pretty = (value: unknown, fallback: unknown) => JSON.stringify(value ?? fallback, null, 2);

const localized = (checkpoint: Checkpoint, locale: "he" | "en", field: string) => {
  const content = objectValue(checkpoint.config.content);
  return textValue(objectValue(content[locale])[field]);
};

const parseObject = (value: string, label: string) => {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} חייב להיות אובייקט JSON`);
  }
  return parsed as Record<string, unknown>;
};

const parseArray = (value: string, label: string) => {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${label} חייב להיות מערך JSON`);
  return parsed;
};

const makeCheckpointDraft = (checkpoint?: Checkpoint): CheckpointDraft | null => {
  if (!checkpoint) return null;
  const config = objectValue(checkpoint.config);
  const checklist = objectValue(checkpoint.health?.checklist);
  return {
    checkpoint,
    validation: pretty(config.validation, {}),
    hints: pretty(config.hints, []),
    scoring: pretty(config.scoring, {}),
    accessibility: pretty(checkpoint.accessibility, {}),
    healthStatus: checkpoint.health?.status ?? "pending",
    healthNotes: checkpoint.health?.notes ?? "",
    checklist: Object.fromEntries(
      checklistFields.map(([key]) => [key, checklist[key] === true])
    )
  };
};

async function requestJson<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message ?? "הפעולה נכשלה");
  }
  return payload.data as T;
}

export function ContentStudio() {
  const [token, setToken] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [catalog, setCatalog] = useState<CatalogTemplate[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [checkpointDraft, setCheckpointDraft] = useState<CheckpointDraft | null>(null);
  const [releaseName, setReleaseName] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [workStatus, setWorkStatus] = useState<"draft" | "review">("draft");
  const [themeJson, setThemeJson] = useState("{}");
  const [routeJson, setRouteJson] = useState("{}");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const syncDetail = useCallback((next: Detail, checkpointId?: string) => {
    setDetail(next);
    setSelectedTemplateId(next.template.id);
    setSelectedVersion(next.version.version);
    setReleaseName(next.version.release_name ?? "");
    setReleaseNotes(next.version.release_notes ?? "");
    setWorkStatus(next.version.status === "review" ? "review" : "draft");
    setThemeJson(pretty(next.version.theme, {}));
    setRouteJson(pretty(next.version.route_config, {}));
    const checkpoint =
      next.checkpoints.find((item) => item.id === checkpointId) ?? next.checkpoints[0];
    setCheckpointDraft(makeCheckpointDraft(checkpoint));
  }, []);

  const loadDetail = useCallback(
    async (templateId: string, version: number, accessToken = token) => {
      if (!accessToken) return;
      setBusy("detail");
      try {
        const next = await requestJson<Detail>(
          `/api/admin/content/templates/${encodeURIComponent(templateId)}/versions/${version}`,
          accessToken
        );
        syncDetail(next);
      } finally {
        setBusy("");
      }
    },
    [syncDetail, token]
  );

  const loadCatalog = useCallback(
    async (
      preferredTemplateId?: string,
      preferredVersion?: number,
      accessToken = token
    ) => {
      if (!accessToken) return;
      setBusy("catalog");
      try {
        const nextCatalog = await requestJson<CatalogTemplate[]>(
          "/api/admin/content/templates",
          accessToken
        );
        setCatalog(nextCatalog);
        const template =
          nextCatalog.find((item) => item.id === preferredTemplateId) ?? nextCatalog[0];
        const version =
          template?.versions.find((item) => item.version === preferredVersion) ??
          template?.versions.find((item) => ["draft", "review"].includes(item.status)) ??
          template?.versions.find((item) => item.version === template.active_version) ??
          template?.versions[0];
        if (template && version) {
          const next = await requestJson<Detail>(
            `/api/admin/content/templates/${encodeURIComponent(template.id)}/versions/${version.version}`,
            accessToken
          );
          syncDetail(next);
        }
      } finally {
        setBusy("");
      }
    },
    [syncDetail, token]
  );

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => undefined;
    void Promise.resolve()
      .then(async () => {
        const supabase = getBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (active) {
          setToken(data.session?.access_token ?? "");
          setAuthChecked(true);
        }
        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
          if (active) {
            setToken(session?.access_token ?? "");
            setAuthChecked(true);
          }
        });
        unsubscribe = () => listener.subscription.unsubscribe();
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Supabase Auth unavailable");
          setAuthChecked(true);
        }
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void Promise.resolve()
      .then(() => loadCatalog(undefined, undefined, token))
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unexpected error");
      });
    return () => {
      active = false;
    };
  }, [loadCatalog, token]);

  const editable = detail ? ["draft", "review"].includes(detail.version.status) : false;

  async function createDraft() {
    if (!token || !selectedTemplateId) return;
    setBusy("draft");
    setError("");
    setMessage("");
    try {
      const result = await requestJson<{ version: number }>(
        `/api/admin/content/templates/${encodeURIComponent(selectedTemplateId)}/draft`,
        token,
        { method: "POST", body: "{}" }
      );
      await loadCatalog(selectedTemplateId, result.version);
      setMessage(`טיוטה v${result.version} מוכנה`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy("");
    }
  }

  async function saveMetadata() {
    if (!token || !detail) return;
    setBusy("metadata");
    setError("");
    try {
      const next = await requestJson<Detail>(
        `/api/admin/content/templates/${encodeURIComponent(detail.template.id)}/versions/${detail.version.version}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({
            metadata: {
              releaseName,
              releaseNotes,
              status: workStatus,
              theme: parseObject(themeJson, "Theme"),
              routeConfig: parseObject(routeJson, "Route config")
            }
          })
        }
      );
      syncDetail(next, checkpointDraft?.checkpoint.id);
      setMessage("פרטי הגרסה נשמרו");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy("");
    }
  }

  async function saveCheckpoint() {
    if (!token || !detail || !checkpointDraft) return;
    setBusy("checkpoint");
    setError("");
    try {
      const item = checkpointDraft.checkpoint;
      const config = {
        ...item.config,
        validation: parseObject(checkpointDraft.validation, "Validation"),
        hints: parseArray(checkpointDraft.hints, "Hints"),
        scoring: parseObject(checkpointDraft.scoring, "Scoring")
      };
      const next = await requestJson<Detail>(
        `/api/admin/content/templates/${encodeURIComponent(detail.template.id)}/versions/${detail.version.version}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({
            checkpoint: {
              id: item.id,
              kind: item.kind,
              latitude: item.latitude,
              longitude: item.longitude,
              radiusMeters: item.radius_meters,
              isOptional: item.is_optional,
              isActive: item.is_active,
              accessibility: parseObject(checkpointDraft.accessibility, "Accessibility"),
              config
            }
          })
        }
      );
      syncDetail(next, item.id);
      setMessage(`התחנה ${item.slug} נשמרה`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy("");
    }
  }

  async function saveHealth() {
    if (!token || !detail || !checkpointDraft) return;
    setBusy("health");
    setError("");
    try {
      await requestJson(
        `/api/admin/content/checkpoints/${encodeURIComponent(checkpointDraft.checkpoint.id)}/health`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: checkpointDraft.healthStatus,
            notes: checkpointDraft.healthNotes,
            checklist: checkpointDraft.checklist
          })
        }
      );
      await loadDetail(detail.template.id, detail.version.version);
      setMessage("בדיקת השטח נשמרה");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy("");
    }
  }

  async function publish() {
    if (!token || !detail) return;
    if (!window.confirm(`לפרסם את v${detail.version.version} להרצות חדשות?`)) return;
    setBusy("publish");
    setError("");
    try {
      const report = await requestJson<Detail["report"]>(
        `/api/admin/content/templates/${encodeURIComponent(detail.template.id)}/versions/${detail.version.version}/publish`,
        token,
        { method: "POST", body: JSON.stringify({ allowUnverified: false }) }
      );
      if (!report.ok) {
        setError("הפרסום נחסם על ידי שערי האיכות");
        await loadDetail(detail.template.id, detail.version.version);
        return;
      }
      await loadCatalog(detail.template.id, detail.version.version);
      setMessage(`v${detail.version.version} פורסמה בהצלחה`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy("");
    }
  }

  function updateCheckpoint(field: keyof Checkpoint, value: string | number | boolean | null) {
    setCheckpointDraft((current) =>
      current
        ? { ...current, checkpoint: { ...current.checkpoint, [field]: value } }
        : current
    );
  }

  function updateLocalized(locale: "he" | "en", field: string, value: string) {
    setCheckpointDraft((current) => {
      if (!current) return current;
      const config = objectValue(current.checkpoint.config);
      const content = objectValue(config.content);
      const localeContent = objectValue(content[locale]);
      return {
        ...current,
        checkpoint: {
          ...current.checkpoint,
          config: {
            ...config,
            content: { ...content, [locale]: { ...localeContent, [field]: value } }
          }
        }
      };
    });
  }

  if (!authChecked) {
    return <main className={styles.shell}><div className={styles.loading}>טוען Content OS…</div></main>;
  }

  if (!token) {
    return (
      <main className={styles.shell}>
        <section className={styles.loginCard}>
          <span className={styles.eyebrow}>Protected workspace</span>
          <h1>נדרשת כניסת מנהל</h1>
          <p className={styles.muted}>התחבר באמצעות Magic Link במסך הניהול.</p>
          <Link className={`${styles.button} ${styles.buttonPrimary}`} href="/admin">
            מעבר לכניסה
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Content Operating System · v1</span>
            <h1>המסלול הוא מוצר חי.</h1>
            <p>
              גרסאות immutable, עריכה דו־לשונית, אימות תחנות ופרסום אטומי. הרצות
              קיימות נשארות על ה־snapshot המקורי שלהן.
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.button} href="/admin">System Admin</Link>
            <button className={styles.button} onClick={createDraft} disabled={!selectedTemplateId || busy === "draft"}>
              {busy === "draft" ? "יוצר…" : "יצירת טיוטה"}
            </button>
            <button
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={publish}
              disabled={!editable || !detail?.report.ok || busy === "publish"}
            >
              {busy === "publish" ? "מפרסם…" : "פרסום גרסה"}
            </button>
          </div>
        </header>

        {message && <div className={styles.success}>{message}</div>}
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.workspace}>
          <aside className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
              <span className={styles.eyebrow}>Routes</span>
              <h2>מסלולים וגרסאות</h2>
            </div>
            {catalog.map((template) => (
              <div key={template.id}>
                <button
                  className={`${styles.templateButton} ${selectedTemplateId === template.id ? styles.templateActive : ""}`}
                  onClick={() => {
                    const version =
                      template.versions.find((item) => ["draft", "review"].includes(item.status)) ??
                      template.versions.find((item) => item.version === template.active_version) ??
                      template.versions[0];
                    if (version) void loadDetail(template.id, version.version);
                  }}
                >
                  <strong>{textValue(template.title.he) || textValue(template.title.en) || template.slug}</strong>
                  <small>{template.slug}</small>
                </button>
                {selectedTemplateId === template.id && (
                  <div className={styles.versionList}>
                    {template.versions.map((version) => (
                      <button
                        key={version.version}
                        className={`${styles.versionButton} ${selectedVersion === version.version ? styles.versionActive : ""}`}
                        onClick={() => void loadDetail(template.id, version.version)}
                      >
                        <span>
                          <strong>v{version.version} · {version.release_name || "ללא שם"}</strong>
                          <small>{version.checkpointCount} תחנות · {version.health.verified} מאומתות</small>
                        </span>
                        <span className={styles.status}>{version.status}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </aside>

          <section className={styles.main}>
            {!detail || ["catalog", "detail"].includes(busy) ? (
              <div className={styles.loading}>טוען גרסת תוכן…</div>
            ) : (
              <>
                <div className={styles.summaryGrid}>
                  <article className={styles.metric}><span>גרסה</span><strong>v{detail.version.version}</strong></article>
                  <article className={styles.metric}><span>תחנות</span><strong>{detail.report.checkpointCount}</strong></article>
                  <article className={styles.metric}><span>שגיאות</span><strong>{detail.report.errors.length}</strong></article>
                  <article className={styles.metric}><span>אימות שטח</span><strong>{detail.report.unverifiedCount}</strong></article>
                </div>

                <section className={styles.panel}>
                  <div className={styles.panelHeader}>
                    <div>
                      <span className={styles.status}>{detail.version.status}</span>
                      <h2>גרסה ו־Route configuration</h2>
                      <p className={styles.muted}>Published content is immutable; edit a cloned draft.</p>
                    </div>
                    <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={saveMetadata} disabled={!editable || busy === "metadata"}>
                      {busy === "metadata" ? "שומר…" : "שמירת גרסה"}
                    </button>
                  </div>
                  <div className={styles.formGrid}>
                    <label className={styles.field}><span>שם גרסה</span><input value={releaseName} onChange={(event) => setReleaseName(event.target.value)} disabled={!editable} /></label>
                    <label className={styles.selectField}><span>שלב עבודה</span><select value={workStatus} onChange={(event) => setWorkStatus(event.target.value === "review" ? "review" : "draft")} disabled={!editable}><option value="draft">Draft</option><option value="review">Ready for review</option></select></label>
                    <label className={`${styles.textAreaField} ${styles.full}`}><span>Release notes</span><textarea value={releaseNotes} onChange={(event) => setReleaseNotes(event.target.value)} disabled={!editable} /></label>
                    <label className={`${styles.textAreaField} ${styles.codeArea}`}><span>Theme JSON</span><textarea value={themeJson} onChange={(event) => setThemeJson(event.target.value)} disabled={!editable} /></label>
                    <label className={`${styles.textAreaField} ${styles.codeArea}`}><span>Route config JSON</span><textarea value={routeJson} onChange={(event) => setRouteJson(event.target.value)} disabled={!editable} /></label>
                  </div>
                </section>

                <section className={styles.editor}>
                  <span className={styles.eyebrow}>Checkpoint authoring</span>
                  <h2>תחנות ותוכן</h2>
                  <div className={styles.checkpointLayout}>
                    <div className={styles.checkpointList}>
                      {detail.checkpoints.map((checkpoint) => (
                        <button
                          key={checkpoint.id}
                          className={`${styles.checkpointButton} ${checkpointDraft?.checkpoint.id === checkpoint.id ? styles.checkpointActive : ""}`}
                          onClick={() => setCheckpointDraft(makeCheckpointDraft(checkpoint))}
                        >
                          <span className={styles.sequence}>{checkpoint.sequence_no}</span>
                          <span><strong>{localized(checkpoint, "he", "title") || checkpoint.slug}</strong><small>{checkpoint.kind} · {checkpoint.slug}</small></span>
                          <span className={`${styles.healthDot} ${checkpoint.health?.status === "verified" ? styles.healthVerified : checkpoint.health?.status === "pending" ? styles.healthPending : styles.healthAttention}`} />
                        </button>
                      ))}
                    </div>

                    {checkpointDraft && (
                      <article className={styles.checkpointCard}>
                        <div className={styles.checkpointTop}>
                          <div><span className={styles.status}>#{checkpointDraft.checkpoint.sequence_no}</span><h2>{checkpointDraft.checkpoint.slug}</h2></div>
                          <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={saveCheckpoint} disabled={!editable || busy === "checkpoint"}>{busy === "checkpoint" ? "שומר…" : "שמירת תחנה"}</button>
                        </div>

                        <div className={styles.section}>
                          <h3>מבנה</h3>
                          <div className={styles.formGrid}>
                            <label className={styles.selectField}><span>סוג תחנה</span><select value={checkpointDraft.checkpoint.kind} onChange={(event) => updateCheckpoint("kind", event.target.value)} disabled={!editable}>{kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
                            <div>
                              <label className={styles.switchRow}><input type="checkbox" checked={checkpointDraft.checkpoint.is_active} onChange={(event) => updateCheckpoint("is_active", event.target.checked)} disabled={!editable} />תחנה פעילה</label>
                              <label className={styles.switchRow}><input type="checkbox" checked={checkpointDraft.checkpoint.is_optional} onChange={(event) => updateCheckpoint("is_optional", event.target.checked)} disabled={!editable} />תחנה אופציונלית</label>
                              <label className={styles.switchRow}><input type="checkbox" checked={checkpointDraft.checkpoint.config.field_verification_required === true} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, checkpoint: { ...checkpointDraft.checkpoint, config: { ...checkpointDraft.checkpoint.config, field_verification_required: event.target.checked } } })} disabled={!editable} />נדרש אימות פיזי</label>
                            </div>
                          </div>
                        </div>

                        <div className={styles.section}>
                          <h3>תוכן דו־לשוני</h3>
                          <div className={styles.contentGrid}>
                            {(["he", "en"] as const).map((locale) => (
                              <div key={locale}>
                                <span className={styles.status}>{locale}</span>
                                {["title", "story", "prompt", "locationHint", "success"].map((field) => (
                                  <label className={field === "title" ? styles.field : styles.textAreaField} key={field}>
                                    <span>{field}</span>
                                    {field === "title" ? (
                                      <input value={localized(checkpointDraft.checkpoint, locale, field)} onChange={(event) => updateLocalized(locale, field, event.target.value)} disabled={!editable} />
                                    ) : (
                                      <textarea value={localized(checkpointDraft.checkpoint, locale, field)} onChange={(event) => updateLocalized(locale, field, event.target.value)} disabled={!editable} />
                                    )}
                                  </label>
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className={styles.section}>
                          <h3>מיקום</h3>
                          <div className={styles.locationGrid}>
                            <label className={styles.field}><span>Latitude</span><input type="number" step="any" value={checkpointDraft.checkpoint.latitude ?? ""} onChange={(event) => updateCheckpoint("latitude", event.target.value === "" ? null : Number(event.target.value))} disabled={!editable} /></label>
                            <label className={styles.field}><span>Longitude</span><input type="number" step="any" value={checkpointDraft.checkpoint.longitude ?? ""} onChange={(event) => updateCheckpoint("longitude", event.target.value === "" ? null : Number(event.target.value))} disabled={!editable} /></label>
                            <label className={styles.field}><span>רדיוס במטרים</span><input type="number" min="1" value={checkpointDraft.checkpoint.radius_meters ?? ""} onChange={(event) => updateCheckpoint("radius_meters", event.target.value === "" ? null : Number(event.target.value))} disabled={!editable} /></label>
                          </div>
                        </div>

                        <div className={styles.section}>
                          <h3>Advanced JSON</h3>
                          <div className={styles.formGrid}>
                            <label className={`${styles.textAreaField} ${styles.codeArea}`}><span>Validation</span><textarea value={checkpointDraft.validation} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, validation: event.target.value })} disabled={!editable} /></label>
                            <label className={`${styles.textAreaField} ${styles.codeArea}`}><span>Hints</span><textarea value={checkpointDraft.hints} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, hints: event.target.value })} disabled={!editable} /></label>
                            <label className={`${styles.textAreaField} ${styles.codeArea}`}><span>Scoring</span><textarea value={checkpointDraft.scoring} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, scoring: event.target.value })} disabled={!editable} /></label>
                            <label className={`${styles.textAreaField} ${styles.codeArea}`}><span>Accessibility</span><textarea value={checkpointDraft.accessibility} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, accessibility: event.target.value })} disabled={!editable} /></label>
                          </div>
                        </div>

                        <div className={styles.section}>
                          <div className={styles.checkpointTop}><div><h3>Field verification</h3><p className={styles.muted}>שער פרסום המבוסס על בדיקה במקום.</p></div><button className={styles.button} onClick={saveHealth} disabled={busy === "health"}>{busy === "health" ? "שומר…" : "שמירת בדיקה"}</button></div>
                          <div className={styles.formGrid}>
                            <label className={styles.selectField}><span>מצב</span><select value={checkpointDraft.healthStatus} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, healthStatus: event.target.value })}><option value="not_required">לא נדרש</option><option value="pending">ממתינה</option><option value="verified">מאומתת</option><option value="needs_attention">דורשת טיפול</option><option value="blocked">חסומה</option></select></label>
                            <label className={`${styles.textAreaField} ${styles.full}`}><span>הערות</span><textarea value={checkpointDraft.healthNotes} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, healthNotes: event.target.value })} /></label>
                          </div>
                          <div className={styles.healthGrid}>
                            {checklistFields.map(([key, label]) => (
                              <label className={styles.checkRow} key={key}><input type="checkbox" checked={checkpointDraft.checklist[key] === true} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, checklist: { ...checkpointDraft.checklist, [key]: event.target.checked } })} />{label}</label>
                            ))}
                          </div>
                        </div>
                      </article>
                    )}
                  </div>
                </section>

                <section className={styles.panel}>
                  <div className={styles.panelHeader}><div><span className={styles.eyebrow}>Publish gate</span><h2>{detail.report.ok ? "הגרסה מוכנה לפרסום" : "הגרסה חסומה"}</h2></div><span className={detail.report.ok ? styles.success : styles.notice}>{detail.report.ok ? "PASS" : "BLOCKED"}</span></div>
                  <div className={styles.report}>
                    {[...detail.report.errors, ...detail.report.warnings].map((issue) => (
                      <div className={detail.report.errors.includes(issue) ? styles.error : styles.issue} key={`${issue.code}-${issue.checkpointId ?? "route"}`}><strong>{issue.checkpointSlug ?? "Route"}</strong> · {issue.message}</div>
                    ))}
                    {!detail.report.errors.length && !detail.report.warnings.length && <div className={styles.success}>כל שערי האיכות עברו.</div>}
                  </div>
                </section>

                <section className={styles.panel}>
                  <span className={styles.eyebrow}>Audit trail</span><h2>היסטוריית פעולות</h2>
                  <div className={styles.audit}>
                    {detail.audit.map((entry) => <div className={styles.auditItem} key={entry.id}><time>{new Date(entry.created_at).toLocaleString("he-IL")}</time><div><strong>{entry.action}</strong><div className={styles.muted}>{entry.actor_email ?? "system"}</div></div></div>)}
                  </div>
                </section>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
