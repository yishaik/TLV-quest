"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import styles from "./ContentStudio.module.css";

type VersionSummary = {
  template_id: string;
  version: number;
  status: string;
  release_name: string | null;
  release_notes: string | null;
  validation_report: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  checkpointCount: number;
  health: { verified: number; pending: number; attention: number };
};

type CatalogTemplate = {
  id: string;
  slug: string;
  brand_key: string;
  title: Record<string, unknown>;
  description: Record<string, unknown>;
  active_version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  versions: VersionSummary[];
};

type CheckpointHealth = {
  checkpoint_id: string;
  status: string;
  checklist: Record<string, unknown>;
  notes: string | null;
  last_checked_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  updated_at: string;
  updated_by: string | null;
};

type DetailCheckpoint = {
  id: string;
  template_id: string;
  version: number;
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
  created_at: string;
  health: CheckpointHealth | null;
};

type ValidationIssue = {
  code: string;
  message: string;
  checkpointId?: string;
  checkpointSlug?: string;
};

type VersionDetail = {
  template: CatalogTemplate;
  version: {
    template_id: string;
    version: number;
    status: string;
    release_name: string | null;
    release_notes: string | null;
    theme: Record<string, unknown>;
    route_config: Record<string, unknown>;
    validation_report: Record<string, unknown>;
    created_by: string | null;
    updated_by: string | null;
    published_by: string | null;
    created_at: string;
    updated_at: string;
    published_at: string | null;
  };
  checkpoints: DetailCheckpoint[];
  report: {
    ok: boolean;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    checkpointCount: number;
    unverifiedCount: number;
    generatedAt: string;
  };
  audit: Array<{
    id: number;
    checkpoint_id: string | null;
    actor_email: string | null;
    action: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>;
};

type MetadataEditor = {
  releaseName: string;
  releaseNotes: string;
  status: "draft" | "review";
  themeJson: string;
  routeConfigJson: string;
};

type CheckpointEditor = {
  checkpoint: DetailCheckpoint;
  validationJson: string;
  hintsJson: string;
  scoringJson: string;
  accessibilityJson: string;
  healthStatus: string;
  healthNotes: string;
  checklist: Record<string, boolean>;
};

const checkpointKinds = [
  ["text", "טקסט"],
  ["choice", "בחירה"],
  ["scan", "QR / NFC"],
  ["location", "מיקום"],
  ["photo", "צילום"],
  ["hybrid", "משולב"],
  ["finale", "סיום"]
];

const checklistFields = [
  ["signageVisible", "השילוט קיים וקריא"],
  ["accessClear", "הגישה לתחנה פתוחה"],
  ["safetyOk", "התחנה בטוחה"],
  ["lightingOk", "התאורה מספקת"],
  ["qrPresent", "קוד QR נמצא במקום"],
  ["nfcPresent", "תג NFC נמצא במקום"]
] as const;

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const stringValue = (value: unknown) => (typeof value === "string" ? value : "");

const localizedValue = (
  checkpoint: DetailCheckpoint,
  locale: "he" | "en",
  field: string
) => {
  const content = objectValue(checkpoint.config.content);
  return stringValue(objectValue(content[locale])[field]);
};

const prettyJson = (value: unknown, fallback: unknown) =>
  JSON.stringify(value ?? fallback, null, 2);

const makeCheckpointEditor = (
  checkpoint: DetailCheckpoint | undefined
): CheckpointEditor | null => {
  if (!checkpoint) return null;
  const config = objectValue(checkpoint.config);
  const checklist = objectValue(checkpoint.health?.checklist);
  return {
    checkpoint,
    validationJson: prettyJson(config.validation, {}),
    hintsJson: prettyJson(config.hints, []),
    scoringJson: prettyJson(config.scoring, {}),
    accessibilityJson: prettyJson(checkpoint.accessibility, {}),
    healthStatus: checkpoint.health?.status ?? "pending",
    healthNotes: checkpoint.health?.notes ?? "",
    checklist: Object.fromEntries(
      checklistFields.map(([key]) => [key, checklist[key] === true])
    )
  };
};

const parseObjectJson = (value: string, label: string) => {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} חייב להיות אובייקט JSON.`);
  }
  return parsed as Record<string, unknown>;
};

const parseArrayJson = (value: string, label: string) => {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${label} חייב להיות מערך JSON.`);
  return parsed;
};

const templateTitle = (template: CatalogTemplate) =>
  stringValue(template.title.he) || stringValue(template.title.en) || template.slug;

