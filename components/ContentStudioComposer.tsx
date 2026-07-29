"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import styles from "./ContentStudioComposer.module.css";

type VersionSummary = {
  version: number;
  status: string;
  release_name: string | null;
  checkpointCount: number;
  runCount: number;
  activeRunCount: number;
  isActiveVersion: boolean;
  canDelete: boolean;
  deleteBlockReason: string | null;
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
  runCount: number;
  activeRunCount: number;
  canDelete: boolean;
  deleteBlockReason: string | null;
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

type LocalizedContent = {
  title: string;
  story: string;
  prompt: string;
  locationHint: string;
  success: string;
};

type HintDraft = { he: string; en: string; penalty: number };

type CheckpointDraft = {
  checkpoint: Checkpoint;
  he: LocalizedContent;
  en: LocalizedContent;
  acceptedAnswers: string;
  fuzzyThreshold: number;
  choiceOptions: string;
  acceptedOption: string;
  photoCriteria: string;
  confidenceThreshold: number;
  hints: HintDraft[];
  basePoints: number;
  wrongPenalty: number;
  hintPenalty: number;
  speedBonusMax: number;
  speedBonusWindowSeconds: number;
  interactionPrimary: string;
  webFallback: boolean;
  requiresScan: boolean;
  scanSlug: string;
  acceptWhatsAppMedia: boolean;
  fallbackEnabled: boolean;
  fallbackHe: string;
  fallbackEn: string;
  fallbackAccepted: string;
  wheelchair: boolean;
  stroller: boolean;
  fieldRequired: boolean;
  healthStatus: string;
  healthNotes: string;
  checklist: Record<string, boolean>;
};

const checkpointKinds = [
  ["text", "תשובת טקסט"],
  ["choice", "בחירה"],
  ["scan", "סריקת QR / NFC"],
  ["location", "מיקום + תשובה"],
  ["photo", "משימת צילום"],
  ["hybrid", "משולב"],
  ["finale", "תחנת סיום"]
] as const;

const checklistFields = [
  ["signageVisible", "השילוט קיים וקריא"],
  ["accessClear", "הגישה פתוחה"],
  ["safetyOk", "התחנה בטוחה"],
  ["lightingOk", "התאורה מספקת"],
  ["qrPresent", "קוד QR נמצא במקום"],
  ["nfcPresent", "תג NFC נמצא במקום"]
] as const;

const emptyLocalized = (): LocalizedContent => ({
  title: "",
  story: "",
  prompt: "",
  locationHint: "",
  success: ""
});

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const arrayValue = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const textValue = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const numberValue = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const booleanValue = (value: unknown, fallback = false) =>
  typeof value === "boolean" ? value : fallback;
const lines = (value: string) =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
const pretty = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

const localizedContent = (checkpoint: Checkpoint, locale: "he" | "en") => {
  const content = objectValue(checkpoint.config.content);
  const localized = objectValue(content[locale]);
  return {
    title: textValue(localized.title),
    story: textValue(localized.story),
    prompt: textValue(localized.prompt),
    locationHint: textValue(localized.locationHint),
    success: textValue(localized.success)
  };
};

const makeCheckpointDraft = (checkpoint?: Checkpoint): CheckpointDraft | null => {
  if (!checkpoint) return null;
  const config = objectValue(checkpoint.config);
  const validation = objectValue(config.validation);
  const interaction = objectValue(config.interaction);
  const scoring = objectValue(config.scoring);
  const fallback = objectValue(config.fallback);
  const accessibility = objectValue(checkpoint.accessibility);
  const checklist = objectValue(checkpoint.health?.checklist);
  const hints = arrayValue(config.hints).map((raw) => {
    const hint = objectValue(raw);
    return {
      he: textValue(hint.he),
      en: textValue(hint.en),
      penalty: numberValue(hint.penalty, 10)
    };
  });

  return {
    checkpoint,
    he: localizedContent(checkpoint, "he"),
    en: localizedContent(checkpoint, "en"),
    acceptedAnswers: arrayValue(validation.accepted)
      .filter((value): value is string => typeof value === "string")
      .join("\n"),
    fuzzyThreshold: numberValue(validation.fuzzyThreshold, 0.94),
    choiceOptions: arrayValue(validation.options)
      .filter((value): value is string => typeof value === "string")
      .join("\n"),
    acceptedOption: textValue(validation.acceptedOption),
    photoCriteria: textValue(validation.criteria),
    confidenceThreshold: numberValue(validation.confidenceThreshold, 0.86),
    hints,
    basePoints: numberValue(scoring.basePoints, 100),
    wrongPenalty: numberValue(scoring.wrongPenalty, 5),
    hintPenalty: numberValue(scoring.hintPenalty, 10),
    speedBonusMax: numberValue(scoring.speedBonusMax, 20),
    speedBonusWindowSeconds: numberValue(scoring.speedBonusWindowSeconds, 420),
    interactionPrimary: textValue(interaction.primary, checkpoint.kind === "photo" ? "photo" : "web"),
    webFallback: booleanValue(interaction.webFallback, true),
    requiresScan: booleanValue(interaction.requiresScan),
    scanSlug: textValue(interaction.scanSlug),
    acceptWhatsAppMedia: booleanValue(interaction.acceptWhatsAppMedia),
    fallbackEnabled: Object.keys(fallback).length > 0,
    fallbackHe: textValue(fallback.he),
    fallbackEn: textValue(fallback.en),
    fallbackAccepted: arrayValue(fallback.accepted)
      .filter((value): value is string => typeof value === "string")
      .join("\n"),
    wheelchair: booleanValue(accessibility.wheelchair, true),
    stroller: booleanValue(accessibility.stroller, true),
    fieldRequired:
      config.field_verification_required === true ||
      accessibility.field_verification_required === true,
    healthStatus: checkpoint.health?.status ?? "not_required",
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

const statusClass = (status: string) => {
  if (status === "published") return `${styles.status} ${styles.statusPublished}`;
  if (status === "review") return `${styles.status} ${styles.statusReview}`;
  if (status === "draft") return `${styles.status} ${styles.statusDraft}`;
  return styles.status;
};

const routeTitle = (template: CatalogTemplate) =>
  textValue(template.title.he) || textValue(template.title.en) || template.slug;

export function ContentStudioComposer() {
  const [token, setToken] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [catalog, setCatalog] = useState<CatalogTemplate[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [checkpointDraft, setCheckpointDraft] = useState<CheckpointDraft | null>(null);
  const [routeSlug, setRouteSlug] = useState("");
  const [routeBrand, setRouteBrand] = useState("tlv-quest");
  const [routeTitleHe, setRouteTitleHe] = useState("");
  const [routeTitleEn, setRouteTitleEn] = useState("");
  const [routeDescriptionHe, setRouteDescriptionHe] = useState("");
  const [routeDescriptionEn, setRouteDescriptionEn] = useState("");
  const [releaseName, setReleaseName] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [workStatus, setWorkStatus] = useState<"draft" | "review">("draft");
  const [themeJson, setThemeJson] = useState("{}");
  const [routeConfigJson, setRouteConfigJson] = useState("{}");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [newRouteOpen, setNewRouteOpen] = useState(false);
  const [newRoute, setNewRoute] = useState({
    slug: "",
    titleHe: "",
    titleEn: "",
    descriptionHe: "",
    descriptionEn: ""
  });
  const [newCheckpointOpen, setNewCheckpointOpen] = useState(false);
  const [newCheckpoint, setNewCheckpoint] = useState({ slug: "", kind: "text" });
  const [draggedCheckpointId, setDraggedCheckpointId] = useState("");
  const [dropCheckpointId, setDropCheckpointId] = useState("");

  const selectedCatalogTemplate = useMemo(
    () => catalog.find((template) => template.id === selectedTemplateId) ?? null,
    [catalog, selectedTemplateId]
  );
  const selectedVersionSummary = useMemo(
    () =>
      selectedCatalogTemplate?.versions.find(
        (version) => version.version === selectedVersion
      ) ?? null,
    [selectedCatalogTemplate, selectedVersion]
  );
  const editable = detail
    ? ["draft", "review"].includes(detail.version.status)
    : false;

  const syncDetail = useCallback((next: Detail, preferredCheckpointId?: string) => {
    setDetail(next);
    setSelectedTemplateId(next.template.id);
    setSelectedVersion(next.version.version);
    setRouteSlug(next.template.slug);
    setRouteBrand(next.template.brand_key ?? "tlv-quest");
    setRouteTitleHe(textValue(next.template.title.he));
    setRouteTitleEn(textValue(next.template.title.en));
    setRouteDescriptionHe(textValue(next.template.description.he));
    setRouteDescriptionEn(textValue(next.template.description.en));
    setReleaseName(next.version.release_name ?? "");
    setReleaseNotes(next.version.release_notes ?? "");
    setWorkStatus(next.version.status === "review" ? "review" : "draft");
    setThemeJson(pretty(next.version.theme));
    setRouteConfigJson(pretty(next.version.route_config));
    const checkpoint =
      next.checkpoints.find((item) => item.id === preferredCheckpointId) ??
      next.checkpoints[0];
    setCheckpointDraft(makeCheckpointDraft(checkpoint));
  }, []);

  const openVersion = useCallback(
    async (
      templateId: string,
      version: number,
      accessToken = token,
      preferredCheckpointId?: string
    ) => {
      if (!accessToken) return;
      setBusy("detail");
      setError("");
      try {
        const next = await requestJson<Detail>(
          `/api/admin/content/templates/${encodeURIComponent(templateId)}/versions/${version}`,
          accessToken
        );
        syncDetail(next, preferredCheckpointId);
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
      preferredCheckpointId?: string,
      accessToken = token
    ) => {
      if (!accessToken) return;
      setBusy("catalog");
      setError("");
      try {
        const nextCatalog = await requestJson<CatalogTemplate[]>(
          "/api/admin/content/templates",
          accessToken
        );
        setCatalog(nextCatalog);
        const template =
          nextCatalog.find((item) => item.id === preferredTemplateId) ??
          nextCatalog[0];
        const version =
          template?.versions.find((item) => item.version === preferredVersion) ??
          template?.versions.find((item) => item.isActiveVersion) ??
          template?.versions[0];
        if (template && version) {
          const next = await requestJson<Detail>(
            `/api/admin/content/templates/${encodeURIComponent(template.id)}/versions/${version.version}`,
            accessToken
          );
          syncDetail(next, preferredCheckpointId);
        } else {
          setDetail(null);
          setSelectedTemplateId("");
          setSelectedVersion(null);
          setCheckpointDraft(null);
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
    void loadCatalog(undefined, undefined, undefined, token).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unexpected error");
    });
    return () => {
      active = false;
    };
  }, [loadCatalog, token]);

  const runOperation = async (name: string, operation: () => Promise<void>) => {
    setBusy(name);
    setMessage("");
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy("");
    }
  };

  async function createRoute() {
    await runOperation("create-route", async () => {
      const result = await requestJson<{ templateId: string; version: number }>(
        "/api/admin/content/templates",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            slug: newRoute.slug,
            title: { he: newRoute.titleHe, en: newRoute.titleEn },
            description: {
              he: newRoute.descriptionHe,
              en: newRoute.descriptionEn
            },
            brandKey: "tlv-quest"
          })
        }
      );
      setNewRouteOpen(false);
      setNewRoute({
        slug: "",
        titleHe: "",
        titleEn: "",
        descriptionHe: "",
        descriptionEn: ""
      });
      await loadCatalog(result.templateId, result.version);
      setMessage("המסלול החדש נוצר כטיוטה. עכשיו אפשר להוסיף תחנות.");
    });
  }

  async function saveRoute() {
    if (!detail) return;
    await runOperation("save-route", async () => {
      await requestJson(
        `/api/admin/content/templates/${encodeURIComponent(detail.template.id)}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({
            slug: routeSlug,
            brandKey: routeBrand,
            title: { he: routeTitleHe, en: routeTitleEn },
            description: {
              he: routeDescriptionHe,
              en: routeDescriptionEn
            }
          })
        }
      );
      await loadCatalog(detail.template.id, detail.version.version, checkpointDraft?.checkpoint.id);
      setMessage("פרטי המסלול נשמרו.");
    });
  }

  async function deleteRoute() {
    if (!detail || !selectedCatalogTemplate) return;
    if (!window.confirm(`למחוק לצמיתות את המסלול ${routeTitle(selectedCatalogTemplate)}?`)) return;
    await runOperation("delete-route", async () => {
      await requestJson(
        `/api/admin/content/templates/${encodeURIComponent(detail.template.id)}`,
        token,
        { method: "DELETE" }
      );
      await loadCatalog();
      setMessage("המסלול שלא פורסם נמחק.");
    });
  }

  async function cloneVersion() {
    if (!detail) return;
    await runOperation("clone-version", async () => {
      const result = await requestJson<{ version: number }>(
        `/api/admin/content/templates/${encodeURIComponent(detail.template.id)}/draft`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ sourceVersion: detail.version.version })
        }
      );
      await loadCatalog(detail.template.id, result.version);
      setMessage(`נוצרה טיוטה v${result.version} מ־v${detail.version.version}.`);
    });
  }

  async function deleteVersion() {
    if (!detail || !selectedVersionSummary) return;
    if (!window.confirm(`למחוק לצמיתות את גרסה v${detail.version.version}?`)) return;
    await runOperation("delete-version", async () => {
      await requestJson(
        `/api/admin/content/templates/${encodeURIComponent(detail.template.id)}/versions/${detail.version.version}`,
        token,
        { method: "DELETE" }
      );
      await loadCatalog(detail.template.id);
      setMessage(`גרסה v${detail.version.version} נמחקה.`);
    });
  }

  async function saveVersion() {
    if (!detail) return;
    await runOperation("save-version", async () => {
      const theme = JSON.parse(themeJson) as unknown;
      const routeConfig = JSON.parse(routeConfigJson) as unknown;
      if (!theme || typeof theme !== "object" || Array.isArray(theme)) {
        throw new Error("Theme חייב להיות אובייקט JSON.");
      }
      if (!routeConfig || typeof routeConfig !== "object" || Array.isArray(routeConfig)) {
        throw new Error("Route config חייב להיות אובייקט JSON.");
      }
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
              theme,
              routeConfig
            }
          })
        }
      );
      syncDetail(next, checkpointDraft?.checkpoint.id);
      await loadCatalog(detail.template.id, detail.version.version, checkpointDraft?.checkpoint.id);
      setMessage("פרטי הגרסה נשמרו.");
    });
  }

  async function publishVersion() {
    if (!detail) return;
    if (!window.confirm(`לפרסם את v${detail.version.version} כגרסה הפעילה להרצות חדשות?`)) return;
    await runOperation("publish", async () => {
      const report = await requestJson<Detail["report"]>(
        `/api/admin/content/templates/${encodeURIComponent(detail.template.id)}/versions/${detail.version.version}/publish`,
        token,
        { method: "POST", body: JSON.stringify({ allowUnverified: false }) }
      );
      if (!report.ok) throw new Error("הפרסום נחסם על ידי שערי האיכות.");
      await loadCatalog(detail.template.id, detail.version.version);
      setMessage(`v${detail.version.version} פורסמה והיא פעילה להרצות חדשות.`);
    });
  }

  async function createCheckpoint() {
    if (!detail) return;
    await runOperation("create-checkpoint", async () => {
      const result = await requestJson<{ checkpointId: string }>(
        `/api/admin/content/templates/${encodeURIComponent(detail.template.id)}/versions/${detail.version.version}/checkpoints`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            slug: newCheckpoint.slug,
            kind: newCheckpoint.kind,
            afterCheckpointId: checkpointDraft?.checkpoint.id ?? null
          })
        }
      );
      setNewCheckpointOpen(false);
      setNewCheckpoint({ slug: "", kind: "text" });
      await loadCatalog(
        detail.template.id,
        detail.version.version,
        result.checkpointId
      );
      setMessage("התחנה נוספה ונבחרה לעריכה.");
    });
  }

  async function duplicateCheckpoint() {
    if (!detail || !checkpointDraft) return;
    await runOperation("duplicate-checkpoint", async () => {
      const result = await requestJson<{ checkpointId: string }>(
        `/api/admin/content/checkpoints/${encodeURIComponent(checkpointDraft.checkpoint.id)}/duplicate`,
        token,
        { method: "POST", body: "{}" }
      );
      await loadCatalog(
        detail.template.id,
        detail.version.version,
        result.checkpointId
      );
      setMessage("התחנה שוכפלה. אימות השטח של העותק אופס.");
    });
  }

  async function deleteCheckpoint() {
    if (!detail || !checkpointDraft) return;
    if (!window.confirm(`למחוק את התחנה ${checkpointDraft.checkpoint.slug}?`)) return;
    await runOperation("delete-checkpoint", async () => {
      await requestJson(
        `/api/admin/content/checkpoints/${encodeURIComponent(checkpointDraft.checkpoint.id)}`,
        token,
        { method: "DELETE" }
      );
      await loadCatalog(detail.template.id, detail.version.version);
      setMessage("התחנה נמחקה והסדר נדחס מחדש.");
    });
  }

  const buildValidation = (draft: CheckpointDraft) => {
    const kind = draft.checkpoint.kind;
    if (kind === "photo") {
      return {
        type: "photo",
        criteria: draft.photoCriteria.trim(),
        confidenceThreshold: draft.confidenceThreshold
      };
    }
    if (kind === "choice") {
      return {
        type: "choice",
        options: lines(draft.choiceOptions),
        acceptedOption: draft.acceptedOption.trim()
      };
    }
    if (kind === "scan") return { type: "scan" };
    return {
      type: "text",
      accepted: lines(draft.acceptedAnswers),
      fuzzyThreshold: draft.fuzzyThreshold
    };
  };

  async function saveCheckpoint() {
    if (!detail || !checkpointDraft) return;
    await runOperation("save-checkpoint", async () => {
      const item = checkpointDraft.checkpoint;
      const existingConfig = objectValue(item.config);
      const existingInteraction = objectValue(existingConfig.interaction);
      const fallback = checkpointDraft.fallbackEnabled
        ? {
            ...objectValue(existingConfig.fallback),
            type: "text",
            he: checkpointDraft.fallbackHe,
            en: checkpointDraft.fallbackEn,
            accepted: lines(checkpointDraft.fallbackAccepted)
          }
        : null;
      const config = {
        ...existingConfig,
        content: { he: checkpointDraft.he, en: checkpointDraft.en },
        interaction: {
          ...existingInteraction,
          primary: checkpointDraft.interactionPrimary,
          webFallback: checkpointDraft.webFallback,
          requiresScan: checkpointDraft.requiresScan,
          scanSlug: checkpointDraft.scanSlug || item.slug,
          acceptWhatsAppMedia: checkpointDraft.acceptWhatsAppMedia
        },
        validation: buildValidation(checkpointDraft),
        hints: checkpointDraft.hints
          .map((hint) => ({
            he: hint.he.trim(),
            en: hint.en.trim(),
            penalty: hint.penalty
          }))
          .filter((hint) => hint.he || hint.en),
        scoring: {
          basePoints: checkpointDraft.basePoints,
          wrongPenalty: checkpointDraft.wrongPenalty,
          hintPenalty: checkpointDraft.hintPenalty,
          speedBonusMax: checkpointDraft.speedBonusMax,
          speedBonusWindowSeconds: checkpointDraft.speedBonusWindowSeconds
        },
        fallback,
        finale: item.kind === "finale",
        field_verification_required: checkpointDraft.fieldRequired
      };
      const accessibility = {
        ...objectValue(item.accessibility),
        wheelchair: checkpointDraft.wheelchair,
        stroller: checkpointDraft.stroller,
        field_verification_required: checkpointDraft.fieldRequired
      };

      const next = await requestJson<Detail>(
        `/api/admin/content/templates/${encodeURIComponent(detail.template.id)}/versions/${detail.version.version}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({
            checkpoint: {
              id: item.id,
              slug: item.slug,
              kind: item.kind,
              latitude: item.latitude,
              longitude: item.longitude,
              radiusMeters: item.radius_meters,
              isOptional: item.is_optional,
              isActive: item.is_active,
              accessibility,
              config
            }
          })
        }
      );
      syncDetail(next, item.id);
      await loadCatalog(detail.template.id, detail.version.version, item.id);
      setMessage(`התחנה ${item.slug} נשמרה.`);
    });
  }

  async function saveHealth() {
    if (!detail || !checkpointDraft) return;
    await runOperation("save-health", async () => {
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
      await openVersion(
        detail.template.id,
        detail.version.version,
        token,
        checkpointDraft.checkpoint.id
      );
      setMessage("בדיקת השטח נשמרה.");
    });
  }

  async function reorderCheckpoints(checkpointIds: string[]) {
    if (!detail || !editable) return;
    const previous = detail.checkpoints;
    const byId = new Map(previous.map((checkpoint) => [checkpoint.id, checkpoint]));
    const optimistic = checkpointIds
      .map((id, index) => {
        const checkpoint = byId.get(id);
        return checkpoint ? { ...checkpoint, sequence_no: index + 1 } : null;
      })
      .filter((checkpoint): checkpoint is Checkpoint => Boolean(checkpoint));
    setDetail({ ...detail, checkpoints: optimistic });
    try {
      await requestJson(
        `/api/admin/content/templates/${encodeURIComponent(detail.template.id)}/versions/${detail.version.version}/checkpoints`,
        token,
        { method: "PATCH", body: JSON.stringify({ checkpointIds }) }
      );
      await openVersion(
        detail.template.id,
        detail.version.version,
        token,
        checkpointDraft?.checkpoint.id
      );
      setMessage("סדר התחנות נשמר.");
    } catch (cause) {
      setDetail({ ...detail, checkpoints: previous });
      setError(cause instanceof Error ? cause.message : "Reorder failed");
    }
  }

  function moveCheckpoint(checkpointId: string, direction: -1 | 1) {
    if (!detail) return;
    const ids = detail.checkpoints.map((checkpoint) => checkpoint.id);
    const index = ids.indexOf(checkpointId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void reorderCheckpoints(ids);
  }

  function dropCheckpoint(targetId: string) {
    if (!detail || !draggedCheckpointId || draggedCheckpointId === targetId) {
      setDraggedCheckpointId("");
      setDropCheckpointId("");
      return;
    }
    const ids = detail.checkpoints.map((checkpoint) => checkpoint.id);
    const from = ids.indexOf(draggedCheckpointId);
    const to = ids.indexOf(targetId);
    if (from >= 0 && to >= 0) {
      ids.splice(from, 1);
      ids.splice(to, 0, draggedCheckpointId);
      void reorderCheckpoints(ids);
    }
    setDraggedCheckpointId("");
    setDropCheckpointId("");
  }

  function patchCheckpoint(patch: Partial<Checkpoint>) {
    setCheckpointDraft((current) =>
      current
        ? { ...current, checkpoint: { ...current.checkpoint, ...patch } }
        : current
    );
  }

  function patchLocalized(locale: "he" | "en", patch: Partial<LocalizedContent>) {
    setCheckpointDraft((current) =>
      current ? { ...current, [locale]: { ...current[locale], ...patch } } : current
    );
  }

  if (!authChecked) {
    return <main className={styles.shell}><div className={styles.loading}>טוען Content OS…</div></main>;
  }

  if (!token) {
    return (
      <main className={styles.shell}>
        <section className={styles.loginCard}>
          <span className={styles.kicker}>Protected workspace</span>
          <h1>נדרשת כניסת מנהל</h1>
          <p className={styles.muted}>התחבר באמצעות Magic Link במסך הניהול.</p>
          <Link className={`${styles.button} ${styles.primary}`} href="/admin">
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
            <span className={styles.kicker}>Content Operating System · Route Composer</span>
            <h1>בונים מסלול. לא עורכים JSON.</h1>
            <p>
              יצירת מסלולים וגרסאות, CRUD מלא לתחנות, שינוי סדר בגרירה, הגדרת חידות,
              ניקוד, רמזים, אימות שטח ופרסום בטוח להרצות חדשות.
            </p>
          </div>
          <div className={styles.actions}>
            <Link className={styles.button} href="/admin">System Admin</Link>
            <button className={styles.button} onClick={() => setNewRouteOpen(true)}>
              מסלול חדש
            </button>
            <button className={styles.button} onClick={cloneVersion} disabled={!detail || busy === "clone-version"}>
              שכפול גרסה
            </button>
            <button
              className={`${styles.button} ${styles.primary}`}
              onClick={publishVersion}
              disabled={!editable || !detail?.report.ok || busy === "publish"}
            >
              {busy === "publish" ? "מפרסם…" : "פרסום גרסה"}
            </button>
          </div>
        </header>

        {message && <div className={styles.success}>{message}</div>}
        {error && <div className={styles.error}>{error}</div>}

        {!catalog.length && busy !== "catalog" ? (
          <section className={styles.emptyCard}>
            <h2>עדיין אין מסלולים</h2>
            <p className={styles.muted}>צור מסלול ראשון, הוסף תחנות ופרסם כשכל השערים עוברים.</p>
            <button className={`${styles.button} ${styles.primary}`} onClick={() => setNewRouteOpen(true)}>
              יצירת מסלול ראשון
            </button>
          </section>
        ) : (
          <div className={styles.workspace}>
            <aside className={styles.sidebar}>
              <div className={styles.sidebarHeader}>
                <span className={styles.kicker}>Routes & versions</span>
                <h2>ספריית המסלולים</h2>
              </div>
              {catalog.map((template) => (
                <div key={template.id}>
                  <button
                    className={`${styles.routeButton} ${selectedTemplateId === template.id ? styles.active : ""}`}
                    onClick={() => {
                      const version =
                        template.versions.find((item) => item.isActiveVersion) ??
                        template.versions[0];
                      if (version) void openVersion(template.id, version.version);
                    }}
                  >
                    <strong>{routeTitle(template)}</strong>
                    <small>
                      {template.slug} · {template.runCount} הרצות
                    </small>
                  </button>
                  {selectedTemplateId === template.id && (
                    <div className={styles.versionList}>
                      {template.versions.map((version) => (
                        <div className={styles.versionRow} key={version.version}>
                          <button
                            className={`${styles.versionButton} ${selectedVersion === version.version ? styles.active : ""}`}
                            onClick={() => void openVersion(template.id, version.version)}
                          >
                            <strong>v{version.version} · {version.release_name || "ללא שם"}</strong>
                            <small>
                              {version.checkpointCount} תחנות · {version.runCount} הרצות
                            </small>
                          </button>
                          <span className={statusClass(version.status)}>{version.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </aside>

            <section className={styles.main}>
              {!detail || ["catalog", "detail"].includes(busy) ? (
                <div className={styles.loading}>טוען מסלול…</div>
              ) : (
                <>
                  <div className={styles.metrics}>
                    <article className={styles.metric}><span>גרסה</span><strong>v{detail.version.version}</strong></article>
                    <article className={styles.metric}><span>תחנות פעילות</span><strong>{detail.report.checkpointCount}</strong></article>
                    <article className={styles.metric}><span>שגיאות פרסום</span><strong>{detail.report.errors.length}</strong></article>
                    <article className={styles.metric}><span>אימותי שטח</span><strong>{detail.report.unverifiedCount}</strong></article>
                    <article className={styles.metric}><span>הרצות על הגרסה</span><strong>{selectedVersionSummary?.runCount ?? 0}</strong></article>
                  </div>

                  <section className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div>
                        <span className={styles.kicker}>Route identity</span>
                        <h2>פרטי המסלול</h2>
                        <p className={styles.muted}>שם, תיאור ו־slug של מוצר התוכן כולו.</p>
                      </div>
                      <div className={styles.compactActions}>
                        <button className={`${styles.button} ${styles.secondary}`} onClick={saveRoute} disabled={busy === "save-route"}>
                          {busy === "save-route" ? "שומר…" : "שמירת מסלול"}
                        </button>
                        <button
                          className={`${styles.button} ${styles.danger}`}
                          onClick={deleteRoute}
                          disabled={!selectedCatalogTemplate?.canDelete || busy === "delete-route"}
                          title={selectedCatalogTemplate?.deleteBlockReason ?? undefined}
                        >
                          מחיקת מסלול
                        </button>
                      </div>
                    </div>
                    <div className={styles.grid2}>
                      <label className={styles.field}><span>Route slug</span><input value={routeSlug} onChange={(event) => setRouteSlug(event.target.value)} /></label>
                      <label className={styles.field}><span>Brand key</span><input value={routeBrand} onChange={(event) => setRouteBrand(event.target.value)} /></label>
                      <label className={styles.field}><span>שם בעברית</span><input value={routeTitleHe} onChange={(event) => setRouteTitleHe(event.target.value)} /></label>
                      <label className={styles.field}><span>English title</span><input value={routeTitleEn} onChange={(event) => setRouteTitleEn(event.target.value)} /></label>
                      <label className={styles.textarea}><span>תיאור בעברית</span><textarea value={routeDescriptionHe} onChange={(event) => setRouteDescriptionHe(event.target.value)} /></label>
                      <label className={styles.textarea}><span>English description</span><textarea value={routeDescriptionEn} onChange={(event) => setRouteDescriptionEn(event.target.value)} /></label>
                    </div>
                  </section>

                  <section className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div>
                        <span className={statusClass(detail.version.status)}>{detail.version.status}</span>
                        <h2>ניהול גרסה</h2>
                        <p className={styles.muted}>אפשר לפתוח כמה טיוטות, לשכפל מכל גרסה ולמחוק גרסה שאינה בשימוש.</p>
                      </div>
                      <div className={styles.compactActions}>
                        <button className={`${styles.button} ${styles.secondary}`} onClick={saveVersion} disabled={!editable || busy === "save-version"}>
                          {busy === "save-version" ? "שומר…" : "שמירת גרסה"}
                        </button>
                        <button
                          className={`${styles.button} ${styles.danger}`}
                          onClick={deleteVersion}
                          disabled={!selectedVersionSummary?.canDelete || busy === "delete-version"}
                          title={selectedVersionSummary?.deleteBlockReason ?? undefined}
                        >
                          מחיקת גרסה
                        </button>
                      </div>
                    </div>
                    {!selectedVersionSummary?.canDelete && selectedVersionSummary?.deleteBlockReason && (
                      <div className={styles.notice}>{selectedVersionSummary.deleteBlockReason}</div>
                    )}
                    <div className={styles.grid2}>
                      <label className={styles.field}><span>שם גרסה</span><input value={releaseName} onChange={(event) => setReleaseName(event.target.value)} disabled={!editable} /></label>
                      <label className={styles.select}><span>שלב עבודה</span><select value={workStatus} onChange={(event) => setWorkStatus(event.target.value === "review" ? "review" : "draft")} disabled={!editable}><option value="draft">Draft</option><option value="review">Ready for review</option></select></label>
                      <label className={`${styles.textarea} ${styles.full}`}><span>Release notes</span><textarea value={releaseNotes} onChange={(event) => setReleaseNotes(event.target.value)} disabled={!editable} /></label>
                      <label className={`${styles.textarea} ${styles.code}`}><span>Theme JSON</span><textarea value={themeJson} onChange={(event) => setThemeJson(event.target.value)} disabled={!editable} /></label>
                      <label className={`${styles.textarea} ${styles.code}`}><span>Route configuration JSON</span><textarea value={routeConfigJson} onChange={(event) => setRouteConfigJson(event.target.value)} disabled={!editable} /></label>
                    </div>
                  </section>

                  <section className={styles.editorCard}>
                    <div className={styles.editorHeader}>
                      <div>
                        <span className={styles.kicker}>Route composition</span>
                        <h2>תחנות המסלול</h2>
                        <p className={styles.muted}>גרור לשינוי סדר, או השתמש בחצים. כל פעולה נשמרת מיד.</p>
                      </div>
                      <button className={`${styles.button} ${styles.primary}`} onClick={() => setNewCheckpointOpen(true)} disabled={!editable}>
                        הוספת תחנה
                      </button>
                    </div>

                    <div className={styles.checkpointLayout}>
                      <div className={styles.checkpointRail}>
                        <div className={styles.railToolbar}>
                          <strong>{detail.checkpoints.length} תחנות</strong>
                          <small className={styles.muted}>{editable ? "ניתן לגרור" : "קריאה בלבד"}</small>
                        </div>
                        {detail.checkpoints.map((checkpoint, index) => (
                          <div
                            key={checkpoint.id}
                            className={`${styles.checkpointRow} ${checkpointDraft?.checkpoint.id === checkpoint.id ? styles.active : ""} ${draggedCheckpointId === checkpoint.id ? styles.dragging : ""} ${dropCheckpointId === checkpoint.id ? styles.dropTarget : ""}`}
                            draggable={editable}
                            onDragStart={() => setDraggedCheckpointId(checkpoint.id)}
                            onDragOver={(event) => {
                              if (!editable) return;
                              event.preventDefault();
                              setDropCheckpointId(checkpoint.id);
                            }}
                            onDragLeave={() => setDropCheckpointId("")}
                            onDrop={(event) => {
                              event.preventDefault();
                              dropCheckpoint(checkpoint.id);
                            }}
                            onDragEnd={() => {
                              setDraggedCheckpointId("");
                              setDropCheckpointId("");
                            }}
                          >
                            <span className={styles.dragHandle}>⠿</span>
                            <span className={styles.sequence}>{checkpoint.sequence_no}</span>
                            <button className={styles.checkpointButton} onClick={() => setCheckpointDraft(makeCheckpointDraft(checkpoint))}>
                              <strong>{localizedContent(checkpoint, "he").title || checkpoint.slug}</strong>
                              <span className={styles.checkpointMeta}>
                                <small>{checkpoint.kind} · {checkpoint.slug}</small>
                                {!checkpoint.is_active && <span className={`${styles.status} ${styles.statusInactive}`}>inactive</span>}
                              </span>
                            </button>
                            <div className={styles.compactActions}>
                              <button className={styles.iconButton} onClick={() => moveCheckpoint(checkpoint.id, -1)} disabled={!editable || index === 0} aria-label="הזזה למעלה">↑</button>
                              <button className={styles.iconButton} onClick={() => moveCheckpoint(checkpoint.id, 1)} disabled={!editable || index === detail.checkpoints.length - 1} aria-label="הזזה למטה">↓</button>
                              <span className={`${styles.healthDot} ${checkpoint.health?.status === "verified" ? styles.healthVerified : checkpoint.health?.status === "pending" ? styles.healthPending : styles.healthAttention}`} />
                            </div>
                          </div>
                        ))}
                      </div>

                      {checkpointDraft ? (
                        <article className={styles.editorPanel}>
                          <div className={styles.checkpointHeader}>
                            <div>
                              <span className={styles.status}>#{checkpointDraft.checkpoint.sequence_no}</span>
                              <h2>{checkpointDraft.checkpoint.slug}</h2>
                            </div>
                            <div className={styles.compactActions}>
                              <button className={`${styles.button} ${styles.secondary}`} onClick={duplicateCheckpoint} disabled={!editable || busy === "duplicate-checkpoint"}>שכפול</button>
                              <button className={`${styles.button} ${styles.danger}`} onClick={deleteCheckpoint} disabled={!editable || busy === "delete-checkpoint"}>מחיקה</button>
                              <button className={`${styles.button} ${styles.primary}`} onClick={saveCheckpoint} disabled={!editable || busy === "save-checkpoint"}>{busy === "save-checkpoint" ? "שומר…" : "שמירת תחנה"}</button>
                            </div>
                          </div>

                          <div className={styles.section}>
                            <div className={styles.sectionTitle}><h3>זהות והתנהגות</h3></div>
                            <div className={styles.grid2}>
                              <label className={styles.field}><span>Checkpoint slug</span><input value={checkpointDraft.checkpoint.slug} onChange={(event) => patchCheckpoint({ slug: event.target.value })} disabled={!editable} /></label>
                              <label className={styles.select}><span>סוג התחנה</span><select value={checkpointDraft.checkpoint.kind} onChange={(event) => patchCheckpoint({ kind: event.target.value })} disabled={!editable}>{checkpointKinds.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                            </div>
                            <div className={styles.switches}>
                              <label className={styles.switch}><input type="checkbox" checked={checkpointDraft.checkpoint.is_active} onChange={(event) => patchCheckpoint({ is_active: event.target.checked })} disabled={!editable} />פעילה בגרסה</label>
                              <label className={styles.switch}><input type="checkbox" checked={checkpointDraft.checkpoint.is_optional} onChange={(event) => patchCheckpoint({ is_optional: event.target.checked })} disabled={!editable} />אופציונלית</label>
                              <label className={styles.switch}><input type="checkbox" checked={checkpointDraft.fieldRequired} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, fieldRequired: event.target.checked })} disabled={!editable} />דורשת אימות שטח</label>
                            </div>
                          </div>

                          <div className={styles.section}>
                            <div className={styles.sectionTitle}><h3>תוכן דו־לשוני</h3></div>
                            <div className={styles.localeGrid}>
                              {(["he", "en"] as const).map((locale) => {
                                const value = checkpointDraft[locale];
                                return (
                                  <div key={locale}>
                                    <span className={styles.status}>{locale === "he" ? "עברית" : "English"}</span>
                                    <label className={styles.field}><span>כותרת</span><input value={value.title} onChange={(event) => patchLocalized(locale, { title: event.target.value })} disabled={!editable} /></label>
                                    <label className={styles.textarea}><span>Story</span><textarea value={value.story} onChange={(event) => patchLocalized(locale, { story: event.target.value })} disabled={!editable} /></label>
                                    <label className={styles.textarea}><span>Prompt / משימה</span><textarea value={value.prompt} onChange={(event) => patchLocalized(locale, { prompt: event.target.value })} disabled={!editable} /></label>
                                    <label className={styles.textarea}><span>רמז מיקום</span><textarea value={value.locationHint} onChange={(event) => patchLocalized(locale, { locationHint: event.target.value })} disabled={!editable} /></label>
                                    <label className={styles.textarea}><span>Success copy</span><textarea value={value.success} onChange={(event) => patchLocalized(locale, { success: event.target.value })} disabled={!editable} /></label>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className={styles.section}>
                            <div className={styles.sectionTitle}><h3>חוקי פתרון</h3></div>
                            {checkpointDraft.checkpoint.kind === "photo" ? (
                              <div className={styles.grid2}>
                                <label className={`${styles.textarea} ${styles.full}`}><span>קריטריונים לאימות התמונה</span><textarea value={checkpointDraft.photoCriteria} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, photoCriteria: event.target.value })} disabled={!editable} /></label>
                                <label className={styles.field}><span>סף ביטחון AI</span><input type="number" min="0" max="1" step="0.01" value={checkpointDraft.confidenceThreshold} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, confidenceThreshold: Number(event.target.value) })} disabled={!editable} /></label>
                              </div>
                            ) : checkpointDraft.checkpoint.kind === "choice" ? (
                              <div className={styles.grid2}>
                                <label className={styles.textarea}><span>אפשרויות — אחת בכל שורה</span><textarea value={checkpointDraft.choiceOptions} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, choiceOptions: event.target.value })} disabled={!editable} /></label>
                                <label className={styles.select}><span>תשובה נכונה</span><select value={checkpointDraft.acceptedOption} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, acceptedOption: event.target.value })} disabled={!editable}><option value="">בחר תשובה</option>{lines(checkpointDraft.choiceOptions).map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                              </div>
                            ) : checkpointDraft.checkpoint.kind === "scan" ? (
                              <div className={styles.notice}>התחנה מושלמת באמצעות QR או NFC שמפנה ל־/s/{checkpointDraft.checkpoint.slug}.</div>
                            ) : (
                              <div className={styles.grid2}>
                                <label className={styles.textarea}><span>תשובות מתקבלות — אחת בכל שורה</span><textarea value={checkpointDraft.acceptedAnswers} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, acceptedAnswers: event.target.value })} disabled={!editable} /></label>
                                <label className={styles.field}><span>Fuzzy threshold</span><input type="number" min="0" max="1" step="0.01" value={checkpointDraft.fuzzyThreshold} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, fuzzyThreshold: Number(event.target.value) })} disabled={!editable} /></label>
                              </div>
                            )}
                          </div>

                          <div className={styles.section}>
                            <div className={styles.sectionTitle}><h3>מיקום ונגישות</h3></div>
                            <div className={styles.grid3}>
                              <label className={styles.field}><span>Latitude</span><input type="number" step="any" value={checkpointDraft.checkpoint.latitude ?? ""} onChange={(event) => patchCheckpoint({ latitude: event.target.value === "" ? null : Number(event.target.value) })} disabled={!editable} /></label>
                              <label className={styles.field}><span>Longitude</span><input type="number" step="any" value={checkpointDraft.checkpoint.longitude ?? ""} onChange={(event) => patchCheckpoint({ longitude: event.target.value === "" ? null : Number(event.target.value) })} disabled={!editable} /></label>
                              <label className={styles.field}><span>רדיוס במטרים</span><input type="number" min="1" value={checkpointDraft.checkpoint.radius_meters ?? ""} onChange={(event) => patchCheckpoint({ radius_meters: event.target.value === "" ? null : Number(event.target.value) })} disabled={!editable} /></label>
                            </div>
                            <div className={styles.switches}>
                              <label className={styles.switch}><input type="checkbox" checked={checkpointDraft.wheelchair} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, wheelchair: event.target.checked })} disabled={!editable} />נגיש לכיסא גלגלים</label>
                              <label className={styles.switch}><input type="checkbox" checked={checkpointDraft.stroller} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, stroller: event.target.checked })} disabled={!editable} />נגיש לעגלה</label>
                            </div>
                          </div>

                          <div className={styles.section}>
                            <div className={styles.sectionTitle}>
                              <h3>רמזים</h3>
                              <button className={styles.iconButton} onClick={() => setCheckpointDraft({ ...checkpointDraft, hints: [...checkpointDraft.hints, { he: "", en: "", penalty: 10 }] })} disabled={!editable} aria-label="הוספת רמז">＋</button>
                            </div>
                            <div className={styles.hintList}>
                              {checkpointDraft.hints.length === 0 && <div className={styles.muted}>אין רמזים בתחנה.</div>}
                              {checkpointDraft.hints.map((hint, index) => (
                                <div className={styles.hintCard} key={index}>
                                  <label className={styles.field}><span>עברית</span><input value={hint.he} onChange={(event) => { const next = [...checkpointDraft.hints]; next[index] = { ...hint, he: event.target.value }; setCheckpointDraft({ ...checkpointDraft, hints: next }); }} disabled={!editable} /></label>
                                  <label className={styles.field}><span>English</span><input value={hint.en} onChange={(event) => { const next = [...checkpointDraft.hints]; next[index] = { ...hint, en: event.target.value }; setCheckpointDraft({ ...checkpointDraft, hints: next }); }} disabled={!editable} /></label>
                                  <label className={styles.field}><span>קנס</span><input type="number" value={hint.penalty} onChange={(event) => { const next = [...checkpointDraft.hints]; next[index] = { ...hint, penalty: Number(event.target.value) }; setCheckpointDraft({ ...checkpointDraft, hints: next }); }} disabled={!editable} /></label>
                                  <button className={`${styles.iconButton} ${styles.danger}`} onClick={() => setCheckpointDraft({ ...checkpointDraft, hints: checkpointDraft.hints.filter((_, itemIndex) => itemIndex !== index) })} disabled={!editable} aria-label="מחיקת רמז">×</button>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className={styles.section}>
                            <div className={styles.sectionTitle}><h3>ניקוד ואינטראקציה</h3></div>
                            <div className={styles.grid4}>
                              <label className={styles.field}><span>נקודות בסיס</span><input type="number" value={checkpointDraft.basePoints} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, basePoints: Number(event.target.value) })} disabled={!editable} /></label>
                              <label className={styles.field}><span>קנס טעות</span><input type="number" value={checkpointDraft.wrongPenalty} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, wrongPenalty: Number(event.target.value) })} disabled={!editable} /></label>
                              <label className={styles.field}><span>קנס רמז</span><input type="number" value={checkpointDraft.hintPenalty} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, hintPenalty: Number(event.target.value) })} disabled={!editable} /></label>
                              <label className={styles.field}><span>בונוס מהירות</span><input type="number" value={checkpointDraft.speedBonusMax} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, speedBonusMax: Number(event.target.value) })} disabled={!editable} /></label>
                              <label className={styles.field}><span>חלון מהירות בשניות</span><input type="number" value={checkpointDraft.speedBonusWindowSeconds} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, speedBonusWindowSeconds: Number(event.target.value) })} disabled={!editable} /></label>
                              <label className={styles.select}><span>ערוץ ראשי</span><select value={checkpointDraft.interactionPrimary} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, interactionPrimary: event.target.value })} disabled={!editable}><option value="web">Web</option><option value="whatsapp">WhatsApp</option><option value="photo">Photo</option><option value="scan">Scan</option><option value="location_then_text">Location + text</option></select></label>
                            </div>
                            <div className={styles.switches}>
                              <label className={styles.switch}><input type="checkbox" checked={checkpointDraft.webFallback} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, webFallback: event.target.checked })} disabled={!editable} />Web fallback</label>
                              <label className={styles.switch}><input type="checkbox" checked={checkpointDraft.requiresScan} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, requiresScan: event.target.checked })} disabled={!editable} />דורשת סריקה</label>
                              <label className={styles.switch}><input type="checkbox" checked={checkpointDraft.acceptWhatsAppMedia} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, acceptWhatsAppMedia: event.target.checked })} disabled={!editable} />קבלת מדיה ב־WhatsApp</label>
                            </div>
                          </div>

                          <div className={styles.section}>
                            <div className={styles.sectionTitle}><h3>שאלת גיבוי</h3></div>
                            <label className={styles.switch}><input type="checkbox" checked={checkpointDraft.fallbackEnabled} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, fallbackEnabled: event.target.checked })} disabled={!editable} />הפעלת תשובת גיבוי</label>
                            {checkpointDraft.fallbackEnabled && (
                              <div className={styles.grid2}>
                                <label className={styles.textarea}><span>עברית</span><textarea value={checkpointDraft.fallbackHe} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, fallbackHe: event.target.value })} disabled={!editable} /></label>
                                <label className={styles.textarea}><span>English</span><textarea value={checkpointDraft.fallbackEn} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, fallbackEn: event.target.value })} disabled={!editable} /></label>
                                <label className={`${styles.textarea} ${styles.full}`}><span>תשובות מתקבלות — אחת בכל שורה</span><textarea value={checkpointDraft.fallbackAccepted} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, fallbackAccepted: event.target.value })} disabled={!editable} /></label>
                              </div>
                            )}
                          </div>

                          <div className={styles.section}>
                            <div className={styles.sectionTitle}>
                              <div><h3>בדיקת שטח</h3><p className={styles.muted}>שינוי תוכן, מיקום או חוקים מאפס אוטומטית אימות קודם.</p></div>
                              <button className={`${styles.button} ${styles.secondary}`} onClick={saveHealth} disabled={busy === "save-health"}>{busy === "save-health" ? "שומר…" : "שמירת בדיקה"}</button>
                            </div>
                            <div className={styles.grid2}>
                              <label className={styles.select}><span>מצב התחנה</span><select value={checkpointDraft.healthStatus} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, healthStatus: event.target.value })}><option value="not_required">לא נדרש</option><option value="pending">ממתינה לבדיקה</option><option value="verified">מאומתת</option><option value="needs_attention">דורשת טיפול</option><option value="blocked">חסומה</option></select></label>
                              <label className={styles.textarea}><span>הערות שטח</span><textarea value={checkpointDraft.healthNotes} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, healthNotes: event.target.value })} /></label>
                            </div>
                            <div className={styles.healthGrid}>
                              {checklistFields.map(([key, label]) => (
                                <label className={styles.check} key={key}><input type="checkbox" checked={checkpointDraft.checklist[key] === true} onChange={(event) => setCheckpointDraft({ ...checkpointDraft, checklist: { ...checkpointDraft.checklist, [key]: event.target.checked } })} />{label}</label>
                              ))}
                            </div>
                          </div>
                        </article>
                      ) : (
                        <div className={styles.notice}>הוסף תחנה חדשה כדי להתחיל לבנות את המסלול.</div>
                      )}
                    </div>
                  </section>

                  <section className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div>
                        <span className={styles.kicker}>Publish gate</span>
                        <h2>{detail.report.ok ? "הגרסה מוכנה לפרסום" : "יש להשלים את הגרסה"}</h2>
                      </div>
                      <span className={detail.report.ok ? styles.success : styles.notice}>{detail.report.ok ? "PASS" : "BLOCKED"}</span>
                    </div>
                    <div className={styles.publishReport}>
                      {detail.report.errors.map((issue) => <div className={styles.error} key={`${issue.code}-${issue.checkpointId ?? "route"}`}><strong>{issue.checkpointSlug ?? "Route"}</strong> · {issue.message}</div>)}
                      {detail.report.warnings.map((issue) => <div className={styles.issue} key={`${issue.code}-${issue.checkpointId ?? "route"}`}><strong>{issue.checkpointSlug ?? "Route"}</strong> · {issue.message}</div>)}
                      {!detail.report.errors.length && !detail.report.warnings.length && <div className={styles.success}>כל שערי התוכן והשטח עברו.</div>}
                    </div>
                  </section>

                  <section className={styles.card}>
                    <span className={styles.kicker}>Audit trail</span>
                    <h2>היסטוריית פעולות</h2>
                    <div className={styles.audit}>
                      {detail.audit.length === 0 && <p className={styles.muted}>עדיין אין פעולות בגרסה.</p>}
                      {detail.audit.map((entry) => (
                        <div className={styles.auditItem} key={entry.id}>
                          <time>{new Date(entry.created_at).toLocaleString("he-IL")}</time>
                          <div><strong>{entry.action}</strong><div className={styles.muted}>{entry.actor_email ?? "system"}</div></div>
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

      {newRouteOpen && (
        <div className={styles.dialogBackdrop} onClick={() => setNewRouteOpen(false)}>
          <section className={styles.dialog} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2>יצירת מסלול חדש</h2>
            <p className={styles.muted}>המסלול נוצר עם גרסת טיוטה ראשונה וללא תחנות.</p>
            <div className={styles.grid2}>
              <label className={styles.field}><span>Slug באנגלית</span><input value={newRoute.slug} onChange={(event) => setNewRoute({ ...newRoute, slug: event.target.value })} placeholder="jaffa-night-mystery" /></label>
              <label className={styles.field}><span>שם בעברית</span><input value={newRoute.titleHe} onChange={(event) => setNewRoute({ ...newRoute, titleHe: event.target.value })} /></label>
              <label className={styles.field}><span>English title</span><input value={newRoute.titleEn} onChange={(event) => setNewRoute({ ...newRoute, titleEn: event.target.value })} /></label>
              <label className={styles.textarea}><span>תיאור בעברית</span><textarea value={newRoute.descriptionHe} onChange={(event) => setNewRoute({ ...newRoute, descriptionHe: event.target.value })} /></label>
              <label className={styles.textarea}><span>English description</span><textarea value={newRoute.descriptionEn} onChange={(event) => setNewRoute({ ...newRoute, descriptionEn: event.target.value })} /></label>
            </div>
            <div className={styles.dialogActions}>
              <button className={`${styles.button} ${styles.secondary}`} onClick={() => setNewRouteOpen(false)}>ביטול</button>
              <button className={`${styles.button} ${styles.primary}`} onClick={createRoute} disabled={!newRoute.slug.trim() || (!newRoute.titleHe.trim() && !newRoute.titleEn.trim()) || busy === "create-route"}>{busy === "create-route" ? "יוצר…" : "יצירת המסלול"}</button>
            </div>
          </section>
        </div>
      )}

      {newCheckpointOpen && detail && (
        <div className={styles.dialogBackdrop} onClick={() => setNewCheckpointOpen(false)}>
          <section className={styles.dialog} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2>הוספת תחנה</h2>
            <p className={styles.muted}>התחנה תתווסף אחרי התחנה הנבחרת. לאחר מכן ניתן לגרור אותה לכל מקום.</p>
            <div className={styles.grid2}>
              <label className={styles.field}><span>Slug באנגלית</span><input value={newCheckpoint.slug} onChange={(event) => setNewCheckpoint({ ...newCheckpoint, slug: event.target.value })} placeholder="clock-tower-clue" /></label>
              <label className={styles.select}><span>סוג תחנה</span><select value={newCheckpoint.kind} onChange={(event) => setNewCheckpoint({ ...newCheckpoint, kind: event.target.value })}>{checkpointKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </div>
            <div className={styles.dialogActions}>
              <button className={`${styles.button} ${styles.secondary}`} onClick={() => setNewCheckpointOpen(false)}>ביטול</button>
              <button className={`${styles.button} ${styles.primary}`} onClick={createCheckpoint} disabled={!newCheckpoint.slug.trim() || busy === "create-checkpoint"}>{busy === "create-checkpoint" ? "מוסיף…" : "הוספת התחנה"}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
