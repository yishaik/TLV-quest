"use client";

import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { contentImportCsvTemplate } from "@/lib/content-import";
import { getBrowserClient } from "@/lib/supabase/browser";
import { RouteSafetyMap } from "@/components/RouteSafetyMap";
import styles from "./ContentStudioV2.module.css";

type Tab = "routes" | "stations" | "riddles";
type Localized = { he?: string; en?: string };
type VersionSummary = {
  version: number;
  status: string;
  release_name: string | null;
  release_notes: string | null;
  checkpointCount: number;
  runCount: number;
  activeRunCount: number;
  isActiveVersion: boolean;
  canDelete: boolean;
  deleteBlockReason: string | null;
};
type RouteTemplate = {
  id: string;
  slug: string;
  brand_key: string;
  title: Localized;
  description: Localized;
  active_version: number;
  is_active: boolean;
  runCount: number;
  activeRunCount: number;
  canDelete: boolean;
  deleteBlockReason: string | null;
  versions: VersionSummary[];
};
type Station = {
  id: string;
  slug: string;
  brand_key: string;
  title: Localized;
  description: Localized;
  address: Localized;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  hero_image_path: string | null;
  hero_image_url: string | null;
  gallery: unknown[];
  tags: string[];
  accessibility: Record<string, unknown>;
  field_verification_required: boolean;
  health_status: string;
  health_checklist: Record<string, unknown>;
  health_notes: string | null;
  last_checked_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};
type Riddle = {
  id: string;
  station_id: string;
  slug: string;
  title: Localized;
  kind: string;
  content: Record<string, unknown>;
  validation: Record<string, unknown>;
  hints: unknown[];
  scoring: Record<string, unknown>;
  fallback: Record<string, unknown> | null;
  interaction: Record<string, unknown>;
  hero_image_path: string | null;
  hero_image_url: string | null;
  tags: string[];
  status: string;
  created_at: string;
  updated_at: string;
};
type RouteStop = {
  id: string;
  template_id: string;
  version: number;
  station_id: string;
  riddle_id: string;
  slug: string;
  sequence_no: number;
  is_optional: boolean;
  is_active: boolean;
  overrides: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
type LibraryPayload = {
  stations: Station[];
  riddles: Riddle[];
  routeStops: RouteStop[];
};
type VersionDetail = {
  template: RouteTemplate;
  version: {
    version: number;
    status: string;
    release_name: string | null;
    release_notes: string | null;
    theme: Record<string, unknown>;
    route_config: Record<string, unknown>;
  };
  report: {
    ok: boolean;
    errors: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
    checkpointCount: number;
    unverifiedCount: number;
  };
};
type ContentImportResult = {
  ok: boolean;
  dryRun: boolean;
  duplicate?: boolean;
  batchId?: string;
  status?: string;
  rowCount: number;
  stationsCreated?: number;
  riddlesCreated?: number;
  stopsCreated?: number;
  errors: Array<{
    row: number | null;
    field: string;
    code: string;
    message: string;
  }>;
};
type ContentImportBatch = {
  id: string;
  format: "csv" | "json";
  status: "applied" | "rolled_back";
  row_count: number;
  summary: Record<string, unknown>;
  actor: string;
  created_at: string;
  rolled_back_at: string | null;
  rolled_back_by: string | null;
};
type RouteGenerationDraft = {
  id: string;
  proposed_route: {
    publicationState: "draft";
    stops: Array<{
      sequence: number;
      stationId: string;
      stationSlug: string;
      stationTitle: Localized;
      riddleId: string;
      riddleSlug: string;
      kind: string;
      healthStatus: string;
      requiresFieldVerification: boolean;
    }>;
    analysis: {
      totalDistanceMeters: number;
      walkingMinutes: number;
      estimatedExperienceMinutes: number;
      flags: string[];
    };
    rationale: string;
    requiresHumanReview: true;
  };
  provenance: {
    provider: string;
    model: string | null;
    algorithm: string;
    candidateCount: number;
  };
  confidence: number;
  verification_requirements: string[];
  status: "draft";
  created_at: string;
};
type StationDraft = {
  id: string;
  slug: string;
  titleHe: string;
  titleEn: string;
  descriptionHe: string;
  descriptionEn: string;
  addressHe: string;
  addressEn: string;
  latitude: string;
  longitude: string;
  radiusMeters: string;
  tags: string;
  wheelchair: boolean;
  stroller: boolean;
  fieldRequired: boolean;
  healthStatus: string;
  healthNotes: string;
  status: string;
  imageUrl: string;
};
type HintDraft = { he: string; en: string; penalty: number };
type RiddleDraft = {
  id: string;
  stationId: string;
  slug: string;
  titleHe: string;
  titleEn: string;
  kind: string;
  storyHe: string;
  storyEn: string;
  promptHe: string;
  promptEn: string;
  locationHintHe: string;
  locationHintEn: string;
  successHe: string;
  successEn: string;
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
  fallbackHe: string;
  fallbackEn: string;
  fallbackAccepted: string;
  tags: string;
  status: string;
};

const riddleKinds = [
  ["text", "תשובת טקסט"],
  ["choice", "בחירה מתוך אפשרויות"],
  ["location", "מיקום + תשובה"],
  ["photo", "משימת צילום"],
  ["scan", "סריקת QR / NFC"],
  ["hybrid", "משימה משולבת"],
  ["finale", "תחנת סיום"]
] as const;

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const textValue = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const numberValue = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const booleanValue = (value: unknown, fallback = false) =>
  typeof value === "boolean" ? value : fallback;
const lines = (value: string) =>
  value.split("\n").map((item) => item.trim()).filter(Boolean);
const titleOf = (value: Localized | undefined, fallback: string) =>
  textValue(value?.he) || textValue(value?.en) || fallback;
const kindLabel = (kind: string) =>
  riddleKinds.find(([value]) => value === kind)?.[1] ?? kind;

async function requestJson<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body && !(init.body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...(init?.headers ?? {})
    }
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message ?? "הפעולה נכשלה");
  }
  return payload.data as T;
}

const emptyStation = (): StationDraft => ({
  id: "",
  slug: "",
  titleHe: "",
  titleEn: "",
  descriptionHe: "",
  descriptionEn: "",
  addressHe: "",
  addressEn: "",
  latitude: "",
  longitude: "",
  radiusMeters: "100",
  tags: "",
  wheelchair: true,
  stroller: true,
  fieldRequired: false,
  healthStatus: "not_required",
  healthNotes: "",
  status: "draft",
  imageUrl: ""
});

const stationToDraft = (station: Station): StationDraft => ({
  id: station.id,
  slug: station.slug,
  titleHe: textValue(station.title.he),
  titleEn: textValue(station.title.en),
  descriptionHe: textValue(station.description.he),
  descriptionEn: textValue(station.description.en),
  addressHe: textValue(station.address.he),
  addressEn: textValue(station.address.en),
  latitude: station.latitude === null ? "" : String(station.latitude),
  longitude: station.longitude === null ? "" : String(station.longitude),
  radiusMeters: station.radius_meters === null ? "" : String(station.radius_meters),
  tags: station.tags.join(", "),
  wheelchair: booleanValue(station.accessibility.wheelchair, true),
  stroller: booleanValue(station.accessibility.stroller, true),
  fieldRequired: station.field_verification_required,
  healthStatus: station.health_status,
  healthNotes: station.health_notes ?? "",
  status: station.status,
  imageUrl: station.hero_image_url ?? ""
});

const emptyRiddle = (stationId = ""): RiddleDraft => ({
  id: "",
  stationId,
  slug: "",
  titleHe: "",
  titleEn: "",
  kind: "text",
  storyHe: "",
  storyEn: "",
  promptHe: "",
  promptEn: "",
  locationHintHe: "",
  locationHintEn: "",
  successHe: "",
  successEn: "",
  acceptedAnswers: "",
  fuzzyThreshold: 0.94,
  choiceOptions: "",
  acceptedOption: "",
  photoCriteria: "",
  confidenceThreshold: 0.86,
  hints: [],
  basePoints: 100,
  wrongPenalty: 5,
  hintPenalty: 10,
  speedBonusMax: 20,
  speedBonusWindowSeconds: 420,
  fallbackHe: "",
  fallbackEn: "",
  fallbackAccepted: "",
  tags: "",
  status: "draft"
});

const riddleToDraft = (riddle: Riddle): RiddleDraft => {
  const he = objectValue(riddle.content.he);
  const en = objectValue(riddle.content.en);
  const validation = objectValue(riddle.validation);
  const scoring = objectValue(riddle.scoring);
  const fallback = objectValue(riddle.fallback);
  return {
    id: riddle.id,
    stationId: riddle.station_id,
    slug: riddle.slug,
    titleHe: textValue(riddle.title.he),
    titleEn: textValue(riddle.title.en),
    kind: riddle.kind,
    storyHe: textValue(he.story),
    storyEn: textValue(en.story),
    promptHe: textValue(he.prompt),
    promptEn: textValue(en.prompt),
    locationHintHe: textValue(he.locationHint),
    locationHintEn: textValue(en.locationHint),
    successHe: textValue(he.success),
    successEn: textValue(en.success),
    acceptedAnswers: Array.isArray(validation.accepted)
      ? validation.accepted.filter((item): item is string => typeof item === "string").join("\n")
      : "",
    fuzzyThreshold: numberValue(validation.fuzzyThreshold, 0.94),
    choiceOptions: Array.isArray(validation.options)
      ? validation.options.filter((item): item is string => typeof item === "string").join("\n")
      : "",
    acceptedOption: textValue(validation.acceptedOption),
    photoCriteria: textValue(validation.criteria),
    confidenceThreshold: numberValue(validation.confidenceThreshold, 0.86),
    hints: Array.isArray(riddle.hints)
      ? riddle.hints.map((raw) => {
          const hint = objectValue(raw);
          return {
            he: textValue(hint.he),
            en: textValue(hint.en),
            penalty: numberValue(hint.penalty, 10)
          };
        })
      : [],
    basePoints: numberValue(scoring.basePoints, 100),
    wrongPenalty: numberValue(scoring.wrongPenalty, 5),
    hintPenalty: numberValue(scoring.hintPenalty, 10),
    speedBonusMax: numberValue(scoring.speedBonusMax, 20),
    speedBonusWindowSeconds: numberValue(scoring.speedBonusWindowSeconds, 420),
    fallbackHe: textValue(fallback.he),
    fallbackEn: textValue(fallback.en),
    fallbackAccepted: Array.isArray(fallback.accepted)
      ? fallback.accepted.filter((item): item is string => typeof item === "string").join("\n")
      : "",
    tags: riddle.tags.join(", "),
    status: riddle.status
  };
};