const statusClassName = (status: string) => {
  const extra =
    status === "published"
      ? styles.statusPublished
      : status === "review"
        ? styles.statusReview
        : status === "draft"
          ? styles.statusDraft
          : "";
  return `${styles.status} ${extra}`;
};

const healthClassName = (status: string) => {
  const extra =
    status === "verified"
      ? styles.healthVerified
      : status === "pending"
        ? styles.healthPending
        : ["needs_attention", "blocked"].includes(status)
          ? styles.healthAttention
          : "";
  return `${styles.healthDot} ${extra}`;
};

async function jsonRequest<T>(url: string, token: string, init?: RequestInit): Promise<T> {
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
  const [sessionToken, setSessionToken] = useState("");
  const [sessionChecked, setSessionChecked] = useState(false);
  const [catalog, setCatalog] = useState<CatalogTemplate[]>([]);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [metadataEditor, setMetadataEditor] = useState<MetadataEditor | null>(null);
  const [checkpointEditor, setCheckpointEditor] = useState<CheckpointEditor | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const synchronizeDetail = useCallback(
    (next: VersionDetail, preferredCheckpointId?: string) => {
      setDetail(next);
      setSelectedTemplateId(next.template.id);
      setSelectedVersion(next.version.version);
      setMetadataEditor({
        releaseName: next.version.release_name ?? "",
        releaseNotes: next.version.release_notes ?? "",
        status: next.version.status === "review" ? "review" : "draft",
        themeJson: prettyJson(next.version.theme, {}),
        routeConfigJson: prettyJson(next.version.route_config, {})
      });
      const checkpoint =
        next.checkpoints.find((item) => item.id === preferredCheckpointId) ??
        next.checkpoints[0];
      setCheckpointEditor(makeCheckpointEditor(checkpoint));
    },
    []
  );

  const openVersion = useCallback(
    async (templateId: string, version: number, token = sessionToken) => {
      if (!token) return;
      setBusy("version");
      setError("");
      try {
        const next = await jsonRequest<VersionDetail>(
          `/api/admin/content/templates/${encodeURIComponent(templateId)}/versions/${version}`,
          token
        );
        synchronizeDetail(next);
      } finally {
        setBusy("");
      }
    },
    [sessionToken, synchronizeDetail]
  );

  const refreshCatalog = useCallback(
    async (
      preferredTemplateId?: string,
      preferredVersion?: number,
      token = sessionToken
    ) => {
      if (!token) return;
      setBusy("catalog");
      setError("");
      try {
        const nextCatalog = await jsonRequest<CatalogTemplate[]>(
          "/api/admin/content/templates",
          token
        );
        setCatalog(nextCatalog);
        const template =
          nextCatalog.find((item) => item.id === preferredTemplateId) ??
          nextCatalog[0];
        if (!template) {
          setDetail(null);
          return;
        }
        const version =
          template.versions.find((item) => item.version === preferredVersion) ??
          template.versions.find((item) => ["draft", "review"].includes(item.status)) ??
          template.versions.find((item) => item.version === template.active_version) ??
          template.versions[0];
        if (version) {
          const next = await jsonRequest<VersionDetail>(
            `/api/admin/content/templates/${encodeURIComponent(template.id)}/versions/${version.version}`,
            token
          );
          synchronizeDetail(next);
        }
      } finally {
        setBusy("");
      }
    },
    [sessionToken, synchronizeDetail]
  );

  useEffect(() => {
    let active = true;
    let unsubscribe = () => undefined;
    void Promise.resolve()
      .then(async () => {
        const supabase = getBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (active) {
          setSessionToken(data.session?.access_token ?? "");
          setSessionChecked(true);
        }
        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
          if (active) {
            setSessionToken(session?.access_token ?? "");
            setSessionChecked(true);
          }
        });
        unsubscribe = () => listener.subscription.unsubscribe();
      })
      .catch((errorValue) => {
        if (active) {
          setError(errorValue instanceof Error ? errorValue.message : "Supabase Auth unavailable");
          setSessionChecked(true);
        }
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionToken) return;
    let active = true;
    void Promise.resolve()
      .then(() => refreshCatalog(undefined, undefined, sessionToken))
      .catch((errorValue) => {
        if (active) setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
      });
    return () => {
      active = false;
    };
  }, [refreshCatalog, sessionToken]);

  async function createDraft() {
    if (!sessionToken || !selectedTemplateId) return;
    setBusy("draft");
    setError("");
    setMessage("");
    try {
      const result = await jsonRequest<{ version: number }>(
        `/api/admin/content/templates/${encodeURIComponent(selectedTemplateId)}/draft`,
        sessionToken,
        { method: "POST", body: "{}" }
      );
      await refreshCatalog(selectedTemplateId, result.version);
      setMessage(`טיוטה v${result.version} מוכנה לעריכה.`);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
    } finally {
      setBusy("");
    }
  }

  async function saveMetadata() {
    if (!sessionToken || !detail || !metadataEditor) return;
    setBusy("metadata");
    setError("");
    setMessage("");
    try {
      const theme = parseObjectJson(metadataEditor.themeJson, "Theme");
      const routeConfig = parseObjectJson(metadataEditor.routeConfigJson, "Route config");
      const next = await jsonRequest<VersionDetail>(
        `/api/admin/content/templates/${encodeURIComponent(detail.template.id)}/versions/${detail.version.version}`,
        sessionToken,
        {
          method: "PATCH",
          body: JSON.stringify({
            metadata: {
              releaseName: metadataEditor.releaseName,
              releaseNotes: metadataEditor.releaseNotes,
              status: metadataEditor.status,
              theme,
              routeConfig
            }
          })
        }
      );
      synchronizeDetail(next, checkpointEditor?.checkpoint.id);
      await refreshCatalog(detail.template.id, detail.version.version);
      setMessage("פרטי הגרסה נשמרו.");
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
    } finally {
      setBusy("");
    }
  }

  async function saveCheckpoint() {
    if (!sessionToken || !detail || !checkpointEditor) return;
    setBusy("checkpoint");
    setError("");
    setMessage("");
    try {
      const validation = parseObjectJson(checkpointEditor.validationJson, "Validation");
      const hints = parseArrayJson(checkpointEditor.hintsJson, "Hints");
      const scoring = parseObjectJson(checkpointEditor.scoringJson, "Scoring");
      const accessibility = parseObjectJson(
        checkpointEditor.accessibilityJson,
        "Accessibility"
      );
      const checkpoint = checkpointEditor.checkpoint;
      const config = {
        ...checkpoint.config,
        validation,
        hints,
        scoring
      };
      const next = await jsonRequest<VersionDetail>(
        `/api/admin/content/templates/${encodeURIComponent(detail.template.id)}/versions/${detail.version.version}`,
        sessionToken,
        {
          method: "PATCH",
          body: JSON.stringify({
            checkpoint: {
              id: checkpoint.id,
              kind: checkpoint.kind,
              latitude: checkpoint.latitude,
              longitude: checkpoint.longitude,
              radiusMeters: checkpoint.radius_meters,
              isOptional: checkpoint.is_optional,
              isActive: checkpoint.is_active,
              accessibility,
              config
            }
          })
        }
      );
      synchronizeDetail(next, checkpoint.id);
      await refreshCatalog(detail.template.id, detail.version.version);
      setMessage(`התחנה ${checkpoint.slug} נשמרה.`);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
    } finally {
      setBusy("");
    }
  }

  async function saveHealth() {
    if (!sessionToken || !detail || !checkpointEditor) return;
    setBusy("health");
    setError("");
    setMessage("");
    try {
      await jsonRequest(
        `/api/admin/content/checkpoints/${encodeURIComponent(checkpointEditor.checkpoint.id)}/health`,
        sessionToken,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: checkpointEditor.healthStatus,
            notes: checkpointEditor.healthNotes,
            checklist: checkpointEditor.checklist
          })
        }
      );
      await openVersion(detail.template.id, detail.version.version);
      await refreshCatalog(detail.template.id, detail.version.version);
      setMessage("בדיקת השטח נשמרה.");
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
    } finally {
      setBusy("");
    }
  }

  async function publishVersion() {
    if (!sessionToken || !detail) return;
    if (!window.confirm(`לפרסם את גרסה ${detail.version.version} כגרסת הייצור החדשה?`)) {
      return;
    }
    setBusy("publish");
    setError("");
    setMessage("");
    try {
      const report = await jsonRequest<VersionDetail["report"]>(
        `/api/admin/content/templates/${encodeURIComponent(detail.template.id)}/versions/${detail.version.version}/publish`,
        sessionToken,
        { method: "POST", body: JSON.stringify({ allowUnverified: false }) }
      );
      if (!report.ok) {
        setError("הפרסום נחסם. יש לתקן את בדיקות התוכן והשטח שמופיעות בדוח.");
        await openVersion(detail.template.id, detail.version.version);
        return;
      }
      await refreshCatalog(detail.template.id, detail.version.version);
      setMessage(`גרסה ${detail.version.version} פורסמה והיא פעילה להרצות חדשות.`);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
    } finally {
      setBusy("");
    }
  }

  function selectCheckpoint(checkpoint: DetailCheckpoint) {
    setCheckpointEditor(makeCheckpointEditor(checkpoint));
    setError("");
    setMessage("");
  }

  function updateLocalizedContent(
    locale: "he" | "en",
    field: string,
    value: string
  ) {
    setCheckpointEditor((current) => {
      if (!current) return current;
      const config = objectValue(current.checkpoint.config);
      const content = objectValue(config.content);
      const localized = objectValue(content[locale]);
      return {
        ...current,
        checkpoint: {
          ...current.checkpoint,
          config: {
            ...config,
            content: {
              ...content,
              [locale]: { ...localized, [field]: value }
            }
          }
        }
      };
    });
  }

  function updateCheckpointField(
    field: keyof DetailCheckpoint,
    value: string | number | boolean | null
  ) {
    setCheckpointEditor((current) =>
      current
        ? {
            ...current,
            checkpoint: { ...current.checkpoint, [field]: value }
          }
        : current
    );
  }

  function setFieldVerificationRequired(required: boolean) {
    setCheckpointEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        checkpoint: {
          ...current.checkpoint,
          config: {
            ...current.checkpoint.config,
            field_verification_required: required
          }
        }
      };
    });
  }

  if (!sessionChecked) {
    return <main className={styles.shell}><div className={styles.loading}>טוען Content OS…</div></main>;
  }

  if (!sessionToken) {
    return (
      <main className={styles.shell}>
        <section className={styles.loginCard}>
          <span className={styles.eyebrow}>Protected workspace</span>
          <h1>נדרשת כניסת מנהל</h1>
          <p className={styles.muted}>
            ה־Content Operating System משתמש באותו Magic Link ורשימת מנהלים של מסך המערכת.
          </p>
          <Link className={`${styles.button} ${styles.buttonPrimary}`} href="/admin">
            מעבר לכניסה המאובטחת
          </Link>
          {error && <div className={styles.error}>{error}</div>}
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
              עריכה גרסאית, בדיקות דו־לשוניות, בריאות תחנות ופרסום אטומי. הרצות קיימות
              נשארות על ה־snapshot שלהן; רק הרצות חדשות מקבלות את הגרסה שפורסמה.
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.button} href="/admin">System Admin</Link>
            <button
              className={styles.button}
              onClick={createDraft}
              disabled={!selectedTemplateId || busy === "draft"}
            >
              {busy === "draft" ? "יוצר טיוטה…" : "יצירת טיוטה חדשה"}
            </button>
            <button
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={publishVersion}
              disabled={
                !detail ||
                !["draft", "review"].includes(detail.version.status) ||
                !detail.report.ok ||
                busy === "publish"
              }
            >
              {busy === "publish" ? "מפרסם…" : "פרסום גרסה"}
            </button>
          </div>
        </header>

        {message && <div className={styles.success}>{message}</div>}
        {error && <div className={styles.error}>{error}</div>}

        {!catalog.length && busy !== "catalog" ? (
          <section className={styles.emptyState}>
            <h2>עדיין אין תבניות תוכן</h2>
            <p className={styles.muted}>יש ליצור או לייבא תבנית מסלול לפני פתיחת הסטודיו.</p>
          </section>
        ) : (
          <div className={styles.workspace}>
            <aside className={styles.sidebar}>
              <div className={styles.sidebarHeader}>
                <span className={styles.eyebrow}>Routes</span>
                <h2>מסלולים וגרסאות</h2>
              </div>
              {catalog.map((template) => (
                <div key={template.id}>
                  <button
                    className={`${styles.templateButton} ${
                      selectedTemplateId === template.id ? styles.templateActive : ""
                    }`}
                    onClick={() => {
                      const version =
                        template.versions.find((item) => ["draft", "review"].includes(item.status)) ??
                        template.versions.find((item) => item.version === template.active_version) ??
                        template.versions[0];
                      if (version) void openVersion(template.id, version.version);
                    }}
                  >
                    <strong>{templateTitle(template)}</strong>
                    <small>{template.slug}</small>
                  </button>
                  {selectedTemplateId === template.id && (
                    <div className={styles.versionList}>
                      {template.versions.map((version) => (
                        <button
                          key={version.version}
                          className={`${styles.versionButton} ${
                            selectedVersion === version.version ? styles.versionActive : ""
                          }`}
                          onClick={() => void openVersion(template.id, version.version)}
                        >
                          <span>
                            <strong>v{version.version} · {version.release_name || "ללא שם"}</strong>
                            <small>
                              {version.checkpointCount} תחנות · {version.health.verified} מאומתות
                            </small>
                          </span>
                          <span className={statusClassName(version.status)}>{version.status}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </aside>

            <section className={styles.main}>
              {busy === "catalog" || busy === "version" || !detail ? (
                <div className={styles.loading}>טוען גרסת תוכן…</div>
              ) : (
                <>
                  <div className={styles.summaryGrid}>
                    <article className={styles.metric}>
                      <span>גרסה נבחרת</span>
                      <strong>v{detail.version.version}</strong>
                    </article>
                    <article className={styles.metric}>
                      <span>תחנות פעילות</span>
                      <strong>{detail.report.checkpointCount}</strong>
                    </article>
                    <article className={styles.metric}>
                      <span>שגיאות תוכן</span>
                      <strong>{detail.report.errors.length}</strong>
                    </article>
                    <article className={styles.metric}>
                      <span>מחכות לאימות שטח</span>
                      <strong>{detail.report.unverifiedCount}</strong>
                    </article>
                  </div>

                  <section className={styles.panel}>
                    <div className={styles.panelHeader}>
                      <div>
                        <span className={statusClassName(detail.version.status)}>
                          {detail.version.status}
                        </span>
                        <h2>גרסה, Theme והגדרות מסלול</h2>
                        <p className={styles.muted}>
                          גרסה שפורסמה היא immutable. כל שינוי מתחיל משכפול לגרסת טיוטה חדשה.
                        </p>
                      </div>
                      <button
                        className={`${styles.button} ${styles.buttonPrimary}`}
                        onClick={saveMetadata}
                        disabled={
                          !metadataEditor ||
                          !["draft", "review"].includes(detail.version.status) ||
                          busy === "metadata"
                        }
                      >
                        {busy === "metadata" ? "שומר…" : "שמירת גרסה"}
                      </button>
                    </div>

                    {metadataEditor && (
                      <div className={styles.formGrid}>
                        <label className={styles.field}>
                          <span>שם גרסה</span>
                          <input
                            value={metadataEditor.releaseName}
                            onChange={(event) =>
                              setMetadataEditor({ ...metadataEditor, releaseName: event.target.value })
                            }
                            disabled={!["draft", "review"].includes(detail.version.status)}
                          />
                        </label>
                        <label className={styles.selectField}>
                          <span>שלב עבודה</span>
                          <select
                            value={metadataEditor.status}
                            onChange={(event) =>
                              setMetadataEditor({
                                ...metadataEditor,
                                status: event.target.value === "review" ? "review" : "draft"
                              })
                            }
                            disabled={!["draft", "review"].includes(detail.version.status)}
                          >
                            <option value="draft">Draft</option>
                            <option value="review">Ready for review</option>
                          </select>
                        </label>
                        <label className={`${styles.textAreaField} ${styles.full}`}>
                          <span>Release notes</span>
                          <textarea
                            value={metadataEditor.releaseNotes}
                            onChange={(event) =>
                              setMetadataEditor({ ...metadataEditor, releaseNotes: event.target.value })
                            }
                            disabled={!["draft", "review"].includes(detail.version.status)}
                          />
                        </label>
                        <label className={`${styles.textAreaField} ${styles.codeArea}`}>
                          <span>Theme JSON</span>
                          <textarea
                            value={metadataEditor.themeJson}
                            onChange={(event) =>
                              setMetadataEditor({ ...metadataEditor, themeJson: event.target.value })
                            }
                            disabled={!["draft", "review"].includes(detail.version.status)}
                          />
                        </label>
                        <label className={`${styles.textAreaField} ${styles.codeArea}`}>
                          <span>Route config JSON</span>
                          <textarea
                            value={metadataEditor.routeConfigJson}
                            onChange={(event) =>
                              setMetadataEditor({ ...metadataEditor, routeConfigJson: event.target.value })
                            }
                            disabled={!["draft", "review"].includes(detail.version.status)}
                          />
                        </label>
                      </div>
                    )}
                  </section>

                  <section className={styles.editor}>
                    <div className={styles.editorHeader}>
                      <div>
                        <span className={styles.eyebrow}>Checkpoint authoring</span>
                        <h2>תחנות, תוכן ובדיקת שטח</h2>
                      </div>
                    </div>
                    <div className={styles.checkpointLayout}>
                      <div className={styles.checkpointList}>
                        {detail.checkpoints.map((checkpoint) => (
                          <button
                            key={checkpoint.id}
                            className={`${styles.checkpointButton} ${
                              checkpointEditor?.checkpoint.id === checkpoint.id
                                ? styles.checkpointActive
                                : ""
                            }`}
                            onClick={() => selectCheckpoint(checkpoint)}
                          >
                            <span className={styles.sequence}>{checkpoint.sequence_no}</span>
                            <span>
                              <strong>{localizedValue(checkpoint, "he", "title") || checkpoint.slug}</strong>
                              <small>{checkpoint.kind} · {checkpoint.slug}</small>
                            </span>
                            <span className={healthClassName(checkpoint.health?.status ?? "pending")} />
                          </button>
                        ))}
                      </div>

                      {checkpointEditor && (
                        <article className={styles.checkpointCard}>
                          <div className={styles.checkpointTop}>
                            <div>
                              <span className={styles.status}>#{checkpointEditor.checkpoint.sequence_no}</span>
                              <h2>{checkpointEditor.checkpoint.slug}</h2>
                              <p className={styles.muted}>
                                מזהה התחנה נשאר יציב בין גרסאות כדי לשמור אנליטיקה והשוואות.
                              </p>
                            </div>
                            <button
                              className={`${styles.button} ${styles.buttonPrimary}`}
                              onClick={saveCheckpoint}
                              disabled={
                                !["draft", "review"].includes(detail.version.status) ||
                                busy === "checkpoint"
                              }
                            >
                              {busy === "checkpoint" ? "שומר תחנה…" : "שמירת התחנה"}
                            </button>
                          </div>

                          <div className={styles.section}>
                            <h3>מבנה והתנהגות</h3>
                            <div className={styles.formGrid}>
                              <label className={styles.selectField}>
                                <span>סוג תחנה</span>
                                <select
                                  value={checkpointEditor.checkpoint.kind}
                                  onChange={(event) => updateCheckpointField("kind", event.target.value)}
                                  disabled={!["draft", "review"].includes(detail.version.status)}
                                >
                                  {checkpointKinds.map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                  ))}
                                </select>
                              </label>
                              <div>
                                <label className={styles.switchRow}>
                                  <input
                                    type="checkbox"
                                    checked={checkpointEditor.checkpoint.is_active}
                                    onChange={(event) => updateCheckpointField("is_active", event.target.checked)}
                                    disabled={!["draft", "review"].includes(detail.version.status)}
                                  />
                                  תחנה פעילה בגרסה
                                </label>
                                <label className={styles.switchRow}>
                                  <input
                                    type="checkbox"
                                    checked={checkpointEditor.checkpoint.is_optional}
                                    onChange={(event) => updateCheckpointField("is_optional", event.target.checked)}
                                    disabled={!["draft", "review"].includes(detail.version.status)}
                                  />
                                  תחנה אופציונלית
                                </label>
                                <label className={styles.switchRow}>
                                  <input
                                    type="checkbox"
                                    checked={checkpointEditor.checkpoint.config.field_verification_required === true}
                                    onChange={(event) => setFieldVerificationRequired(event.target.checked)}
                                    disabled={!["draft", "review"].includes(detail.version.status)}
                                  />
                                  נדרש אימות פיזי לפני פרסום
                                </label>
                              </div>
                            </div>
                          </div>

                          <div className={styles.section}>
                            <h3>תוכן דו־לשוני</h3>
                            <div className={styles.contentGrid}>
                              {(["he", "en"] as const).map((locale) => (
                                <div key={locale}>
                                  <span className={styles.status}>{locale === "he" ? "עברית" : "English"}</span>
                                  <div className={styles.formGrid}>
                                    <label className={`${styles.field} ${styles.full}`}>
                                      <span>כותרת</span>
                                      <input
                                        value={localizedValue(checkpointEditor.checkpoint, locale, "title")}
                                        onChange={(event) => updateLocalizedContent(locale, "title", event.target.value)}
                                        disabled={!["draft", "review"].includes(detail.version.status)}
                                      />
                                    </label>
                                    <label className={`${styles.textAreaField} ${styles.full}`}>
                                      <span>Story</span>
                                      <textarea
                                        value={localizedValue(checkpointEditor.checkpoint, locale, "story")}
                                        onChange={(event) => updateLocalizedContent(locale, "story", event.target.value)}
                                        disabled={!["draft", "review"].includes(detail.version.status)}
                                      />
                                    </label>
                                    <label className={`${styles.textAreaField} ${styles.full}`}>
                                      <span>משימה / Prompt</span>
                                      <textarea
                                        value={localizedValue(checkpointEditor.checkpoint, locale, "prompt")}
                                        onChange={(event) => updateLocalizedContent(locale, "prompt", event.target.value)}
                                        disabled={!["draft", "review"].includes(detail.version.status)}
                                      />
                                    </label>
                                    <label className={`${styles.textAreaField} ${styles.full}`}>
                                      <span>רמז מיקום</span>
                                      <textarea
                                        value={localizedValue(checkpointEditor.checkpoint, locale, "locationHint")}
                                        onChange={(event) => updateLocalizedContent(locale, "locationHint", event.target.value)}
                                        disabled={!["draft", "review"].includes(detail.version.status)}
                                      />
                                    </label>
                                    <label className={`${styles.textAreaField} ${styles.full}`}>
                                      <span>Success copy</span>
                                      <textarea
                                        value={localizedValue(checkpointEditor.checkpoint, locale, "success")}
                                        onChange={(event) => updateLocalizedContent(locale, "success", event.target.value)}
                                        disabled={!["draft", "review"].includes(detail.version.status)}
                                      />
                                    </label>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className={styles.section}>
                            <h3>מיקום</h3>
                            <div className={styles.locationGrid}>
                              <label className={styles.field}>
                                <span>Latitude</span>
                                <input
                                  type="number"
                                  step="any"
                                  value={checkpointEditor.checkpoint.latitude ?? ""}
                                  onChange={(event) =>
                                    updateCheckpointField(
                                      "latitude",
                                      event.target.value === "" ? null : Number(event.target.value)
                                    )
                                  }
                                  disabled={!["draft", "review"].includes(detail.version.status)}
                                />
                              </label>
                              <label className={styles.field}>
                                <span>Longitude</span>
                                <input
                                  type="number"
                                  step="any"
                                  value={checkpointEditor.checkpoint.longitude ?? ""}
                                  onChange={(event) =>
                                    updateCheckpointField(
                                      "longitude",
                                      event.target.value === "" ? null : Number(event.target.value)
                                    )
                                  }
                                  disabled={!["draft", "review"].includes(detail.version.status)}
                                />
                              </label>
                              <label className={styles.field}>
                                <span>רדיוס אימות במטרים</span>
                                <input
                                  type="number"
                                  min="1"
                                  value={checkpointEditor.checkpoint.radius_meters ?? ""}
                                  onChange={(event) =>
                                    updateCheckpointField(
                                      "radius_meters",
                                      event.target.value === "" ? null : Number(event.target.value)
                                    )
                                  }
                                  disabled={!["draft", "review"].includes(detail.version.status)}
                                />
                              </label>
                            </div>
                          </div>

                          <div className={styles.section}>
                            <h3>מנוע משימה — Advanced JSON</h3>
                            <div className={styles.formGrid}>
                              <label className={`${styles.textAreaField} ${styles.codeArea}`}>
                                <span>Validation</span>
                                <textarea
                                  value={checkpointEditor.validationJson}
                                  onChange={(event) =>
                                    setCheckpointEditor({
                                      ...checkpointEditor,
                                      validationJson: event.target.value
                                    })
                                  }
                                  disabled={!["draft", "review"].includes(detail.version.status)}
                                />
                              </label>
                              <label className={`${styles.textAreaField} ${styles.codeArea}`}>
                                <span>Hints</span>
                                <textarea
                                  value={checkpointEditor.hintsJson}
                                  onChange={(event) =>
                                    setCheckpointEditor({
                                      ...checkpointEditor,
                                      hintsJson: event.target.value
                                    })
                                  }
                                  disabled={!["draft", "review"].includes(detail.version.status)}
                                />
                              </label>
                              <label className={`${styles.textAreaField} ${styles.codeArea}`}>
                                <span>Scoring</span>
                                <textarea
                                  value={checkpointEditor.scoringJson}
                                  onChange={(event) =>
                                    setCheckpointEditor({
                                      ...checkpointEditor,
                                      scoringJson: event.target.value
                                    })
                                  }
                                  disabled={!["draft", "review"].includes(detail.version.status)}
                                />
                              </label>
                              <label className={`${styles.textAreaField} ${styles.codeArea}`}>
                                <span>Accessibility</span>
                                <textarea
                                  value={checkpointEditor.accessibilityJson}
                                  onChange={(event) =>
                                    setCheckpointEditor({
                                      ...checkpointEditor,
                                      accessibilityJson: event.target.value
                                    })
                                  }
                                  disabled={!["draft", "review"].includes(detail.version.status)}
                                />
                              </label>
                            </div>
                          </div>

                          <div className={styles.section}>
                            <div className={styles.checkpointTop}>
                              <div>
                                <h3>Field verification & station health</h3>
                                <p className={styles.muted}>
                                  בדיקה זו היא שער פרסום. יש לבצע אותה במקום הפיזי ולתעד חריגות.
                                </p>
                              </div>
                              <button
                                className={styles.button}
                                onClick={saveHealth}
                                disabled={busy === "health"}
                              >
                                {busy === "health" ? "שומר בדיקה…" : "שמירת בדיקת שטח"}
                              </button>
                            </div>
                            <div className={styles.formGrid}>
                              <label className={styles.selectField}>
                                <span>מצב התחנה</span>
                                <select
                                  value={checkpointEditor.healthStatus}
                                  onChange={(event) =>
                                    setCheckpointEditor({
                                      ...checkpointEditor,
                                      healthStatus: event.target.value
                                    })
                                  }
                                >
                                  <option value="not_required">לא נדרש</option>
                                  <option value="pending">ממתינה לבדיקה</option>
                                  <option value="verified">מאומתת ותקינה</option>
                                  <option value="needs_attention">דורשת טיפול</option>
                                  <option value="blocked">חסומה</option>
                                </select>
                              </label>
                              <label className={`${styles.textAreaField} ${styles.full}`}>
                                <span>הערות שטח</span>
                                <textarea
                                  value={checkpointEditor.healthNotes}
                                  onChange={(event) =>
                                    setCheckpointEditor({
                                      ...checkpointEditor,
                                      healthNotes: event.target.value
                                    })
                                  }
                                />
                              </label>
                            </div>
                            <div className={styles.healthGrid}>
                              {checklistFields.map(([key, label]) => (
                                <label className={styles.checkRow} key={key}>
                                  <input
                                    type="checkbox"
                                    checked={checkpointEditor.checklist[key] === true}
                                    onChange={(event) =>
                                      setCheckpointEditor({
                                        ...checkpointEditor,
                                        checklist: {
                                          ...checkpointEditor.checklist,
                                          [key]: event.target.checked
                                        }
                                      })
                                    }
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>
                          </div>
                        </article>
                      )}
                    </div>
                  </section>

                  <section className={styles.panel}>
                    <div className={styles.panelHeader}>
                      <div>
                        <span className={styles.eyebrow}>Publish gate</span>
                        <h2>{detail.report.ok ? "הגרסה מוכנה לפרסום" : "הגרסה עדיין לא מוכנה"}</h2>
                        <p className={styles.muted}>
                          הפרסום מעדכן את active_version בעסקה אחת. הרצות קיימות אינן משתנות.
                        </p>
                      </div>
                      <span className={detail.report.ok ? styles.success : styles.notice}>
                        {detail.report.ok ? "PASS" : "BLOCKED"}
                      </span>
                    </div>
                    <div className={styles.report}>
                      {detail.report.errors.map((issue) => (
                        <div className={styles.error} key={`${issue.code}-${issue.checkpointId ?? "route"}`}>
                          <strong>{issue.checkpointSlug ?? "Route"}</strong> · {issue.message}
                        </div>
                      ))}
                      {detail.report.warnings.map((issue) => (
                        <div className={styles.issue} key={`${issue.code}-${issue.checkpointId ?? "route"}`}>
                          <strong>{issue.checkpointSlug ?? "Route"}</strong> · {issue.message}
                        </div>
                      ))}
                      {!detail.report.errors.length && !detail.report.warnings.length && (
                        <div className={styles.success}>
                          כל שדות החובה, הסיום, המיקום ובדיקות השטח תקינים.
                        </div>
                      )}
                    </div>
                  </section>

                  <section className={styles.panel}>
                    <span className={styles.eyebrow}>Audit trail</span>
                    <h2>היסטוריית פעולות</h2>
                    <div className={styles.audit}>
                      {detail.audit.length === 0 && (
                        <p className={styles.muted}>עדיין אין פעולות מתועדות בגרסה זו.</p>
                      )}
                      {detail.audit.map((entry) => (
                        <div className={styles.auditItem} key={entry.id}>
                          <time>{new Date(entry.created_at).toLocaleString("he-IL")}</time>
                          <div>
                            <strong>{entry.action}</strong>
                            <div className={styles.muted}>{entry.actor_email ?? "system"}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