export function ContentStudioV2() {
  const [token, setToken] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [tab, setTab] = useState<Tab>("routes");
  const [catalog, setCatalog] = useState<RouteTemplate[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [riddles, setRiddles] = useState<Riddle[]>([]);
  const [routeStops, setRouteStops] = useState<RouteStop[]>([]);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [selectedStationId, setSelectedStationId] = useState("");
  const [selectedRiddleId, setSelectedRiddleId] = useState("");
  const [stationDraft, setStationDraft] = useState<StationDraft>(emptyStation);
  const [riddleDraft, setRiddleDraft] = useState<RiddleDraft>(emptyRiddle);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [newRoute, setNewRoute] = useState({
    slug: "",
    titleHe: "",
    titleEn: "",
    descriptionHe: "",
    descriptionEn: ""
  });
  const [routeSettingsOpen, setRouteSettingsOpen] = useState(false);
  const [routeTitleHe, setRouteTitleHe] = useState("");
  const [routeTitleEn, setRouteTitleEn] = useState("");
  const [routeDescriptionHe, setRouteDescriptionHe] = useState("");
  const [routeDescriptionEn, setRouteDescriptionEn] = useState("");
  const [routeSlug, setRouteSlug] = useState("");
  const [releaseName, setReleaseName] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [routeStatus, setRouteStatus] = useState<"draft" | "review">("draft");
  const [themeJson, setThemeJson] = useState("{}");
  const [routeConfigJson, setRouteConfigJson] = useState("{}");
  const [stationPicker, setStationPicker] = useState("");
  const [riddlePicker, setRiddlePicker] = useState<Record<string, string>>({});
  const [draggedStopId, setDraggedStopId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLocale, setPreviewLocale] = useState<"he" | "en">("he");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importFormat, setImportFormat] = useState<"csv" | "json">("csv");
  const [importContent, setImportContent] = useState("");
  const [importKey, setImportKey] = useState("");
  const [importResult, setImportResult] =
    useState<ContentImportResult | null>(null);
  const [importBatches, setImportBatches] = useState<ContentImportBatch[]>([]);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [generatorPolygon, setGeneratorPolygon] = useState("[]");
  const [generatorAudience, setGeneratorAudience] = useState("families");
  const [generatorDuration, setGeneratorDuration] = useState(90);
  const [generatorLocale, setGeneratorLocale] = useState<"he" | "en">("he");
  const [generatorWheelchair, setGeneratorWheelchair] = useState(false);
  const [generatedRoute, setGeneratedRoute] =
    useState<RouteGenerationDraft | null>(null);

  const selectedRoute = useMemo(
    () => catalog.find((route) => route.id === selectedTemplateId) ?? null,
    [catalog, selectedTemplateId]
  );
  const selectedVersionSummary = useMemo(
    () => selectedRoute?.versions.find((version) => version.version === selectedVersion) ?? null,
    [selectedRoute, selectedVersion]
  );
  const editable = Boolean(detail && ["draft", "review"].includes(detail.version.status));
  const activeStops = useMemo(
    () => routeStops
      .filter((stop) => stop.template_id === selectedTemplateId && stop.version === selectedVersion)
      .sort((left, right) => left.sequence_no - right.sequence_no),
    [routeStops, selectedTemplateId, selectedVersion]
  );
  const previewStops = useMemo(
    () =>
      activeStops
        .filter((stop) => stop.is_active)
        .map((stop) => ({
          stop,
          station: stations.find((station) => station.id === stop.station_id),
          riddle: riddles.find((riddle) => riddle.id === stop.riddle_id)
        }))
        .filter(
          (
            item
          ): item is {
            stop: RouteStop;
            station: Station;
            riddle: Riddle;
          } => Boolean(item.station && item.riddle)
        ),
    [activeStops, riddles, stations]
  );
  const riddlesByStation = useMemo(() => {
    const map = new Map<string, Riddle[]>();
    riddles.forEach((riddle) => {
      const current = map.get(riddle.station_id) ?? [];
      current.push(riddle);
      map.set(riddle.station_id, current);
    });
    return map;
  }, [riddles]);
  const usageByStation = useMemo(() => {
    const map = new Map<string, number>();
    routeStops.forEach((stop) => map.set(stop.station_id, (map.get(stop.station_id) ?? 0) + 1));
    return map;
  }, [routeStops]);
  const usageByRiddle = useMemo(() => {
    const map = new Map<string, number>();
    routeStops.forEach((stop) => map.set(stop.riddle_id, (map.get(stop.riddle_id) ?? 0) + 1));
    return map;
  }, [routeStops]);

  const loadDetail = useCallback(async (
    templateId: string,
    version: number,
    accessToken = token
  ) => {
    if (!accessToken) return;
    const next = await requestJson<VersionDetail>(
      `/api/admin/content/templates/${encodeURIComponent(templateId)}/versions/${version}`,
      accessToken
    );
    setDetail(next);
    setSelectedTemplateId(templateId);
    setSelectedVersion(version);
    setRouteTitleHe(textValue(next.template.title.he));
    setRouteTitleEn(textValue(next.template.title.en));
    setRouteDescriptionHe(textValue(next.template.description.he));
    setRouteDescriptionEn(textValue(next.template.description.en));
    setRouteSlug(next.template.slug);
    setReleaseName(next.version.release_name ?? "");
    setReleaseNotes(next.version.release_notes ?? "");
    setRouteStatus(next.version.status === "review" ? "review" : "draft");
    setThemeJson(JSON.stringify(next.version.theme ?? {}, null, 2));
    setRouteConfigJson(JSON.stringify(next.version.route_config ?? {}, null, 2));
  }, [token]);

  const loadAll = useCallback(async (
    accessToken = token,
    preferredTemplateId?: string,
    preferredVersion?: number
  ) => {
    if (!accessToken) return;
    const [nextCatalog, library] = await Promise.all([
      requestJson<RouteTemplate[]>("/api/admin/content/templates", accessToken),
      requestJson<LibraryPayload>("/api/admin/content/library", accessToken)
    ]);
    setCatalog(nextCatalog);
    setStations(library.stations);
    setRiddles(library.riddles);
    setRouteStops(library.routeStops);

    const route = nextCatalog.find((item) => item.id === preferredTemplateId)
      ?? nextCatalog.find((item) => item.id === selectedTemplateId)
      ?? nextCatalog[0];
    const version = route?.versions.find((item) => item.version === preferredVersion)
      ?? route?.versions.find((item) => item.version === selectedVersion)
      ?? route?.versions.find((item) => item.isActiveVersion)
      ?? route?.versions[0];
    if (route && version) await loadDetail(route.id, version.version, accessToken);
    else setDetail(null);
  }, [loadDetail, selectedTemplateId, selectedVersion, token]);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => undefined;
    void Promise.resolve().then(async () => {
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
    }).catch((cause) => {
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
    void loadAll(token).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unexpected error");
    });
    return () => { active = false; };
  }, [loadAll, token]);

  async function operation(name: string, action: () => Promise<void>) {
    setBusy(name);
    setMessage("");
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy("");
    }
  }

  function openStation(station?: Station) {
    setStationDraft(station ? stationToDraft(station) : emptyStation());
    setSelectedStationId(station?.id ?? "");
    setEditorOpen(true);
  }

  function openRiddle(riddle?: Riddle, stationId?: string) {
    const next = riddle ? riddleToDraft(riddle) : emptyRiddle(stationId || selectedStationId || stations[0]?.id || "");
    setRiddleDraft(next);
    setSelectedRiddleId(riddle?.id ?? "");
    setEditorOpen(true);
  }

  async function saveStation(event: FormEvent) {
    event.preventDefault();
    await operation("save-station", async () => {
      const body = {
        slug: stationDraft.slug,
        title: { he: stationDraft.titleHe, en: stationDraft.titleEn },
        description: { he: stationDraft.descriptionHe, en: stationDraft.descriptionEn },
        address: { he: stationDraft.addressHe, en: stationDraft.addressEn },
        latitude: stationDraft.latitude || null,
        longitude: stationDraft.longitude || null,
        radiusMeters: stationDraft.radiusMeters || null,
        tags: stationDraft.tags.split(",").map((item) => item.trim()).filter(Boolean),
        accessibility: { wheelchair: stationDraft.wheelchair, stroller: stationDraft.stroller },
        fieldVerificationRequired: stationDraft.fieldRequired,
        healthStatus: stationDraft.healthStatus,
        healthNotes: stationDraft.healthNotes,
        status: stationDraft.status
      };
      const saved = stationDraft.id
        ? await requestJson<Station>(`/api/admin/content/stations/${stationDraft.id}`, token, {
            method: "PATCH",
            body: JSON.stringify(body)
          })
        : await requestJson<Station>("/api/admin/content/stations", token, {
            method: "POST",
            body: JSON.stringify(body)
          });
      await loadAll(token, selectedTemplateId, selectedVersion ?? undefined);
      setStationDraft(stationToDraft(saved));
      setSelectedStationId(saved.id);
      setMessage(stationDraft.id ? "התחנה נשמרה והטיוטות שמשתמשות בה עודכנו." : "התחנה נוספה לספרייה.");
    });
  }

  async function uploadStationImage(file: File) {
    if (!stationDraft.id) {
      setError("יש לשמור את התחנה לפני העלאת תמונה.");
      return;
    }
    await operation("station-image", async () => {
      const form = new FormData();
      form.set("image", file);
      const saved = await requestJson<Station>(
        `/api/admin/content/stations/${stationDraft.id}/image`,
        token,
        { method: "POST", body: form }
      );
      setStationDraft(stationToDraft(saved));
      await loadAll(token, selectedTemplateId, selectedVersion ?? undefined);
      setMessage("תמונת התחנה הועלתה ומופיעה גם בחוויית השחקן.");
    });
  }

  async function removeStationImage() {
    if (!stationDraft.id) return;
    await operation("station-image", async () => {
      const saved = await requestJson<Station>(
        `/api/admin/content/stations/${stationDraft.id}/image`,
        token,
        { method: "DELETE" }
      );
      setStationDraft(stationToDraft(saved));
      await loadAll(token, selectedTemplateId, selectedVersion ?? undefined);
      setMessage("תמונת התחנה הוסרה.");
    });
  }

  async function deleteStation() {
    if (!stationDraft.id || !window.confirm("למחוק את התחנה לצמיתות?")) return;
    await operation("delete-station", async () => {
      await requestJson(`/api/admin/content/stations/${stationDraft.id}`, token, { method: "DELETE" });
      setEditorOpen(false);
      setSelectedStationId("");
      await loadAll(token, selectedTemplateId, selectedVersion ?? undefined);
      setMessage("התחנה נמחקה.");
    });
  }

  function buildRiddleValidation(draft: RiddleDraft) {
    if (draft.kind === "choice") {
      return { type: "choice", options: lines(draft.choiceOptions), acceptedOption: draft.acceptedOption.trim() };
    }
    if (draft.kind === "photo") {
      return { type: "photo", criteria: draft.photoCriteria.trim(), confidenceThreshold: draft.confidenceThreshold };
    }
    if (draft.kind === "scan") return { type: "scan" };
    return { type: "text", accepted: lines(draft.acceptedAnswers), fuzzyThreshold: draft.fuzzyThreshold };
  }

  async function translateRiddleCopy(
    sourceLocale: "he" | "en",
    targetLocale: "he" | "en"
  ) {
    const mappings: Array<[keyof RiddleDraft, keyof RiddleDraft, string]> =
      sourceLocale === "he"
        ? [
            ["titleHe", "titleEn", "riddle title"],
            ["storyHe", "storyEn", "story"],
            ["promptHe", "promptEn", "player task"],
            ["locationHintHe", "locationHintEn", "location hint"],
            ["successHe", "successEn", "success message"]
          ]
        : [
            ["titleEn", "titleHe", "riddle title"],
            ["storyEn", "storyHe", "story"],
            ["promptEn", "promptHe", "player task"],
            ["locationHintEn", "locationHintHe", "location hint"],
            ["successEn", "successHe", "success message"]
          ];
    const populatedTargets = mappings.some(
      ([, target]) => String(riddleDraft[target] ?? "").trim().length > 0
    );
    if (
      populatedTargets &&
      !window.confirm(
        "התרגום המוצע יחליף את שדות שפת היעד בטיוטה. להמשיך?"
      )
    ) {
      return;
    }
    await operation("translate-riddle", async () => {
      const translated = await Promise.all(
        mappings.map(async ([source, target, field]) => {
          const sourceText = String(riddleDraft[source] ?? "").trim();
          if (!sourceText) return [target, ""] as const;
          const result = await requestJson<{
            suggestion: string;
            reviewRequired: boolean;
          }>("/api/admin/content/translate", token, {
            method: "POST",
            body: JSON.stringify({
              sourceText,
              sourceLocale,
              targetLocale,
              context: `${field}; urban quest; preserve clues without revealing answers`
            })
          });
          return [target, result.suggestion] as const;
        })
      );
      setRiddleDraft((current) => {
        const next = { ...current };
        for (const [target, suggestion] of translated) {
          (next[target] as string | number | HintDraft[]) = suggestion;
        }
        return next;
      });
      setMessage(
        "הצעות התרגום נוספו לטיוטה בלבד. יש לעבור עליהן ולאשר בשמירה."
      );
    });
  }

  async function saveRiddle(event: FormEvent) {
    event.preventDefault();
    await operation("save-riddle", async () => {
      const body = {
        stationId: riddleDraft.stationId,
        slug: riddleDraft.slug,
        title: { he: riddleDraft.titleHe, en: riddleDraft.titleEn },
        kind: riddleDraft.kind,
        content: {
          he: {
            title: riddleDraft.titleHe,
            story: riddleDraft.storyHe,
            prompt: riddleDraft.promptHe,
            locationHint: riddleDraft.locationHintHe,
            success: riddleDraft.successHe
          },
          en: {
            title: riddleDraft.titleEn,
            story: riddleDraft.storyEn,
            prompt: riddleDraft.promptEn,
            locationHint: riddleDraft.locationHintEn,
            success: riddleDraft.successEn
          }
        },
        validation: buildRiddleValidation(riddleDraft),
        hints: riddleDraft.hints
          .map((hint) => ({ he: hint.he.trim(), en: hint.en.trim(), penalty: hint.penalty }))
          .filter((hint) => hint.he || hint.en),
        scoring: {
          basePoints: riddleDraft.basePoints,
          wrongPenalty: riddleDraft.wrongPenalty,
          hintPenalty: riddleDraft.hintPenalty,
          speedBonusMax: riddleDraft.speedBonusMax,
          speedBonusWindowSeconds: riddleDraft.speedBonusWindowSeconds
        },
        fallback: riddleDraft.fallbackHe || riddleDraft.fallbackEn || riddleDraft.fallbackAccepted
          ? {
              type: "text",
              he: riddleDraft.fallbackHe,
              en: riddleDraft.fallbackEn,
              accepted: lines(riddleDraft.fallbackAccepted)
            }
          : null,
        interaction: {
          primary: riddleDraft.kind === "photo" ? "photo" : "web",
          webFallback: true,
          requiresScan: riddleDraft.kind === "scan" || riddleDraft.kind === "hybrid"
        },
        tags: riddleDraft.tags.split(",").map((item) => item.trim()).filter(Boolean),
        status: riddleDraft.status
      };
      const saved = riddleDraft.id
        ? await requestJson<Riddle>(`/api/admin/content/riddles/${riddleDraft.id}`, token, {
            method: "PATCH",
            body: JSON.stringify(body)
          })
        : await requestJson<Riddle>("/api/admin/content/riddles", token, {
            method: "POST",
            body: JSON.stringify(body)
          });
      await loadAll(token, selectedTemplateId, selectedVersion ?? undefined);
      setRiddleDraft(riddleToDraft(saved));
      setSelectedRiddleId(saved.id);
      setMessage(riddleDraft.id ? "החידה נשמרה והטיוטות שמשתמשות בה עודכנו." : "החידה נוספה לתחנה.");
    });
  }

  async function duplicateRiddle() {
    if (!riddleDraft.id) return;
    await operation("duplicate-riddle", async () => {
      const copy = {
        ...riddleDraft,
        id: "",
        slug: `${riddleDraft.slug}-copy`,
        titleHe: `${riddleDraft.titleHe} — עותק`,
        titleEn: `${riddleDraft.titleEn} — Copy`
      };
      setRiddleDraft(copy);
      setSelectedRiddleId("");
      setMessage("נוצר עותק מקומי. ערוך ושמור כחידה חדשה.");
    });
  }

  async function deleteRiddle() {
    if (!riddleDraft.id || !window.confirm("למחוק את החידה לצמיתות?")) return;
    await operation("delete-riddle", async () => {
      await requestJson(`/api/admin/content/riddles/${riddleDraft.id}`, token, { method: "DELETE" });
      setEditorOpen(false);
      setSelectedRiddleId("");
      await loadAll(token, selectedTemplateId, selectedVersion ?? undefined);
      setMessage("החידה נמחקה.");
    });
  }

  async function createRoute() {
    await operation("create-route", async () => {
      const result = await requestJson<{ templateId: string; version: number }>(
        "/api/admin/content/templates",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            slug: newRoute.slug,
            title: { he: newRoute.titleHe, en: newRoute.titleEn },
            description: { he: newRoute.descriptionHe, en: newRoute.descriptionEn },
            brandKey: "tlv-quest"
          })
        }
      );
      setRouteModalOpen(false);
      setNewRoute({ slug: "", titleHe: "", titleEn: "", descriptionHe: "", descriptionEn: "" });
      await loadAll(token, result.templateId, result.version);
      setMessage("המסלול נוצר. עכשיו בוחרים תחנות וחידות מהספרייה.");
    });
  }

  async function saveRouteSettings() {
    if (!selectedRoute || !detail) return;
    await operation("route-settings", async () => {
      await requestJson(`/api/admin/content/templates/${selectedRoute.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          slug: routeSlug,
          brandKey: selectedRoute.brand_key,
          title: { he: routeTitleHe, en: routeTitleEn },
          description: { he: routeDescriptionHe, en: routeDescriptionEn }
        })
      });
      const theme = JSON.parse(themeJson) as unknown;
      const routeConfig = JSON.parse(routeConfigJson) as unknown;
      await requestJson(
        `/api/admin/content/templates/${selectedRoute.id}/versions/${detail.version.version}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({
            metadata: {
              releaseName,
              releaseNotes,
              status: routeStatus,
              theme,
              routeConfig
            }
          })
        }
      );
      await loadAll(token, selectedRoute.id, detail.version.version);
      setRouteSettingsOpen(false);
      setMessage("פרטי המסלול והגרסה נשמרו.");
    });
  }

  async function cloneVersion() {
    if (!selectedRoute || !selectedVersion) return;
    await operation("clone-version", async () => {
      const result = await requestJson<{ version: number }>(
        `/api/admin/content/templates/${selectedRoute.id}/draft`,
        token,
        { method: "POST", body: JSON.stringify({ sourceVersion: selectedVersion }) }
      );
      await loadAll(token, selectedRoute.id, result.version);
      setMessage(`נוצרה טיוטה v${result.version}. התחנות והחידות נשארו מחוברות לספרייה.`);
    });
  }

  async function deleteVersion() {
    if (!selectedRoute || !selectedVersion || !window.confirm(`למחוק את גרסה v${selectedVersion}?`)) return;
    await operation("delete-version", async () => {
      await requestJson(
        `/api/admin/content/templates/${selectedRoute.id}/versions/${selectedVersion}`,
        token,
        { method: "DELETE" }
      );
      await loadAll(token, selectedRoute.id);
      setMessage("הגרסה נמחקה.");
    });
  }

  async function publishVersion() {
    if (!selectedRoute || !selectedVersion || !window.confirm(`לפרסם את v${selectedVersion}?`)) return;
    await operation("publish", async () => {
      const report = await requestJson<VersionDetail["report"]>(
        `/api/admin/content/templates/${selectedRoute.id}/versions/${selectedVersion}/publish`,
        token,
        { method: "POST", body: JSON.stringify({ allowUnverified: false }) }
      );
      if (!report.ok) throw new Error("הפרסום נחסם. פתח את רשימת הבעיות במסלול.");
      await loadAll(token, selectedRoute.id, selectedVersion);
      setMessage("הגרסה פורסמה והיא זמינה להרצות חדשות.");
    });
  }

  async function loadImportBatches() {
    if (!selectedRoute || !selectedVersion) return;
    const batches = await requestJson<ContentImportBatch[]>(
      `/api/admin/content/templates/${selectedRoute.id}/versions/${selectedVersion}/imports`,
      token
    );
    setImportBatches(batches);
  }

  async function openImportWorkspace() {
    setImportOpen(true);
    setImportResult(null);
    await operation("load-imports", loadImportBatches);
  }

  async function selectImportFile(file: File) {
    const extension = file.name.toLowerCase().split(".").at(-1);
    const format = extension === "json" ? "json" : "csv";
    const content = await file.text();
    setImportFormat(format);
    setImportContent(content);
    setImportKey(`content-import:${crypto.randomUUID()}`);
    setImportResult(null);
  }

  function downloadImportTemplate() {
    const blob = new Blob([contentImportCsvTemplate], {
      type: "text/csv;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tlv-quest-content-import.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function runBulkImport(dryRun: boolean) {
    if (!selectedRoute || !selectedVersion || !importContent.trim()) return;
    await operation(dryRun ? "import-dry-run" : "import-apply", async () => {
      const key = importKey || `content-import:${crypto.randomUUID()}`;
      if (!importKey) setImportKey(key);
      const result = await requestJson<ContentImportResult>(
        `/api/admin/content/templates/${selectedRoute.id}/versions/${selectedVersion}/imports`,
        token,
        {
          method: "POST",
          headers: { "idempotency-key": key },
          body: JSON.stringify({
            format: importFormat,
            content: importContent,
            dryRun
          })
        }
      );
      setImportResult(result);
      if (!result.ok) return;
      if (dryRun) {
        setMessage(`בדיקת הייבוא עברה: ${result.rowCount} שורות ללא שינויים במסלול.`);
        return;
      }
      await Promise.all([
        loadAll(token, selectedRoute.id, selectedVersion),
        loadImportBatches()
      ]);
      setMessage(
        result.duplicate
          ? "הבקשה כבר יושמה בעבר; לא נוצרו כפילויות."
          : `הייבוא הוחל אטומית: ${result.rowCount} תחנות.`
      );
    });
  }

  async function rollbackImport(batch: ContentImportBatch) {
    if (
      !selectedRoute ||
      !selectedVersion ||
      !window.confirm(
        "לבטל את הייבוא ולהחזיר את המסלול למצב שלפניו? הפעולה תיחסם אם נעשו מאז שינויים."
      )
    ) {
      return;
    }
    await operation("import-rollback", async () => {
      await requestJson(
        `/api/admin/content/templates/${selectedRoute.id}/versions/${selectedVersion}/imports`,
        token,
        {
          method: "DELETE",
          headers: {
            "idempotency-key": `content-import-rollback:${crypto.randomUUID()}`
          },
          body: JSON.stringify({ batchId: batch.id })
        }
      );
      await Promise.all([
        loadAll(token, selectedRoute.id, selectedVersion),
        loadImportBatches()
      ]);
      setMessage("הייבוא בוטל והמסלול הקודם שוחזר.");
    });
  }

  function openRouteGenerator() {
    const located = stations.filter(
      (station) =>
        station.latitude !== null && station.longitude !== null
    );
    if (located.length >= 2) {
      const latitudes = located.map((station) => station.latitude as number);
      const longitudes = located.map((station) => station.longitude as number);
      const padding = 0.0015;
      const south = Math.min(...latitudes) - padding;
      const north = Math.max(...latitudes) + padding;
      const west = Math.min(...longitudes) - padding;
      const east = Math.max(...longitudes) + padding;
      setGeneratorPolygon(
        JSON.stringify(
          [
            { latitude: south, longitude: west },
            { latitude: south, longitude: east },
            { latitude: north, longitude: east },
            { latitude: north, longitude: west }
          ],
          null,
          2
        )
      );
    }
    setGeneratedRoute(null);
    setGeneratorOpen(true);
  }

  async function generateRouteDraft(event: FormEvent) {
    event.preventDefault();
    await operation("generate-route", async () => {
      let polygon: unknown;
      try {
        polygon = JSON.parse(generatorPolygon);
      } catch {
        throw new Error("הפוליגון חייב להיות JSON תקין.");
      }
      const draft = await requestJson<RouteGenerationDraft>(
        "/api/admin/content/route-generator",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            templateId: selectedTemplateId || null,
            polygon,
            audience: generatorAudience,
            durationMinutes: generatorDuration,
            locale: generatorLocale,
            constraints: { wheelchair: generatorWheelchair }
          })
        }
      );
      setGeneratedRoute(draft);
      setMessage(
        "נוצרה טיוטת מסלול בלבד. היא לא שינתה את הגרסה ולא ניתנת לפרסום ללא עריכה ובדיקות."
      );
    });
  }

  async function addStationToRoute(station: Station) {
    if (!selectedRoute || !selectedVersion || !editable) return;
    const stationRiddles = riddlesByStation.get(station.id) ?? [];
    const riddleId = riddlePicker[station.id] || stationRiddles.find((item) => item.status === "active")?.id || stationRiddles[0]?.id;
    if (!riddleId) {
      setTab("riddles");
      setSelectedStationId(station.id);
      openRiddle(undefined, station.id);
      setError("לתחנה הזו עדיין אין חידה. צור חידה ואז חזור למסלול.");
      return;
    }
    await operation("add-stop", async () => {
      await requestJson(
        `/api/admin/content/templates/${selectedRoute.id}/versions/${selectedVersion}/stops`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            stationId: station.id,
            riddleId,
            afterStopId: activeStops.at(-1)?.id ?? null
          })
        }
      );
      await loadAll(token, selectedRoute.id, selectedVersion);
      setMessage(`${titleOf(station.title, station.slug)} נוספה למסלול.`);
    });
  }

  async function updateStop(stop: RouteStop, patch: Partial<RouteStop>) {
    if (!editable) return;
    const next = { ...stop, ...patch };
    await operation(`stop-${stop.id}`, async () => {
      await requestJson(`/api/admin/content/route-stops/${stop.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          riddleId: next.riddle_id,
          slug: next.slug,
          isOptional: next.is_optional,
          isActive: next.is_active,
          overrides: next.overrides
        })
      });
      await loadAll(token, selectedTemplateId, selectedVersion ?? undefined);
      setMessage("התחנה במסלול עודכנה.");
    });
  }

  async function removeStop(stop: RouteStop) {
    if (!editable || !window.confirm("להסיר את התחנה מהמסלול? התחנה והחידות יישארו בספרייה.")) return;
    await operation(`remove-${stop.id}`, async () => {
      await requestJson(`/api/admin/content/route-stops/${stop.id}`, token, { method: "DELETE" });
      await loadAll(token, selectedTemplateId, selectedVersion ?? undefined);
      setMessage("התחנה הוסרה מהמסלול בלבד.");
    });
  }

  async function reorderStops(ids: string[]) {
    if (!selectedRoute || !selectedVersion || !editable) return;
    const previous = routeStops;
    const others = routeStops.filter((stop) => stop.template_id !== selectedRoute.id || stop.version !== selectedVersion);
    const byId = new Map(activeStops.map((stop) => [stop.id, stop]));
    setRouteStops([
      ...others,
      ...ids.map((id, index) => ({ ...byId.get(id)!, sequence_no: index + 1 }))
    ]);
    try {
      await requestJson(
        `/api/admin/content/templates/${selectedRoute.id}/versions/${selectedVersion}/stops`,
        token,
        { method: "PATCH", body: JSON.stringify({ stopIds: ids }) }
      );
      await loadAll(token, selectedRoute.id, selectedVersion);
      setMessage("סדר התחנות נשמר.");
    } catch (cause) {
      setRouteStops(previous);
      setError(cause instanceof Error ? cause.message : "Reorder failed");
    }
  }

  function moveStop(stopId: string, direction: -1 | 1) {
    const ids = activeStops.map((stop) => stop.id);
    const index = ids.indexOf(stopId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void reorderStops(ids);
  }

  function dropStop(targetId: string) {
    if (!draggedStopId || draggedStopId === targetId) return setDraggedStopId("");
    const ids = activeStops.map((stop) => stop.id);
    const from = ids.indexOf(draggedStopId);
    const to = ids.indexOf(targetId);
    if (from >= 0 && to >= 0) {
      ids.splice(from, 1);
      ids.splice(to, 0, draggedStopId);
      void reorderStops(ids);
    }
    setDraggedStopId("");
  }

  const filteredStations = stations.filter((station) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [station.slug, titleOf(station.title, ""), station.tags.join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const filteredRiddles = riddles.filter((riddle) => {
    const query = search.trim().toLowerCase();
    const station = stations.find((item) => item.id === riddle.station_id);
    if (selectedStationId && tab === "riddles" && riddle.station_id !== selectedStationId) return false;
    if (!query) return true;
    return [riddle.slug, titleOf(riddle.title, ""), station ? titleOf(station.title, "") : "", riddle.tags.join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const previewStop =
    previewStops[Math.min(previewIndex, Math.max(0, previewStops.length - 1))] ??
    null;
  const previewContent = previewStop
    ? objectValue(previewStop.riddle.content[previewLocale])
    : {};
  const previewValidation = previewStop
    ? objectValue(previewStop.riddle.validation)
    : {};
  const previewOptions = Array.isArray(previewValidation.options)
    ? previewValidation.options.filter(
        (option): option is string => typeof option === "string"
      )
    : [];

  if (!authChecked) {
    return <main className={styles.shell}><div className={styles.loading}>טוען את סביבת התוכן…</div></main>;
  }
  if (!token) {
    return (
      <main className={styles.shell}>
        <section className={styles.loginCard}>
          <div className={styles.logoMark}>Q</div>
          <span className={styles.eyebrow}>Protected content workspace</span>
          <h1>נדרשת כניסת מנהל</h1>
          <p>התחבר באמצעות Magic Link כדי לנהל מסלולים, תחנות וחידות.</p>
          <Link className={styles.primaryButton} href="/admin">מעבר לכניסה</Link>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brandBlock}>
          <div className={styles.logoMark}>Q</div>
          <div><strong>TLV Quest Studio</strong><span>Content workspace</span></div>
        </div>
        <div className={styles.topActions}>
          <span className={styles.saveState}>{busy ? "שומר…" : "כל השינויים נשמרים בענן"}</span>
          <Link className={styles.quietButton} href="/admin">ניהול מערכת</Link>
        </div>
      </header>

      <div className={styles.page}>
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>Content architecture 2.0</span>
            <h1>מקום, חידה ומסלול — כל אחד בפני עצמו.</h1>
            <p>בונים ספריית תחנות פעם אחת, מוסיפים לכל תחנה כמה חידות, ומרכיבים מהן מסלולים שונים בלי לשכפל תוכן.</p>
          </div>
          <div className={styles.heroMetrics}>
            <div><strong>{catalog.length}</strong><span>מסלולים</span></div>
            <div><strong>{stations.length}</strong><span>תחנות</span></div>
            <div><strong>{riddles.length}</strong><span>חידות</span></div>
          </div>
        </section>

        <nav className={styles.tabs} aria-label="Content sections">
          <button type="button" className={tab === "routes" ? styles.activeTab : ""} onClick={() => { setTab("routes"); setSearch(""); }}>
            <span className={styles.tabIcon}>⌁</span><strong>מסלולים</strong><small>הרכבה ופרסום</small>
          </button>
          <button type="button" className={tab === "stations" ? styles.activeTab : ""} onClick={() => { setTab("stations"); setSearch(""); setSelectedStationId(""); }}>
            <span className={styles.tabIcon}>⌖</span><strong>תחנות</strong><small>מקומות ותמונות</small>
          </button>
          <button type="button" className={tab === "riddles" ? styles.activeTab : ""} onClick={() => { setTab("riddles"); setSearch(""); }}>
            <span className={styles.tabIcon}>?</span><strong>חידות</strong><small>כמה חידות לכל מקום</small>
          </button>
        </nav>

        {message && <div className={styles.successBanner}>✓ {message}</div>}
        {error && <div className={styles.errorBanner}>{error}</div>}

        {tab === "routes" && (
          <section className={styles.routesWorkspace}>
            <aside className={styles.routeSidebar}>
              <div className={styles.sectionHeading}>
                <div><span className={styles.eyebrow}>Route library</span><h2>המסלולים שלי</h2></div>
                <button type="button" className={styles.iconButton} onClick={() => setRouteModalOpen(true)} aria-label="מסלול חדש">＋</button>
              </div>
              <div className={styles.routeList}>
                {catalog.map((route) => (
                  <button
                    type="button"
                    key={route.id}
                    className={`${styles.routeCard} ${selectedTemplateId === route.id ? styles.selected : ""}`}
                    onClick={() => {
                      const version = route.versions.find((item) => item.isActiveVersion) ?? route.versions[0];
                      if (version) void loadDetail(route.id, version.version);
                    }}
                  >
                    <span className={styles.routeBadge}>{route.is_active ? "LIVE" : "DRAFT"}</span>
                    <strong>{titleOf(route.title, route.slug)}</strong>
                    <small>{route.versions.length} גרסאות · {route.runCount} הרצות</small>
                  </button>
                ))}
                {!catalog.length && <div className={styles.emptyMini}>עדיין אין מסלולים.</div>}
              </div>
            </aside>

            <div className={styles.routeMain}>
              {!selectedRoute || !selectedVersionSummary || !detail ? (
                <div className={styles.emptyState}><div>⌁</div><h2>בחר מסלול או צור מסלול חדש</h2><p>לאחר מכן אפשר להוסיף תחנות מהספרייה ולבחור חידה לכל תחנה.</p></div>
              ) : (
                <>
                  <header className={styles.routeHeader}>
                    <div>
                      <div className={styles.routeHeaderMeta}><span className={styles.statusPill}>{selectedVersionSummary.status}</span><span>{selectedRoute.slug}</span></div>
                      <h2>{titleOf(selectedRoute.title, selectedRoute.slug)}</h2>
                      <p>{textValue(selectedRoute.description.he) || textValue(selectedRoute.description.en)}</p>
                    </div>
                    <div className={styles.headerActions}>
                      <button type="button" className={styles.quietButton} onClick={() => { setPreviewIndex(0); setPreviewOpen(true); }} disabled={!previewStops.length}>תצוגת שחקן</button>
                      <button type="button" className={styles.quietButton} onClick={openRouteGenerator}>טיוטת מסלול AI</button>
                      <button type="button" className={styles.quietButton} onClick={() => void openImportWorkspace()} disabled={!editable}>ייבוא CSV / JSON</button>
                      <button type="button" className={styles.quietButton} onClick={() => setRouteSettingsOpen(true)}>הגדרות</button>
                      <button type="button" className={styles.quietButton} onClick={cloneVersion} disabled={busy === "clone-version"}>שכפול גרסה</button>
                      <button type="button" className={styles.primaryButton} onClick={publishVersion} disabled={!editable || !detail.report.ok || busy === "publish"}>פרסום</button>
                    </div>
                  </header>

                  <div className={styles.versionStrip}>
                    {selectedRoute.versions.map((version) => (
                      <button
                        type="button"
                        key={version.version}
                        className={selectedVersion === version.version ? styles.selectedVersion : ""}
                        onClick={() => void loadDetail(selectedRoute.id, version.version)}
                      >
                        <strong>v{version.version}</strong><span>{version.release_name || "ללא שם"}</span><small>{version.checkpointCount} תחנות</small>
                      </button>
                    ))}
                  </div>

                  {generatorOpen && (
                    <section className="route-generator-panel">
                      <header>
                        <div>
                          <span>AI ROUTE DRAFT · NEVER AUTO-PUBLISHES</span>
                          <h3>מחולל מסלול לפי אזור, קהל, זמן ואילוצים</h3>
                          <p>המחולל משתמש רק בתחנות ובחידות פעילות, מאמת את פלט המודל ושומר provenance, confidence ורשימת בדיקות שטח.</p>
                        </div>
                        <button type="button" onClick={() => setGeneratorOpen(false)}>×</button>
                      </header>
                      <form onSubmit={generateRouteDraft}>
                        <div className="route-generator-fields">
                          <label><span>קהל</span><input value={generatorAudience} onChange={(event) => setGeneratorAudience(event.target.value)} /></label>
                          <label><span>משך בדקות</span><input type="number" min="30" max="360" value={generatorDuration} onChange={(event) => setGeneratorDuration(Number(event.target.value))} /></label>
                          <label><span>שפה</span><select value={generatorLocale} onChange={(event) => setGeneratorLocale(event.target.value === "en" ? "en" : "he")}><option value="he">עברית</option><option value="en">English</option></select></label>
                          <label className="route-generator-check"><input type="checkbox" checked={generatorWheelchair} onChange={(event) => setGeneratorWheelchair(event.target.checked)} /> נגישות לכיסא גלגלים</label>
                        </div>
                        <label className="route-polygon-field"><span>פוליגון JSON</span><textarea value={generatorPolygon} onChange={(event) => setGeneratorPolygon(event.target.value)} rows={7} dir="ltr" /></label>
                        <button className={styles.primaryButton} disabled={busy === "generate-route"}>{busy === "generate-route" ? "מייצר ובודק…" : "יצירת טיוטה לבדיקה"}</button>
                      </form>
                      {generatedRoute && (
                        <div className="generated-route-result">
                          <div className="generated-route-meta">
                            <strong>Confidence {(generatedRoute.confidence * 100).toFixed(0)}%</strong>
                            <span>{generatedRoute.provenance.provider} · {generatedRoute.provenance.model || generatedRoute.provenance.algorithm}</span>
                            <span>{generatedRoute.proposed_route.analysis.totalDistanceMeters} מ׳ · {generatedRoute.proposed_route.analysis.walkingMinutes} דק׳ הליכה · {generatedRoute.proposed_route.analysis.estimatedExperienceMinutes} דק׳ כולל משימות</span>
                          </div>
                          <p>{generatedRoute.proposed_route.rationale}</p>
                          <ol>{generatedRoute.proposed_route.stops.map((stop) => <li key={stop.stationId}><strong>{titleOf(stop.stationTitle, stop.stationSlug)}</strong><span>{stop.kind} · {stop.healthStatus}</span></li>)}</ol>
                          <div className="generated-route-warning"><strong>טיוטה בלבד — לא בוצע שינוי במסלול</strong><span>{generatedRoute.verification_requirements.length ? generatedRoute.verification_requirements.join(" · ") : "נדרשת עדיין סקירה אנושית מלאה לפני העתקה לעורך."}</span></div>
                        </div>
                      )}
                    </section>
                  )}

                  {detail.report.errors.length > 0 && (
                    <details className={styles.qualityPanel} open>
                      <summary><strong>{detail.report.errors.length} דברים שחוסמים פרסום</strong><span>פתיחת פירוט</span></summary>
                      <div>{detail.report.errors.map((issue) => <p key={`${issue.code}-${issue.message}`}>• {issue.message}</p>)}</div>
                    </details>
                  )}

                  <RouteSafetyMap
                    stops={activeStops}
                    stations={stations}
                    wheelchairRequired={
                      objectValue(detail.version.route_config).wheelchair === true
                    }
                  />

                  <div className={styles.builderGrid}>
                    <section className={styles.routeCanvas}>
                      <div className={styles.canvasHeading}>
                        <div><span className={styles.eyebrow}>Route canvas</span><h3>סדר התחנות</h3></div>
                        <span>{activeStops.length} תחנות</span>
                      </div>
                      {!activeStops.length ? (
                        <div className={styles.routeEmpty}><div>＋</div><h3>המסלול עדיין ריק</h3><p>בחר תחנה מהספרייה משמאל, בחר עבורה חידה והוסף אותה למסלול.</p></div>
                      ) : (
                        <div className={styles.timeline}>
                          {activeStops.map((stop, index) => {
                            const station = stations.find((item) => item.id === stop.station_id);
                            const riddle = riddles.find((item) => item.id === stop.riddle_id);
                            const stationRiddles = riddlesByStation.get(stop.station_id) ?? [];
                            if (!station || !riddle) return null;
                            return (
                              <article
                                key={stop.id}
                                className={`${styles.stopCard} ${draggedStopId === stop.id ? styles.dragging : ""}`}
                                draggable={editable}
                                onDragStart={() => setDraggedStopId(stop.id)}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={() => dropStop(stop.id)}
                                onDragEnd={() => setDraggedStopId("")}
                              >
                                <div className={styles.stopNumber}>{String(index + 1).padStart(2, "0")}</div>
                                <div className={styles.stopImage}>
                                  {station.hero_image_url ? <img src={station.hero_image_url} alt="" /> : <span>⌖</span>}
                                </div>
                                <div className={styles.stopContent}>
                                  <div className={styles.stopTitleRow}>
                                    <div><strong>{titleOf(station.title, station.slug)}</strong><small>{titleOf(riddle.title, riddle.slug)} · {kindLabel(riddle.kind)}</small></div>
                                    <span className={station.health_status === "verified" ? styles.healthGood : styles.healthPending}>{station.health_status === "verified" ? "מאומת" : "בדיקה"}</span>
                                  </div>
                                  <div className={styles.stopControls}>
                                    <label><span>החידה בתחנה</span><select value={stop.riddle_id} disabled={!editable} onChange={(event) => void updateStop(stop, { riddle_id: event.target.value })}>{stationRiddles.map((item) => <option key={item.id} value={item.id}>{titleOf(item.title, item.slug)} · {kindLabel(item.kind)}</option>)}</select></label>
                                    <label><span>Slug במסלול</span><input defaultValue={stop.slug} disabled={!editable} onBlur={(event) => { if (event.target.value !== stop.slug) void updateStop(stop, { slug: event.target.value }); }} /></label>
                                  </div>
                                  <div className={styles.stopFooter}>
                                    <label className={styles.toggle}><input type="checkbox" checked={stop.is_optional} disabled={!editable} onChange={(event) => void updateStop(stop, { is_optional: event.target.checked })} /><span />אופציונלית</label>
                                    <label className={styles.toggle}><input type="checkbox" checked={stop.is_active} disabled={!editable} onChange={(event) => void updateStop(stop, { is_active: event.target.checked })} /><span />פעילה</label>
                                    <div className={styles.reorderButtons}>
                                      <button type="button" onClick={() => moveStop(stop.id, -1)} disabled={!editable || index === 0}>↑</button>
                                      <button type="button" onClick={() => moveStop(stop.id, 1)} disabled={!editable || index === activeStops.length - 1}>↓</button>
                                      <button type="button" className={styles.removeButton} onClick={() => void removeStop(stop)} disabled={!editable}>הסרה</button>
                                    </div>
                                  </div>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </section>

                    <aside className={styles.stationPicker}>
                      <div className={styles.canvasHeading}><div><span className={styles.eyebrow}>Station library</span><h3>הוספת תחנה</h3></div></div>
                      <div className={styles.searchBox}><span>⌕</span><input value={stationPicker} onChange={(event) => setStationPicker(event.target.value)} placeholder="חיפוש תחנה…" /></div>
                      <div className={styles.pickerList}>
                        {stations.filter((station) => {
                          const query = stationPicker.toLowerCase().trim();
                          return !query || `${station.slug} ${titleOf(station.title, "")} ${station.tags.join(" ")}`.toLowerCase().includes(query);
                        }).map((station) => {
                          const stationRiddles = riddlesByStation.get(station.id) ?? [];
                          const selected = riddlePicker[station.id] || stationRiddles.find((item) => item.status === "active")?.id || stationRiddles[0]?.id || "";
                          return (
                            <article key={station.id} className={styles.pickerCard}>
                              <div className={styles.pickerImage}>{station.hero_image_url ? <img src={station.hero_image_url} alt="" /> : <span>⌖</span>}</div>
                              <div><strong>{titleOf(station.title, station.slug)}</strong><small>{stationRiddles.length} חידות · {station.tags.slice(0, 2).join(" · ") || "ללא תגיות"}</small></div>
                              {stationRiddles.length ? (
                                <select value={selected} onChange={(event) => setRiddlePicker((current) => ({ ...current, [station.id]: event.target.value }))}>{stationRiddles.map((riddle) => <option key={riddle.id} value={riddle.id}>{titleOf(riddle.title, riddle.slug)}</option>)}</select>
                              ) : <span className={styles.noRiddles}>אין חידות</span>}
                              <button type="button" className={styles.addButton} disabled={!editable || busy === "add-stop"} onClick={() => void addStationToRoute(station)}>＋ הוספה</button>
                            </article>
                          );
                        })}
                      </div>
                    </aside>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {tab === "stations" && (
          <section className={styles.librarySection}>
            <header className={styles.libraryHeader}>
              <div><span className={styles.eyebrow}>Reusable places</span><h2>ספריית התחנות</h2><p>תחנה היא המקום הפיזי: כתובת, מיקום, תמונה, נגישות ובדיקת שטח. החידות מנוהלות בנפרד.</p></div>
              <button type="button" className={styles.primaryButton} onClick={() => openStation()}>＋ תחנה חדשה</button>
            </header>
            <div className={styles.libraryToolbar}>
              <div className={styles.searchBox}><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="חיפוש לפי שם, slug או תגית…" /></div>
              <span>{filteredStations.length} תחנות</span>
            </div>
            <div className={styles.stationGrid}>
              {filteredStations.map((station) => (
                <article key={station.id} className={styles.stationCard} onClick={() => openStation(station)}>
                  <div className={styles.stationVisual}>
                    {station.hero_image_url ? <img src={station.hero_image_url} alt="" /> : <div className={styles.stationPlaceholder}>⌖</div>}
                    <span className={station.status === "active" ? styles.liveBadge : styles.draftBadge}>{station.status}</span>
                  </div>
                  <div className={styles.stationBody}>
                    <h3>{titleOf(station.title, station.slug)}</h3>
                    <p>{textValue(station.description.he) || textValue(station.description.en) || "ללא תיאור"}</p>
                    <div className={styles.tagRow}>{station.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>
                    <div className={styles.cardStats}><span>{riddlesByStation.get(station.id)?.length ?? 0} חידות</span><span>{usageByStation.get(station.id) ?? 0} שימושים</span><span>{station.health_status === "verified" ? "✓ שטח מאומת" : "בדיקת שטח"}</span></div>
                  </div>
                </article>
              ))}
              {!filteredStations.length && <div className={styles.emptyState}><div>⌖</div><h3>לא נמצאו תחנות</h3><p>צור תחנה חדשה או שנה את החיפוש.</p></div>}
            </div>
          </section>
        )}

        {tab === "riddles" && (
          <section className={styles.librarySection}>
            <header className={styles.libraryHeader}>
              <div><span className={styles.eyebrow}>Reusable challenges</span><h2>ספריית החידות</h2><p>לכל תחנה אפשר להכין כמה חידות מסוגים שונים ולבחור בכל מסלול את החידה המתאימה.</p></div>
              <button type="button" className={styles.primaryButton} onClick={() => openRiddle(undefined, selectedStationId)}>＋ חידה חדשה</button>
            </header>
            <div className={styles.libraryToolbar}>
              <div className={styles.searchBox}><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="חיפוש חידה…" /></div>
              <select value={selectedStationId} onChange={(event) => setSelectedStationId(event.target.value)}><option value="">כל התחנות</option>{stations.map((station) => <option key={station.id} value={station.id}>{titleOf(station.title, station.slug)}</option>)}</select>
              <span>{filteredRiddles.length} חידות</span>
            </div>
            <div className={styles.riddleGrid}>
              {filteredRiddles.map((riddle) => {
                const station = stations.find((item) => item.id === riddle.station_id);
                const content = objectValue(riddle.content.he);
                return (
                  <article key={riddle.id} className={styles.riddleCard} onClick={() => openRiddle(riddle)}>
                    <div className={styles.riddleTop}><span className={styles.kindBadge}>{kindLabel(riddle.kind)}</span><span className={riddle.status === "active" ? styles.liveBadge : styles.draftBadge}>{riddle.status}</span></div>
                    <h3>{titleOf(riddle.title, riddle.slug)}</h3>
                    <p className={styles.stationLink}>⌖ {station ? titleOf(station.title, station.slug) : "תחנה לא ידועה"}</p>
                    <p>{textValue(content.prompt) || "עדיין אין ניסוח למשימה"}</p>
                    <div className={styles.cardStats}><span>{Array.isArray(riddle.hints) ? riddle.hints.length : 0} רמזים</span><span>{usageByRiddle.get(riddle.id) ?? 0} מסלולים</span><span>{riddle.slug}</span></div>
                  </article>
                );
              })}
              {!filteredRiddles.length && <div className={styles.emptyState}><div>?</div><h3>לא נמצאו חידות</h3><p>בחר תחנה אחרת או צור חידה חדשה.</p></div>}
            </div>
          </section>
        )}
      </div>

      {editorOpen && tab === "stations" && (
        <div className={styles.drawerBackdrop} onMouseDown={() => setEditorOpen(false)}>
          <aside className={styles.drawer} onMouseDown={(event) => event.stopPropagation()}>
            <header className={styles.drawerHeader}><div><span className={styles.eyebrow}>Station editor</span><h2>{stationDraft.id ? "עריכת תחנה" : "תחנה חדשה"}</h2></div><button type="button" onClick={() => setEditorOpen(false)}>×</button></header>
            <form className={styles.editorForm} onSubmit={saveStation}>
              <section className={styles.imageEditor}>
                <div className={styles.imagePreview}>{stationDraft.imageUrl ? <img src={stationDraft.imageUrl} alt="" /> : <span>⌖</span>}</div>
                <div><h3>תמונת התחנה</h3><p>התמונה מופיעה בספרייה ובמשימת השחקן.</p><div className={styles.inlineActions}><button type="button" className={styles.quietButton} onClick={() => fileInputRef.current?.click()} disabled={!stationDraft.id || busy === "station-image"}>העלאת תמונה</button>{stationDraft.imageUrl && <button type="button" className={styles.textDanger} onClick={() => void removeStationImage()}>הסרה</button>}</div><input ref={fileInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadStationImage(file); event.target.value = ""; }} /></div>
              </section>
              {!stationDraft.id && <div className={styles.notice}>שמור תחילה את התחנה, ולאחר מכן יהיה אפשר להעלות תמונה.</div>}
              <section className={styles.formSection}><div><span className={styles.eyebrow}>Identity</span><h3>שם ותיאור</h3></div><div className={styles.formGrid}><label><span>שם בעברית</span><input required value={stationDraft.titleHe} onChange={(event) => setStationDraft((current) => ({ ...current, titleHe: event.target.value }))} /></label><label><span>English title</span><input value={stationDraft.titleEn} onChange={(event) => setStationDraft((current) => ({ ...current, titleEn: event.target.value }))} /></label><label className={styles.fullField}><span>Slug</span><input required value={stationDraft.slug} onChange={(event) => setStationDraft((current) => ({ ...current, slug: event.target.value }))} /></label><label><span>תיאור בעברית</span><textarea value={stationDraft.descriptionHe} onChange={(event) => setStationDraft((current) => ({ ...current, descriptionHe: event.target.value }))} /></label><label><span>English description</span><textarea value={stationDraft.descriptionEn} onChange={(event) => setStationDraft((current) => ({ ...current, descriptionEn: event.target.value }))} /></label></div></section>
              <section className={styles.formSection}><div><span className={styles.eyebrow}>Place</span><h3>מיקום וגישה</h3></div><div className={styles.formGrid}><label><span>כתובת / הנחיית הגעה</span><input value={stationDraft.addressHe} onChange={(event) => setStationDraft((current) => ({ ...current, addressHe: event.target.value }))} /></label><label><span>Address in English</span><input value={stationDraft.addressEn} onChange={(event) => setStationDraft((current) => ({ ...current, addressEn: event.target.value }))} /></label><label><span>Latitude</span><input inputMode="decimal" value={stationDraft.latitude} onChange={(event) => setStationDraft((current) => ({ ...current, latitude: event.target.value }))} /></label><label><span>Longitude</span><input inputMode="decimal" value={stationDraft.longitude} onChange={(event) => setStationDraft((current) => ({ ...current, longitude: event.target.value }))} /></label><label><span>רדיוס אימות במטרים</span><input type="number" min="1" value={stationDraft.radiusMeters} onChange={(event) => setStationDraft((current) => ({ ...current, radiusMeters: event.target.value }))} /></label><label><span>תגיות, מופרדות בפסיק</span><input value={stationDraft.tags} onChange={(event) => setStationDraft((current) => ({ ...current, tags: event.target.value }))} /></label></div><div className={styles.toggleRow}><label className={styles.toggle}><input type="checkbox" checked={stationDraft.wheelchair} onChange={(event) => setStationDraft((current) => ({ ...current, wheelchair: event.target.checked }))} /><span />נגיש לכיסא גלגלים</label><label className={styles.toggle}><input type="checkbox" checked={stationDraft.stroller} onChange={(event) => setStationDraft((current) => ({ ...current, stroller: event.target.checked }))} /><span />נגיש לעגלה</label><label className={styles.toggle}><input type="checkbox" checked={stationDraft.fieldRequired} onChange={(event) => setStationDraft((current) => ({ ...current, fieldRequired: event.target.checked, healthStatus: event.target.checked ? "pending" : "not_required" }))} /><span />נדרשת בדיקת שטח</label></div></section>
              <section className={styles.formSection}><div><span className={styles.eyebrow}>Operations</span><h3>סטטוס ובדיקת שטח</h3></div><div className={styles.formGrid}><label><span>סטטוס התחנה</span><select value={stationDraft.status} onChange={(event) => setStationDraft((current) => ({ ...current, status: event.target.value }))}><option value="draft">טיוטה</option><option value="active">פעילה</option><option value="archived">ארכיון</option></select></label><label><span>מצב בדיקת שטח</span><select disabled={!stationDraft.fieldRequired} value={stationDraft.healthStatus} onChange={(event) => setStationDraft((current) => ({ ...current, healthStatus: event.target.value }))}><option value="not_required">לא נדרש</option><option value="pending">ממתין לבדיקה</option><option value="verified">מאומת</option><option value="needs_attention">דורש טיפול</option><option value="blocked">חסום</option></select></label><label className={styles.fullField}><span>הערות תפעול</span><textarea value={stationDraft.healthNotes} onChange={(event) => setStationDraft((current) => ({ ...current, healthNotes: event.target.value }))} /></label></div></section>
              <footer className={styles.drawerFooter}>{stationDraft.id && <button type="button" className={styles.textDanger} onClick={() => void deleteStation()}>מחיקת תחנה</button>}<div><button type="button" className={styles.quietButton} onClick={() => setEditorOpen(false)}>ביטול</button><button type="submit" className={styles.primaryButton} disabled={busy === "save-station"}>{busy === "save-station" ? "שומר…" : "שמירת תחנה"}</button></div></footer>
            </form>
          </aside>
        </div>
      )}

      {editorOpen && tab === "riddles" && (
        <div className={styles.drawerBackdrop} onMouseDown={() => setEditorOpen(false)}>
          <aside className={`${styles.drawer} ${styles.wideDrawer}`} onMouseDown={(event) => event.stopPropagation()}>
            <header className={styles.drawerHeader}><div><span className={styles.eyebrow}>Riddle editor</span><h2>{riddleDraft.id ? "עריכת חידה" : "חידה חדשה"}</h2></div><button type="button" onClick={() => setEditorOpen(false)}>×</button></header>
            <form className={styles.editorForm} onSubmit={saveRiddle}>
              <section className={styles.formSection}><div><span className={styles.eyebrow}>Placement</span><h3>לאיזו תחנה החידה שייכת?</h3><p>אפשר ליצור כמה חידות לכל תחנה. במסלול בוחרים אחת מהן.</p></div><div className={styles.formGrid}><label><span>תחנה</span><select required value={riddleDraft.stationId} disabled={Boolean(riddleDraft.id)} onChange={(event) => setRiddleDraft((current) => ({ ...current, stationId: event.target.value }))}><option value="">בחירת תחנה</option>{stations.map((station) => <option key={station.id} value={station.id}>{titleOf(station.title, station.slug)}</option>)}</select></label><label><span>סוג חידה</span><select value={riddleDraft.kind} onChange={(event) => setRiddleDraft((current) => ({ ...current, kind: event.target.value }))}>{riddleKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>שם החידה בעברית</span><input required value={riddleDraft.titleHe} onChange={(event) => setRiddleDraft((current) => ({ ...current, titleHe: event.target.value }))} /></label><label><span>English riddle name</span><input value={riddleDraft.titleEn} onChange={(event) => setRiddleDraft((current) => ({ ...current, titleEn: event.target.value }))} /></label><label className={styles.fullField}><span>Slug</span><input required value={riddleDraft.slug} onChange={(event) => setRiddleDraft((current) => ({ ...current, slug: event.target.value }))} /></label></div></section>
              <section className={styles.formSection}>
                <div className={styles.sectionTitleRow}>
                  <div>
                    <span className={styles.eyebrow}>Assisted translation</span>
                    <h3>טיוטת תרגום עם אישור אנושי</h3>
                    <p>ההצעה ממלאת את הטיוטה בלבד, נשמרת עם provenance ואינה מפרסמת תוכן.</p>
                  </div>
                  <div>
                    <button type="button" className={styles.quietButton} disabled={busy === "translate-riddle"} onClick={() => void translateRiddleCopy("he", "en")}>עברית ← English</button>
                    <button type="button" className={styles.quietButton} disabled={busy === "translate-riddle"} onClick={() => void translateRiddleCopy("en", "he")}>English ← עברית</button>
                  </div>
                </div>
              </section>
              <section className={styles.formSection}><div><span className={styles.eyebrow}>Player copy</span><h3>מה השחקנים רואים?</h3></div><div className={styles.languageColumns}><div><strong>עברית</strong><label><span>סיפור / הקשר</span><textarea value={riddleDraft.storyHe} onChange={(event) => setRiddleDraft((current) => ({ ...current, storyHe: event.target.value }))} /></label><label><span>המשימה</span><textarea required value={riddleDraft.promptHe} onChange={(event) => setRiddleDraft((current) => ({ ...current, promptHe: event.target.value }))} /></label><label><span>רמז מיקום</span><input value={riddleDraft.locationHintHe} onChange={(event) => setRiddleDraft((current) => ({ ...current, locationHintHe: event.target.value }))} /></label><label><span>הודעת הצלחה</span><input value={riddleDraft.successHe} onChange={(event) => setRiddleDraft((current) => ({ ...current, successHe: event.target.value }))} /></label></div><div dir="ltr"><strong>English</strong><label><span>Story / context</span><textarea value={riddleDraft.storyEn} onChange={(event) => setRiddleDraft((current) => ({ ...current, storyEn: event.target.value }))} /></label><label><span>Task</span><textarea required value={riddleDraft.promptEn} onChange={(event) => setRiddleDraft((current) => ({ ...current, promptEn: event.target.value }))} /></label><label><span>Location hint</span><input value={riddleDraft.locationHintEn} onChange={(event) => setRiddleDraft((current) => ({ ...current, locationHintEn: event.target.value }))} /></label><label><span>Success message</span><input value={riddleDraft.successEn} onChange={(event) => setRiddleDraft((current) => ({ ...current, successEn: event.target.value }))} /></label></div></div></section>
              <section className={styles.formSection}><div><span className={styles.eyebrow}>Validation</span><h3>איך פותרים?</h3></div>{riddleDraft.kind === "choice" ? <div className={styles.formGrid}><label><span>אפשרויות — שורה לכל אפשרות</span><textarea value={riddleDraft.choiceOptions} onChange={(event) => setRiddleDraft((current) => ({ ...current, choiceOptions: event.target.value }))} /></label><label><span>האפשרות הנכונה</span><input value={riddleDraft.acceptedOption} onChange={(event) => setRiddleDraft((current) => ({ ...current, acceptedOption: event.target.value }))} /></label></div> : riddleDraft.kind === "photo" ? <div className={styles.formGrid}><label className={styles.fullField}><span>קריטריונים לבדיקת התמונה</span><textarea value={riddleDraft.photoCriteria} onChange={(event) => setRiddleDraft((current) => ({ ...current, photoCriteria: event.target.value }))} /></label><label><span>סף ביטחון</span><input type="number" min="0" max="1" step="0.01" value={riddleDraft.confidenceThreshold} onChange={(event) => setRiddleDraft((current) => ({ ...current, confidenceThreshold: Number(event.target.value) }))} /></label></div> : riddleDraft.kind === "scan" ? <div className={styles.notice}>החידה תושלם בסריקת קישור התחנה. אין צורך בתשובה כתובה.</div> : <div className={styles.formGrid}><label><span>תשובות מתקבלות — שורה לכל תשובה</span><textarea value={riddleDraft.acceptedAnswers} onChange={(event) => setRiddleDraft((current) => ({ ...current, acceptedAnswers: event.target.value }))} /></label><label><span>סף התאמה גמישה</span><input type="number" min="0.5" max="1" step="0.01" value={riddleDraft.fuzzyThreshold} onChange={(event) => setRiddleDraft((current) => ({ ...current, fuzzyThreshold: Number(event.target.value) }))} /></label></div>}</section>
              <section className={styles.formSection}><div className={styles.sectionTitleRow}><div><span className={styles.eyebrow}>Hints</span><h3>רמזים מדורגים</h3></div><button type="button" className={styles.quietButton} onClick={() => setRiddleDraft((current) => ({ ...current, hints: [...current.hints, { he: "", en: "", penalty: 10 }] }))}>＋ רמז</button></div><div className={styles.hintList}>{riddleDraft.hints.map((hint, index) => <div key={index} className={styles.hintRow}><span>{index + 1}</span><input placeholder="רמז בעברית" value={hint.he} onChange={(event) => setRiddleDraft((current) => ({ ...current, hints: current.hints.map((item, itemIndex) => itemIndex === index ? { ...item, he: event.target.value } : item) }))} /><input dir="ltr" placeholder="English hint" value={hint.en} onChange={(event) => setRiddleDraft((current) => ({ ...current, hints: current.hints.map((item, itemIndex) => itemIndex === index ? { ...item, en: event.target.value } : item) }))} /><input type="number" min="0" value={hint.penalty} onChange={(event) => setRiddleDraft((current) => ({ ...current, hints: current.hints.map((item, itemIndex) => itemIndex === index ? { ...item, penalty: Number(event.target.value) } : item) }))} /><button type="button" onClick={() => setRiddleDraft((current) => ({ ...current, hints: current.hints.filter((_, itemIndex) => itemIndex !== index) }))}>×</button></div>)}</div></section>
              <details className={styles.advancedSection}><summary>ניקוד, שאלת גיבוי ותגיות</summary><div className={styles.formGrid}><label><span>נקודות בסיס</span><input type="number" min="0" value={riddleDraft.basePoints} onChange={(event) => setRiddleDraft((current) => ({ ...current, basePoints: Number(event.target.value) }))} /></label><label><span>קנס טעות</span><input type="number" min="0" value={riddleDraft.wrongPenalty} onChange={(event) => setRiddleDraft((current) => ({ ...current, wrongPenalty: Number(event.target.value) }))} /></label><label><span>קנס רמז</span><input type="number" min="0" value={riddleDraft.hintPenalty} onChange={(event) => setRiddleDraft((current) => ({ ...current, hintPenalty: Number(event.target.value) }))} /></label><label><span>בונוס מהירות</span><input type="number" min="0" value={riddleDraft.speedBonusMax} onChange={(event) => setRiddleDraft((current) => ({ ...current, speedBonusMax: Number(event.target.value) }))} /></label><label><span>חלון בונוס בשניות</span><input type="number" min="1" value={riddleDraft.speedBonusWindowSeconds} onChange={(event) => setRiddleDraft((current) => ({ ...current, speedBonusWindowSeconds: Number(event.target.value) }))} /></label><label><span>תגיות</span><input value={riddleDraft.tags} onChange={(event) => setRiddleDraft((current) => ({ ...current, tags: event.target.value }))} /></label><label><span>שאלת גיבוי בעברית</span><input value={riddleDraft.fallbackHe} onChange={(event) => setRiddleDraft((current) => ({ ...current, fallbackHe: event.target.value }))} /></label><label><span>Fallback question</span><input value={riddleDraft.fallbackEn} onChange={(event) => setRiddleDraft((current) => ({ ...current, fallbackEn: event.target.value }))} /></label><label className={styles.fullField}><span>תשובות לשאלת הגיבוי</span><textarea value={riddleDraft.fallbackAccepted} onChange={(event) => setRiddleDraft((current) => ({ ...current, fallbackAccepted: event.target.value }))} /></label><label><span>סטטוס</span><select value={riddleDraft.status} onChange={(event) => setRiddleDraft((current) => ({ ...current, status: event.target.value }))}><option value="draft">טיוטה</option><option value="active">פעילה</option><option value="archived">ארכיון</option></select></label></div></details>
              <footer className={styles.drawerFooter}><div>{riddleDraft.id && <><button type="button" className={styles.quietButton} onClick={() => void duplicateRiddle()}>שכפול</button><button type="button" className={styles.textDanger} onClick={() => void deleteRiddle()}>מחיקה</button></>}</div><div><button type="button" className={styles.quietButton} onClick={() => setEditorOpen(false)}>ביטול</button><button type="submit" className={styles.primaryButton} disabled={busy === "save-riddle"}>{busy === "save-riddle" ? "שומר…" : "שמירת חידה"}</button></div></footer>
            </form>
          </aside>
        </div>
      )}

      {routeModalOpen && (
        <div className={styles.modalBackdrop} onMouseDown={() => setRouteModalOpen(false)}><form className={styles.modal} onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void createRoute(); }}><header><div><span className={styles.eyebrow}>New route</span><h2>מסלול חדש</h2><p>המסלול יתחיל כטיוטה ריקה. לאחר היצירה בוחרים תחנות וחידות מהספרייה.</p></div><button type="button" onClick={() => setRouteModalOpen(false)}>×</button></header><div className={styles.formGrid}><label><span>שם בעברית</span><input required value={newRoute.titleHe} onChange={(event) => setNewRoute((current) => ({ ...current, titleHe: event.target.value }))} /></label><label><span>English title</span><input value={newRoute.titleEn} onChange={(event) => setNewRoute((current) => ({ ...current, titleEn: event.target.value }))} /></label><label className={styles.fullField}><span>Slug</span><input required value={newRoute.slug} onChange={(event) => setNewRoute((current) => ({ ...current, slug: event.target.value }))} /></label><label><span>תיאור בעברית</span><textarea value={newRoute.descriptionHe} onChange={(event) => setNewRoute((current) => ({ ...current, descriptionHe: event.target.value }))} /></label><label><span>English description</span><textarea value={newRoute.descriptionEn} onChange={(event) => setNewRoute((current) => ({ ...current, descriptionEn: event.target.value }))} /></label></div><footer><button type="button" className={styles.quietButton} onClick={() => setRouteModalOpen(false)}>ביטול</button><button type="submit" className={styles.primaryButton} disabled={busy === "create-route"}>יצירת מסלול</button></footer></form></div>
      )}

      {previewOpen && previewStop && (
        <div
          className={styles.previewBackdrop}
          onMouseDown={() => setPreviewOpen(false)}
        >
          <section
            className={styles.previewWorkspace}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className={styles.previewHeader}>
              <div>
                <span className={styles.eyebrow}>Production player preview</span>
                <h2>תצוגת שחקן — ללא פתרונות</h2>
              </div>
              <div className={styles.previewActions}>
                <div className={styles.localeSwitch}>
                  <button
                    type="button"
                    className={previewLocale === "he" ? styles.selected : ""}
                    onClick={() => setPreviewLocale("he")}
                  >
                    עברית
                  </button>
                  <button
                    type="button"
                    className={previewLocale === "en" ? styles.selected : ""}
                    onClick={() => setPreviewLocale("en")}
                  >
                    English
                  </button>
                </div>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => setPreviewOpen(false)}
                >
                  ×
                </button>
              </div>
            </header>
            <div
              className={`quest-experience ${styles.playerPreview}`}
              dir={previewLocale === "he" ? "rtl" : "ltr"}
            >
              <div className="quest-ambient" />
              <header className="quest-experience-header">
                <div className="quest-team">
                  <img src="/visuals/quest-mark.svg" alt="" />
                  <div>
                    <strong>
                      {previewLocale === "he" ? "צוות תצוגה" : "Preview team"}
                    </strong>
                    <span>240 {previewLocale === "he" ? "נקודות" : "points"}</span>
                  </div>
                </div>
                <div className="quest-stage">
                  {previewIndex + 1}
                  <small>/ {previewStops.length}</small>
                </div>
              </header>
              <div className="quest-progress">
                <span
                  style={{
                    width: `${((previewIndex + 1) / previewStops.length) * 100}%`
                  }}
                />
              </div>
              <section
                className="mission-panel mission-arrive"
                key={`${previewLocale}-${previewStop.stop.id}`}
              >
                <div className="mission-index">
                  <span>
                    {previewLocale === "he" ? "תחנה" : "Checkpoint"}
                  </span>
                  <strong>{String(previewIndex + 1).padStart(2, "0")}</strong>
                </div>
                <div className="mission-copy">
                  <span className="quest-kicker">
                    {kindLabel(previewStop.riddle.kind)}
                  </span>
                  <h1>
                    {textValue(previewContent.title) ||
                      titleOf(previewStop.riddle.title, previewStop.riddle.slug)}
                  </h1>
                  <p className="mission-story">
                    {textValue(previewContent.story)}
                  </p>
                  {textValue(previewContent.locationHint) && (
                    <div className="mission-location">
                      <span>⌖</span>
                      <p>{textValue(previewContent.locationHint)}</p>
                    </div>
                  )}
                  <div className="mission-divider" />
                  <h2>{textValue(previewContent.prompt)}</h2>
                  {previewStop.riddle.kind === "choice" ? (
                    <div className="mission-form">
                      {previewOptions.map((option) => (
                        <button
                          type="button"
                          className="button button-secondary"
                          key={option}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  ) : previewStop.riddle.kind === "photo" ? (
                    <div className="photo-drop">
                      <span>＋</span>
                      <strong>
                        {previewLocale === "he"
                          ? "צילום או בחירת תמונה"
                          : "Take or choose a photo"}
                      </strong>
                    </div>
                  ) : (
                    <div className="mission-form">
                      <label>
                        <span>
                          {previewLocale === "he" ? "המפתח שלכם" : "Your key"}
                        </span>
                        <input disabled placeholder="••••••" />
                      </label>
                      <button
                        type="button"
                        className="button quest-gold-button"
                        disabled
                      >
                        {previewLocale === "he"
                          ? "פתיחת התחנה"
                          : "Unlock checkpoint"}
                      </button>
                    </div>
                  )}
                </div>
              </section>
            </div>
            <footer className={styles.previewFooter}>
              <button
                type="button"
                className={styles.quietButton}
                disabled={previewIndex === 0}
                onClick={() => setPreviewIndex((index) => Math.max(0, index - 1))}
              >
                הקודמת
              </button>
              <span>
                {previewIndex + 1} / {previewStops.length}
              </span>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={previewIndex === previewStops.length - 1}
                onClick={() =>
                  setPreviewIndex((index) =>
                    Math.min(previewStops.length - 1, index + 1)
                  )
                }
              >
                הבאה
              </button>
            </footer>
          </section>
        </div>
      )}

      {importOpen && selectedRoute && selectedVersion && (
        <div
          className={styles.modalBackdrop}
          onMouseDown={() => setImportOpen(false)}
        >
          <section
            className={`${styles.modal} ${styles.bulkModal}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className={styles.eyebrow}>Transactional bulk import</span>
                <h2>ייבוא CSV / JSON</h2>
                <p>
                  בדיקה יבשה מציגה שגיאות לפי שורה. החלה מתבצעת בעסקה אחת,
                  ניתנת להפעלה חוזרת ללא כפילויות וכוללת נקודת חזרה.
                </p>
              </div>
              <button type="button" onClick={() => setImportOpen(false)}>
                ×
              </button>
            </header>

            <div className={styles.importToolbar}>
              <input
                ref={importFileRef}
                type="file"
                accept=".csv,.json,text/csv,application/json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void selectImportFile(file);
                }}
              />
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => importFileRef.current?.click()}
              >
                בחירת קובץ
              </button>
              <button
                type="button"
                className={styles.quietButton}
                onClick={downloadImportTemplate}
              >
                הורדת תבנית CSV
              </button>
              <select
                value={importFormat}
                onChange={(event) =>
                  setImportFormat(event.target.value === "json" ? "json" : "csv")
                }
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
            </div>
            <label className={styles.importSource}>
              <span>תוכן הקובץ</span>
              <textarea
                dir="ltr"
                value={importContent}
                onChange={(event) => {
                  setImportContent(event.target.value);
                  setImportKey(`content-import:${crypto.randomUUID()}`);
                  setImportResult(null);
                }}
                placeholder="Paste CSV or a JSON array here…"
              />
            </label>
            <div className={styles.importActions}>
              <button
                type="button"
                className={styles.quietButton}
                disabled={!importContent.trim() || busy === "import-dry-run"}
                onClick={() => void runBulkImport(true)}
              >
                {busy === "import-dry-run" ? "בודק…" : "בדיקה יבשה"}
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={
                  !importContent.trim() ||
                  !importResult?.ok ||
                  !importResult.dryRun ||
                  busy === "import-apply"
                }
                onClick={() => void runBulkImport(false)}
              >
                {busy === "import-apply" ? "מחיל…" : "החלה אטומית"}
              </button>
            </div>

            {importResult && (
              <section
                className={
                  importResult.ok ? styles.importSuccess : styles.importErrors
                }
              >
                <strong>
                  {importResult.ok
                    ? `✓ ${importResult.rowCount} שורות תקינות`
                    : `${importResult.errors.length} שגיאות נמצאו`}
                </strong>
                {importResult.errors.map((item, index) => (
                  <div key={`${item.code}-${item.row}-${index}`}>
                    <span>{item.row ? `שורה ${item.row}` : "קובץ"}</span>
                    <code>{item.field}</code>
                    <p>{item.message}</p>
                  </div>
                ))}
              </section>
            )}

            <section className={styles.importHistory}>
              <h3>היסטוריית ייבוא לגרסה</h3>
              {importBatches.map((batch) => (
                <div key={batch.id}>
                  <span>
                    <strong>
                      {batch.row_count} שורות · {batch.format.toUpperCase()}
                    </strong>
                    <small>
                      {new Date(batch.created_at).toLocaleString("he-IL")} ·{" "}
                      {batch.status}
                    </small>
                  </span>
                  {batch.status === "applied" && (
                    <button
                      type="button"
                      className={styles.textDanger}
                      disabled={busy === "import-rollback"}
                      onClick={() => void rollbackImport(batch)}
                    >
                      ביטול ייבוא
                    </button>
                  )}
                </div>
              ))}
              {!importBatches.length && <p>אין עדיין ייבואים בגרסה הזו.</p>}
            </section>
          </section>
        </div>
      )}

      {routeSettingsOpen && selectedRoute && detail && (
        <div className={styles.drawerBackdrop} onMouseDown={() => setRouteSettingsOpen(false)}><aside className={styles.drawer} onMouseDown={(event) => event.stopPropagation()}><header className={styles.drawerHeader}><div><span className={styles.eyebrow}>Route settings</span><h2>הגדרות מסלול וגרסה</h2></div><button type="button" onClick={() => setRouteSettingsOpen(false)}>×</button></header><div className={styles.editorForm}><section className={styles.formSection}><div><h3>זהות המסלול</h3></div><div className={styles.formGrid}><label><span>שם בעברית</span><input value={routeTitleHe} onChange={(event) => setRouteTitleHe(event.target.value)} /></label><label><span>English title</span><input value={routeTitleEn} onChange={(event) => setRouteTitleEn(event.target.value)} /></label><label className={styles.fullField}><span>Slug</span><input value={routeSlug} onChange={(event) => setRouteSlug(event.target.value)} /></label><label><span>תיאור בעברית</span><textarea value={routeDescriptionHe} onChange={(event) => setRouteDescriptionHe(event.target.value)} /></label><label><span>English description</span><textarea value={routeDescriptionEn} onChange={(event) => setRouteDescriptionEn(event.target.value)} /></label></div></section><section className={styles.formSection}><div><h3>גרסה v{detail.version.version}</h3></div><div className={styles.formGrid}><label><span>שם גרסה</span><input disabled={!editable} value={releaseName} onChange={(event) => setReleaseName(event.target.value)} /></label><label><span>שלב עבודה</span><select disabled={!editable} value={routeStatus} onChange={(event) => setRouteStatus(event.target.value === "review" ? "review" : "draft")}><option value="draft">טיוטה</option><option value="review">מוכנה לבדיקה</option></select></label><label className={styles.fullField}><span>הערות גרסה</span><textarea disabled={!editable} value={releaseNotes} onChange={(event) => setReleaseNotes(event.target.value)} /></label></div></section><details className={styles.advancedSection}><summary>הגדרות מתקדמות</summary><div className={styles.formGrid}><label className={styles.fullField}><span>Theme JSON</span><textarea className={styles.codeInput} disabled={!editable} value={themeJson} onChange={(event) => setThemeJson(event.target.value)} /></label><label className={styles.fullField}><span>Route config JSON</span><textarea className={styles.codeInput} disabled={!editable} value={routeConfigJson} onChange={(event) => setRouteConfigJson(event.target.value)} /></label></div></details><footer className={styles.drawerFooter}><div>{selectedVersionSummary?.canDelete && <button type="button" className={styles.textDanger} onClick={() => void deleteVersion()}>מחיקת גרסה</button>}</div><div><button type="button" className={styles.quietButton} onClick={() => setRouteSettingsOpen(false)}>ביטול</button><button type="button" className={styles.primaryButton} disabled={!editable || busy === "route-settings"} onClick={() => void saveRouteSettings()}>שמירה</button></div></footer></div></aside></div>
      )}
    </main>
  );
}
