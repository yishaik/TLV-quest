"use client";

import Link from "next/link";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import styles from "./UnifiedContentStudio.module.css";

type Localized = { he?: string; en?: string };
type VersionSummary = {
  version: number;
  status: string;
  release_name: string | null;
  checkpointCount: number;
  isActiveVersion: boolean;
};
type RouteTemplate = {
  id: string;
  slug: string;
  title: Localized;
  description: Localized;
  active_version: number;
  is_active: boolean;
  versions: VersionSummary[];
};
type GalleryEntry = {
  path: string;
  url: string;
  verdict?: "accept" | "reject" | "reference";
  note?: string;
  capturedAt?: string;
  capturedBy?: string;
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
  health_notes: string | null;
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
type LibraryPayload = { stations: Station[]; riddles: Riddle[]; routeStops: RouteStop[] };
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
};
type RiddleDraft = {
  id: string;
  stationId: string;
  slug: string;
  titleHe: string;
  titleEn: string;
  kind: string;
  storyHe: string;
  promptHe: string;
  locationHintHe: string;
  successHe: string;
  acceptedAnswers: string;
  choiceOptions: string;
  acceptedOption: string;
  photoCriteria: string;
  hints: string;
  tags: string;
  status: string;
};
type EditorTab = "details" | "media" | "questions" | "route";
type MobilePane = "stations" | "map" | "editor";
type LngLat = { lng: number; lat: number };
type GeoJsonSource = { setData(data: GeoJsonFeatureCollection): void };
type Bounds = { extend(point: [number, number]): Bounds; isEmpty(): boolean };
type MapInstance = {
  on(event: string, handler: (event: unknown) => void): void;
  remove(): void;
  addControl(control: unknown, position?: string): void;
  addSource(id: string, source: Record<string, unknown>): void;
  getSource(id: string): GeoJsonSource | undefined;
  addLayer(layer: Record<string, unknown>): void;
  fitBounds(bounds: Bounds, options?: Record<string, unknown>): void;
  flyTo(options: Record<string, unknown>): void;
  resize(): void;
  getCanvas(): HTMLCanvasElement;
};
type MarkerInstance = {
  setLngLat(point: [number, number]): MarkerInstance;
  addTo(map: MapInstance): MarkerInstance;
  getLngLat(): LngLat;
  on(event: string, handler: () => void): MarkerInstance;
  remove(): void;
};
type MapLibreNamespace = {
  Map: new (options: Record<string, unknown>) => MapInstance;
  Marker: new (options?: Record<string, unknown>) => MarkerInstance;
  NavigationControl: new (options?: Record<string, unknown>) => unknown;
  AttributionControl: new (options?: Record<string, unknown>) => unknown;
  LngLatBounds: new () => Bounds;
};
type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: { type: "LineString" | "Polygon"; coordinates: number[][] | number[][][] };
  }>;
};

declare global {
  interface Window { maplibregl?: MapLibreNamespace }
}

const MAPLIBRE_VERSION = "5.24.0";
const MAPLIBRE_SCRIPT_ID = "tlv-maplibre-script";
const MAPLIBRE_STYLE_ID = "tlv-maplibre-style";
const TEL_AVIV_PORT_CENTER: [number, number] = [34.77515, 32.1003];
const EMPTY_GEOJSON: GeoJsonFeatureCollection = { type: "FeatureCollection", features: [] };
const riddleKinds = [
  ["text", "תשובת טקסט"],
  ["choice", "בחירה"],
  ["location", "מיקום + תשובה"],
  ["photo", "משימת צילום"],
  ["scan", "סריקה"],
  ["hybrid", "משולבת"],
  ["finale", "סיום"]
] as const;

let mapLibrePromise: Promise<MapLibreNamespace> | null = null;

function loadMapLibre(): Promise<MapLibreNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("המפה זמינה בדפדפן בלבד"));
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (mapLibrePromise) return mapLibrePromise;

  mapLibrePromise = new Promise((resolve, reject) => {
    if (!document.getElementById(MAPLIBRE_STYLE_ID)) {
      const link = document.createElement("link");
      link.id = MAPLIBRE_STYLE_ID;
      link.rel = "stylesheet";
      link.href = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
      document.head.appendChild(link);
    }

    const existing = document.getElementById(MAPLIBRE_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const finish = () => window.maplibregl
      ? resolve(window.maplibregl)
      : reject(new Error("MapLibre נטען אך לא אותחל"));

    if (!existing) {
      script.id = MAPLIBRE_SCRIPT_ID;
      script.src = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
      script.async = true;
      script.crossOrigin = "anonymous";
      document.head.appendChild(script);
    }

    if (window.maplibregl) finish();
    else {
      script.addEventListener("load", finish, { once: true });
      script.addEventListener("error", () => {
        mapLibrePromise = null;
        script.remove();
        reject(new Error("לא ניתן לטעון את ספריית המפה מה־CDN"));
      }, { once: true });
    }
  });

  return mapLibrePromise;
}

function mapStyle(): Record<string, unknown> {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "© OpenStreetMap contributors"
      }
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }]
  };
}

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const textValue = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const titleOf = (value: Localized | undefined, fallback: string) => value?.he?.trim() || value?.en?.trim() || fallback;
const lines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
const numberOrNull = (value: string) => {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : null;
};
const galleryEntries = (value: unknown): GalleryEntry[] => Array.isArray(value)
  ? value.filter((item): item is GalleryEntry => Boolean(item && typeof item === "object" && typeof (item as GalleryEntry).path === "string" && typeof (item as GalleryEntry).url === "string"))
  : [];

function stationToDraft(station: Station): StationDraft {
  return {
    id: station.id,
    slug: station.slug,
    titleHe: station.title.he ?? "",
    titleEn: station.title.en ?? "",
    descriptionHe: station.description.he ?? "",
    descriptionEn: station.description.en ?? "",
    addressHe: station.address.he ?? "",
    addressEn: station.address.en ?? "",
    latitude: station.latitude === null ? "" : String(station.latitude),
    longitude: station.longitude === null ? "" : String(station.longitude),
    radiusMeters: station.radius_meters === null ? "100" : String(station.radius_meters),
    tags: station.tags.join(", "),
    wheelchair: station.accessibility.wheelchair !== false,
    stroller: station.accessibility.stroller !== false,
    fieldRequired: station.field_verification_required,
    healthStatus: station.health_status,
    healthNotes: station.health_notes ?? "",
    status: station.status
  };
}

function emptyStation(): StationDraft {
  return {
    id: "", slug: "", titleHe: "", titleEn: "", descriptionHe: "", descriptionEn: "",
    addressHe: "", addressEn: "", latitude: "", longitude: "", radiusMeters: "100",
    tags: "", wheelchair: true, stroller: true, fieldRequired: false,
    healthStatus: "not_required", healthNotes: "", status: "draft"
  };
}

function riddleToDraft(riddle: Riddle): RiddleDraft {
  const he = objectValue(riddle.content.he);
  const validation = objectValue(riddle.validation);
  return {
    id: riddle.id,
    stationId: riddle.station_id,
    slug: riddle.slug,
    titleHe: riddle.title.he ?? "",
    titleEn: riddle.title.en ?? "",
    kind: riddle.kind,
    storyHe: textValue(he.story),
    promptHe: textValue(he.prompt),
    locationHintHe: textValue(he.locationHint),
    successHe: textValue(he.success),
    acceptedAnswers: Array.isArray(validation.accepted) ? validation.accepted.filter((item): item is string => typeof item === "string").join("\n") : "",
    choiceOptions: Array.isArray(validation.options) ? validation.options.filter((item): item is string => typeof item === "string").join("\n") : "",
    acceptedOption: textValue(validation.acceptedOption),
    photoCriteria: textValue(validation.criteria),
    hints: Array.isArray(riddle.hints) ? riddle.hints.map((raw) => textValue(objectValue(raw).he)).filter(Boolean).join("\n") : "",
    tags: riddle.tags.join(", "),
    status: riddle.status
  };
}

function emptyRiddle(stationId: string): RiddleDraft {
  return {
    id: "", stationId, slug: "", titleHe: "", titleEn: "", kind: "text",
    storyHe: "", promptHe: "", locationHintHe: "", successHe: "",
    acceptedAnswers: "", choiceOptions: "", acceptedOption: "", photoCriteria: "",
    hints: "", tags: "", status: "draft"
  };
}

async function requestJson<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message ?? `הפעולה נכשלה (${response.status})`);
  }
  return payload.data as T;
}

function routeFeature(stops: RouteStop[], stationMap: Map<string, Station>, draft: StationDraft | null): GeoJsonFeatureCollection {
  const coordinates = stops.flatMap((stop) => {
    const station = stationMap.get(stop.station_id);
    if (!station) return [];
    const lat = draft?.id === station.id ? numberOrNull(draft.latitude) : station.latitude;
    const lng = draft?.id === station.id ? numberOrNull(draft.longitude) : station.longitude;
    return lat === null || lng === null ? [] : [[lng, lat]];
  });
  return coordinates.length < 2 ? EMPTY_GEOJSON : {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }]
  };
}

function radiusFeature(draft: StationDraft | null): GeoJsonFeatureCollection {
  if (!draft) return EMPTY_GEOJSON;
  const lat = numberOrNull(draft.latitude);
  const lng = numberOrNull(draft.longitude);
  const radius = numberOrNull(draft.radiusMeters) ?? 0;
  if (lat === null || lng === null || radius <= 0) return EMPTY_GEOJSON;
  const points = 72;
  const earthRadius = 6_378_137;
  const latRadians = lat * Math.PI / 180;
  const coordinates: number[][] = [];
  for (let index = 0; index <= points; index += 1) {
    const angle = index / points * Math.PI * 2;
    const north = Math.cos(angle) * radius;
    const east = Math.sin(angle) * radius;
    coordinates.push([
      lng + east / (earthRadius * Math.cos(latRadians)) * 180 / Math.PI,
      lat + north / earthRadius * 180 / Math.PI
    ]);
  }
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coordinates] } }]
  };
}

export function UnifiedContentStudio() {
  const [token, setToken] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [catalog, setCatalog] = useState<RouteTemplate[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [riddles, setRiddles] = useState<Riddle[]>([]);
  const [routeStops, setRouteStops] = useState<RouteStop[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [selectedStationId, setSelectedStationId] = useState("");
  const [stationDraft, setStationDraft] = useState<StationDraft | null>(null);
  const [riddleDraft, setRiddleDraft] = useState<RiddleDraft | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>("details");
  const [mobilePane, setMobilePane] = useState<MobilePane>("map");
  const [search, setSearch] = useState("");
  const [routeOnly, setRouteOnly] = useState(false);
  const [placementMode, setPlacementMode] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [mapAttempt, setMapAttempt] = useState(0);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const mapLibreRef = useRef<MapLibreNamespace | null>(null);
  const markerRefs = useRef<Map<string, MarkerInstance>>(new Map());
  const selectedStationIdRef = useRef("");
  const selectedTemplateIdRef = useRef("");
  const selectedVersionRef = useRef<number | null>(null);
  const placementModeRef = useRef(false);
  const heroInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { selectedStationIdRef.current = selectedStationId; }, [selectedStationId]);
  useEffect(() => { selectedTemplateIdRef.current = selectedTemplateId; }, [selectedTemplateId]);
  useEffect(() => { selectedVersionRef.current = selectedVersion; }, [selectedVersion]);
  useEffect(() => { placementModeRef.current = placementMode; }, [placementMode]);

  const selectedRoute = useMemo(() => catalog.find((item) => item.id === selectedTemplateId) ?? null, [catalog, selectedTemplateId]);
  const selectedVersionSummary = useMemo(() => selectedRoute?.versions.find((item) => item.version === selectedVersion) ?? null, [selectedRoute, selectedVersion]);
  const routeEditable = Boolean(selectedVersionSummary && ["draft", "review"].includes(selectedVersionSummary.status));
  const activeStops = useMemo(() => routeStops
    .filter((stop) => stop.template_id === selectedTemplateId && stop.version === selectedVersion)
    .sort((a, b) => a.sequence_no - b.sequence_no), [routeStops, selectedTemplateId, selectedVersion]);
  const stationsById = useMemo(() => new Map(stations.map((station) => [station.id, station])), [stations]);
  const selectedStation = useMemo(() => stations.find((station) => station.id === selectedStationId) ?? null, [stations, selectedStationId]);
  const riddlesByStation = useMemo(() => {
    const grouped = new Map<string, Riddle[]>();
    riddles.forEach((riddle) => grouped.set(riddle.station_id, [...(grouped.get(riddle.station_id) ?? []), riddle]));
    return grouped;
  }, [riddles]);
  const routeStopByStation = useMemo(() => new Map(activeStops.map((stop, index) => [stop.station_id, { stop, index }])), [activeStops]);
  const visibleStations = useMemo(() => {
    const query = search.trim().toLowerCase();
    const routeIds = new Set(activeStops.map((stop) => stop.station_id));
    return stations.filter((station) => {
      if (routeOnly && !routeIds.has(station.id)) return false;
      if (!query) return true;
      return [station.slug, titleOf(station.title, ""), station.address.he ?? "", station.tags.join(" ")]
        .join(" ").toLowerCase().includes(query);
    });
  }, [activeStops, routeOnly, search, stations]);

  const loadAll = useCallback(async (accessToken = token, preferredStationId?: string) => {
    if (!accessToken) return;
    const [routes, library] = await Promise.all([
      requestJson<RouteTemplate[]>("/api/admin/content/templates", accessToken),
      requestJson<LibraryPayload>("/api/admin/content/library", accessToken)
    ]);
    setCatalog(routes);
    setStations(library.stations);
    setRiddles(library.riddles);
    setRouteStops(library.routeStops);

    const route = routes.find((item) => item.id === selectedTemplateIdRef.current) ?? routes[0];
    if (route) {
      const version = route.versions.find((item) => item.version === selectedVersionRef.current)
        ?? route.versions.find((item) => item.isActiveVersion)
        ?? route.versions[0];
      setSelectedTemplateId(route.id);
      setSelectedVersion(version?.version ?? null);
    }

    const stationId = preferredStationId || selectedStationIdRef.current;
    const station = library.stations.find((item) => item.id === stationId);
    if (station) {
      setSelectedStationId(station.id);
      setStationDraft(stationToDraft(station));
    }
  }, [token]);

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
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadAll(token).catch((cause) => setError(cause instanceof Error ? cause.message : "טעינת התוכן נכשלה"));
  }, [loadAll, token]);

  useEffect(() => {
    if (!selectedStation) return;
    setStationDraft(stationToDraft(selectedStation));
    if (riddleDraft && riddleDraft.stationId !== selectedStation.id) setRiddleDraft(null);
  }, [selectedStation]);

  useEffect(() => {
    if (!token || !mapContainerRef.current || mapRef.current) return;
    let cancelled = false;
    setMapError("");
    setMapReady(false);

    const initialize = async () => {
      try {
        const maplibre = await loadMapLibre();
        if (cancelled || !mapContainerRef.current) return;
        mapLibreRef.current = maplibre;
        const map = new maplibre.Map({
          container: mapContainerRef.current,
          style: mapStyle(),
          center: TEL_AVIV_PORT_CENTER,
          zoom: 15.4,
          minZoom: 12,
          maxZoom: 19,
          attributionControl: false
        });
        map.addControl(new maplibre.NavigationControl({ showCompass: true }), "top-left");
        map.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-left");
        map.on("load", () => {
          map.addSource("route-line", { type: "geojson", data: EMPTY_GEOJSON });
          map.addLayer({ id: "route-shadow", type: "line", source: "route-line", paint: { "line-color": "#082235", "line-width": 9, "line-opacity": 0.35 } });
          map.addLayer({ id: "route-line", type: "line", source: "route-line", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ff9d33", "line-width": 5 } });
          map.addSource("station-radius", { type: "geojson", data: EMPTY_GEOJSON });
          map.addLayer({ id: "station-radius-fill", type: "fill", source: "station-radius", paint: { "fill-color": "#14b8a6", "fill-opacity": 0.14 } });
          map.addLayer({ id: "station-radius-line", type: "line", source: "station-radius", paint: { "line-color": "#0f9388", "line-width": 2, "line-dasharray": [2, 2] } });
          setMapReady(true);
          requestAnimationFrame(() => map.resize());
        });
        map.on("click", (raw) => {
          if (!placementModeRef.current || !selectedStationIdRef.current) return;
          const event = raw as { lngLat?: LngLat };
          if (!event.lngLat) return;
          setStationDraft((current) => current ? {
            ...current,
            latitude: event.lngLat!.lat.toFixed(7),
            longitude: event.lngLat!.lng.toFixed(7)
          } : current);
        });
        mapRef.current = map;
      } catch (cause) {
        setMapError(cause instanceof Error ? cause.message : "המפה לא נטענה");
      }
    };

    const frame = requestAnimationFrame(() => void initialize());
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [token, mapAttempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.getSource("route-line")?.setData(routeFeature(activeStops, stationsById, stationDraft));
    map.getSource("station-radius")?.setData(radiusFeature(stationDraft));
  }, [activeStops, mapReady, stationDraft, stationsById]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibre = mapLibreRef.current;
    if (!map || !maplibre || !mapReady) return;
    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current.clear();

    visibleStations.forEach((station) => {
      const lat = stationDraft?.id === station.id ? numberOrNull(stationDraft.latitude) : station.latitude;
      const lng = stationDraft?.id === station.id ? numberOrNull(stationDraft.longitude) : station.longitude;
      if (lat === null || lng === null) return;
      const routePosition = routeStopByStation.get(station.id);
      const selected = station.id === selectedStationId;
      const element = document.createElement("button");
      element.type = "button";
      element.className = `${styles.mapMarker} ${routePosition ? styles.routeMarker : ""} ${selected ? styles.selectedMarker : ""}`;
      element.textContent = routePosition ? String(routePosition.index + 1) : "•";
      element.setAttribute("aria-label", titleOf(station.title, station.slug));
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        openStation(station, false);
      });
      const marker = new maplibre.Marker({ element, anchor: "bottom", draggable: selected })
        .setLngLat([lng, lat]).addTo(map);
      if (selected) {
        marker.on("drag", () => {
          const point = marker.getLngLat();
          setStationDraft((current) => current ? { ...current, latitude: point.lat.toFixed(7), longitude: point.lng.toFixed(7) } : current);
        });
      }
      markerRefs.current.set(station.id, marker);
    });
  }, [mapReady, routeStopByStation, selectedStationId, stationDraft?.latitude, stationDraft?.longitude, visibleStations]);

  useEffect(() => {
    mapRef.current?.resize();
  }, [mobilePane]);

  async function operation(name: string, action: () => Promise<void>) {
    setBusy(name); setMessage(""); setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "הפעולה נכשלה"); }
    finally { setBusy(""); }
  }

  function openStation(station: Station, fly = true) {
    setSelectedStationId(station.id);
    setStationDraft(stationToDraft(station));
    setRiddleDraft(null);
    setEditorTab("details");
    setMobilePane("editor");
    if (fly && station.latitude !== null && station.longitude !== null) {
      mapRef.current?.flyTo({ center: [station.longitude, station.latitude], zoom: 17.2, duration: 650 });
    }
  }

  function createStation() {
    setSelectedStationId("");
    setStationDraft(emptyStation());
    setRiddleDraft(null);
    setEditorTab("details");
    setMobilePane("editor");
  }

  async function saveStation(event: FormEvent) {
    event.preventDefault();
    if (!stationDraft) return;
    await operation("save-station", async () => {
      const body = {
        slug: stationDraft.slug,
        title: { he: stationDraft.titleHe, en: stationDraft.titleEn },
        description: { he: stationDraft.descriptionHe, en: stationDraft.descriptionEn },
        address: { he: stationDraft.addressHe, en: stationDraft.addressEn },
        latitude: numberOrNull(stationDraft.latitude),
        longitude: numberOrNull(stationDraft.longitude),
        radiusMeters: numberOrNull(stationDraft.radiusMeters),
        tags: stationDraft.tags.split(",").map((item) => item.trim()).filter(Boolean),
        accessibility: { wheelchair: stationDraft.wheelchair, stroller: stationDraft.stroller },
        fieldVerificationRequired: stationDraft.fieldRequired,
        healthStatus: stationDraft.healthStatus,
        healthNotes: stationDraft.healthNotes,
        status: stationDraft.status
      };
      const saved = stationDraft.id
        ? await requestJson<Station>(`/api/admin/content/stations/${stationDraft.id}`, token, { method: "PATCH", body: JSON.stringify(body) })
        : await requestJson<Station>("/api/admin/content/stations", token, { method: "POST", body: JSON.stringify(body) });
      await loadAll(token, saved.id);
      setSelectedStationId(saved.id);
      setStationDraft(stationToDraft(saved));
      setPlacementMode(false);
      setMessage(stationDraft.id ? "התחנה נשמרה." : "התחנה נוצרה.");
    });
  }

  async function deleteStation() {
    if (!stationDraft?.id || !window.confirm("למחוק את התחנה לצמיתות?")) return;
    await operation("delete-station", async () => {
      await requestJson(`/api/admin/content/stations/${stationDraft.id}`, token, { method: "DELETE" });
      setSelectedStationId(""); setStationDraft(null); setRiddleDraft(null);
      await loadAll(token);
      setMobilePane("stations");
      setMessage("התחנה נמחקה.");
    });
  }

  async function uploadHero(file: File) {
    if (!stationDraft?.id) return setError("יש לשמור את התחנה לפני העלאת תמונה.");
    await operation("hero-image", async () => {
      const form = new FormData(); form.set("image", file);
      const saved = await requestJson<Station>(`/api/admin/content/stations/${stationDraft.id}/image`, token, { method: "POST", body: form });
      await loadAll(token, saved.id);
      setStationDraft(stationToDraft(saved));
      setMessage("התמונה הראשית הועלתה.");
    });
  }

  async function removeHero() {
    if (!stationDraft?.id) return;
    await operation("hero-image", async () => {
      const saved = await requestJson<Station>(`/api/admin/content/stations/${stationDraft.id}/image`, token, { method: "DELETE" });
      await loadAll(token, saved.id);
      setStationDraft(stationToDraft(saved));
      setMessage("התמונה הראשית הוסרה.");
    });
  }

  async function uploadGallery(file: File) {
    if (!stationDraft?.id) return setError("יש לשמור את התחנה לפני העלאת תמונות.");
    await operation("gallery-image", async () => {
      const grant = await requestJson<{ bucket: string; path: string; uploadToken: string }>(
        `/api/admin/content/stations/${stationDraft.id}/gallery/upload`, token,
        { method: "POST", body: JSON.stringify({ mimeType: file.type, size: file.size }) }
      );
      const supabase = getBrowserClient();
      const { error: uploadError } = await supabase.storage.from(grant.bucket)
        .uploadToSignedUrl(grant.path, grant.uploadToken, file, { contentType: file.type });
      if (uploadError) throw uploadError;
      await requestJson<Station>(`/api/admin/content/stations/${stationDraft.id}/gallery`, token, {
        method: "POST", body: JSON.stringify({ path: grant.path, verdict: "reference", note: "" })
      });
      await loadAll(token, stationDraft.id);
      setMessage("התמונה נוספה לגלריה.");
    });
  }

  async function removeGallery(path: string) {
    if (!stationDraft?.id || !window.confirm("להסיר את התמונה מהגלריה?")) return;
    await operation("gallery-image", async () => {
      await requestJson(`/api/admin/content/stations/${stationDraft.id}/gallery`, token, {
        method: "DELETE", body: JSON.stringify({ path })
      });
      await loadAll(token, stationDraft.id);
      setMessage("התמונה הוסרה מהגלריה.");
    });
  }

  function openRiddle(riddle?: Riddle) {
    if (!stationDraft?.id) return setError("יש לשמור את התחנה לפני יצירת שאלה.");
    setRiddleDraft(riddle ? riddleToDraft(riddle) : emptyRiddle(stationDraft.id));
    setEditorTab("questions");
  }

  function buildValidation(draft: RiddleDraft) {
    if (draft.kind === "choice") return { type: "choice", options: lines(draft.choiceOptions), acceptedOption: draft.acceptedOption.trim() };
    if (draft.kind === "photo") return { type: "photo", criteria: draft.photoCriteria.trim(), confidenceThreshold: 0.86 };
    if (draft.kind === "scan") return { type: "scan" };
    return { type: "text", accepted: lines(draft.acceptedAnswers), fuzzyThreshold: 0.94 };
  }

  async function saveRiddle(event: FormEvent) {
    event.preventDefault();
    if (!riddleDraft) return;
    await operation("save-riddle", async () => {
      const body = {
        stationId: riddleDraft.stationId,
        slug: riddleDraft.slug,
        title: { he: riddleDraft.titleHe, en: riddleDraft.titleEn },
        kind: riddleDraft.kind,
        content: {
          he: { title: riddleDraft.titleHe, story: riddleDraft.storyHe, prompt: riddleDraft.promptHe, locationHint: riddleDraft.locationHintHe, success: riddleDraft.successHe },
          en: { title: riddleDraft.titleEn, story: "", prompt: "", locationHint: "", success: "" }
        },
        validation: buildValidation(riddleDraft),
        hints: lines(riddleDraft.hints).map((hint) => ({ he: hint, en: "", penalty: 10 })),
        scoring: { basePoints: 100, wrongPenalty: 5, hintPenalty: 10, speedBonusMax: 20, speedBonusWindowSeconds: 420 },
        fallback: null,
        interaction: { primary: riddleDraft.kind === "photo" ? "photo" : "web", webFallback: true, requiresScan: ["scan", "hybrid"].includes(riddleDraft.kind) },
        tags: riddleDraft.tags.split(",").map((item) => item.trim()).filter(Boolean),
        status: riddleDraft.status
      };
      const saved = riddleDraft.id
        ? await requestJson<Riddle>(`/api/admin/content/riddles/${riddleDraft.id}`, token, { method: "PATCH", body: JSON.stringify(body) })
        : await requestJson<Riddle>("/api/admin/content/riddles", token, { method: "POST", body: JSON.stringify(body) });
      await loadAll(token, saved.station_id);
      setRiddleDraft(riddleToDraft(saved));
      setMessage(riddleDraft.id ? "השאלה נשמרה." : "השאלה נוספה לתחנה.");
    });
  }

  async function deleteRiddle() {
    if (!riddleDraft?.id || !window.confirm("למחוק את השאלה לצמיתות?")) return;
    await operation("delete-riddle", async () => {
      await requestJson(`/api/admin/content/riddles/${riddleDraft.id}`, token, { method: "DELETE" });
      setRiddleDraft(null);
      await loadAll(token, stationDraft?.id);
      setMessage("השאלה נמחקה.");
    });
  }

  async function reorderStops(ids: string[]) {
    if (!selectedTemplateId || selectedVersion === null || !routeEditable) return;
    const previous = routeStops;
    const activeIds = new Set(activeStops.map((stop) => stop.id));
    const byId = new Map(activeStops.map((stop) => [stop.id, stop]));
    setRouteStops([
      ...routeStops.filter((stop) => !activeIds.has(stop.id)),
      ...ids.map((id, index) => ({ ...byId.get(id)!, sequence_no: index + 1 }))
    ]);
    try {
      await requestJson(`/api/admin/content/templates/${selectedTemplateId}/versions/${selectedVersion}/stops`, token, {
        method: "PATCH", body: JSON.stringify({ stopIds: ids })
      });
      setMessage("סדר התחנות נשמר.");
    } catch (cause) {
      setRouteStops(previous);
      setError(cause instanceof Error ? cause.message : "שינוי הסדר נכשל");
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

  async function addSelectedToRoute() {
    if (!stationDraft?.id || !selectedTemplateId || selectedVersion === null || !routeEditable) return;
    const stationRiddles = riddlesByStation.get(stationDraft.id) ?? [];
    const riddle = stationRiddles.find((item) => item.status === "active") ?? stationRiddles[0];
    if (!riddle) return setError("יש ליצור לפחות שאלה אחת לפני הוספת התחנה למסלול.");
    await operation("add-stop", async () => {
      await requestJson(`/api/admin/content/templates/${selectedTemplateId}/versions/${selectedVersion}/stops`, token, {
        method: "POST",
        body: JSON.stringify({ stationId: stationDraft.id, riddleId: riddle.id, afterStopId: activeStops.at(-1)?.id ?? null })
      });
      await loadAll(token, stationDraft.id);
      setMessage("התחנה נוספה למסלול.");
    });
  }

  async function updateStopRiddle(stop: RouteStop, riddleId: string) {
    if (!routeEditable) return;
    await operation("route-question", async () => {
      await requestJson(`/api/admin/content/route-stops/${stop.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ riddleId, slug: stop.slug, isOptional: stop.is_optional, isActive: stop.is_active, overrides: stop.overrides })
      });
      await loadAll(token, stationDraft?.id);
      setMessage("השאלה שמחוברת לתחנה במסלול עודכנה.");
    });
  }

  async function removeStop(stop: RouteStop) {
    if (!routeEditable || !window.confirm("להסיר את התחנה מהמסלול?")) return;
    await operation("remove-stop", async () => {
      await requestJson(`/api/admin/content/route-stops/${stop.id}`, token, { method: "DELETE" });
      await loadAll(token, stationDraft?.id);
      setMessage("התחנה הוסרה מהמסלול.");
    });
  }

  function fitRoute() {
    const map = mapRef.current;
    const maplibre = mapLibreRef.current;
    if (!map || !maplibre) return;
    const bounds = new maplibre.LngLatBounds();
    activeStops.forEach((stop) => {
      const station = stationsById.get(stop.station_id);
      if (station?.latitude !== null && station?.longitude !== null) bounds.extend([station.longitude, station.latitude]);
    });
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 70, maxZoom: 17.3, duration: 650 });
  }

  function exportJson() {
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      routes: catalog.map((route) => ({ ...route, stops: routeStops.filter((stop) => stop.template_id === route.id) })),
      stations: stations.map((station) => ({
        ...station,
        questions: riddles.filter((riddle) => riddle.station_id === station.id),
        routeMemberships: routeStops.filter((stop) => stop.station_id === station.id).map((stop) => ({
          ...stop,
          route: catalog.find((route) => route.id === stop.template_id)?.slug ?? stop.template_id
        }))
      }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tlv-quest-content-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  if (!authChecked) return <main className={styles.shell}><div className={styles.centerState}>טוען את סביבת התוכן…</div></main>;
  if (!token) return (
    <main className={styles.shell}>
      <section className={styles.loginCard}>
        <div className={styles.logo}>Q</div><span>Protected workspace</span>
        <h1>נדרשת כניסת מנהל</h1>
        <p>התחבר באמצעות Magic Link כדי לנהל תחנות, שאלות, תמונות ומסלולים.</p>
        <Link href="/admin" className={styles.primaryButton}>מעבר לכניסה</Link>
      </section>
    </main>
  );

  const selectedGallery = galleryEntries(selectedStation?.gallery);
  const selectedRiddles = selectedStationId ? riddlesByStation.get(selectedStationId) ?? [] : [];
  const selectedStop = selectedStationId ? routeStopByStation.get(selectedStationId)?.stop ?? null : null;

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}><div className={styles.logo}>Q</div><div><strong>TLV Quest Studio</strong><span>תחנות, שאלות, תמונות ומסלולים</span></div></div>
        <div className={styles.topActions}>
          <span className={styles.cloudState}>{busy ? "שומר…" : "מחובר ל־Supabase"}</span>
          <button type="button" className={styles.secondaryButton} onClick={exportJson}>Export JSON</button>
          <Link href="/admin" className={styles.iconLink} aria-label="ניהול מערכת">⋯</Link>
        </div>
      </header>

      <section className={styles.hero}>
        <div><span className={styles.eyebrow}>Unified content operations</span><h1>כל התוכן, במקום אחד.</h1><p>בחר תחנה מהמפה או מהרשימה וערוך את כל הפרטים, התמונות והשאלות בלי לעבור בין ממשקים.</p></div>
        <div className={styles.metrics}>
          <div><strong>{stations.length}</strong><span>תחנות</span></div>
          <div><strong>{riddles.length}</strong><span>שאלות</span></div>
          <div><strong>{catalog.length}</strong><span>מסלולים</span></div>
        </div>
      </section>

      <section className={styles.toolbar}>
        <label><span>מסלול</span><select value={selectedTemplateId} onChange={(event) => {
          const route = catalog.find((item) => item.id === event.target.value);
          const version = route?.versions.find((item) => item.isActiveVersion) ?? route?.versions[0];
          setSelectedTemplateId(event.target.value); setSelectedVersion(version?.version ?? null);
        }}>{catalog.map((route) => <option key={route.id} value={route.id}>{titleOf(route.title, route.slug)}</option>)}</select></label>
        <label><span>גרסה</span><select value={selectedVersion ?? ""} onChange={(event) => setSelectedVersion(Number(event.target.value))}>{selectedRoute?.versions.map((version) => <option key={version.version} value={version.version}>v{version.version} · {version.release_name || version.status}</option>)}</select></label>
        <label className={styles.switch}><input type="checkbox" checked={routeOnly} onChange={(event) => setRouteOnly(event.target.checked)} /><span />רק תחנות המסלול</label>
        <button type="button" className={styles.secondaryButton} onClick={fitRoute}>התאם מפה למסלול</button>
        <button type="button" className={styles.secondaryButton} onClick={() => void loadAll(token)}>רענון</button>
      </section>

      {message && <div className={styles.successBanner}>✓ {message}</div>}
      {error && <div className={styles.errorBanner}>{error}</div>}

      <nav className={styles.mobileNav} aria-label="תצוגה במובייל">
        <button className={mobilePane === "stations" ? styles.mobileActive : ""} onClick={() => setMobilePane("stations")}>תחנות</button>
        <button className={mobilePane === "map" ? styles.mobileActive : ""} onClick={() => setMobilePane("map")}>מפה</button>
        <button className={mobilePane === "editor" ? styles.mobileActive : ""} onClick={() => setMobilePane("editor")}>עריכה</button>
      </nav>

      <section className={styles.workspace}>
        <aside className={`${styles.stationPanel} ${mobilePane === "stations" ? styles.mobileShown : styles.mobileHidden}`}>
          <div className={styles.panelHeader}><div><span className={styles.eyebrow}>Library</span><h2>תחנות</h2></div><button type="button" className={styles.primaryButton} onClick={createStation}>+ תחנה</button></div>
          <div className={styles.searchBox}><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="חיפוש תחנה, כתובת או תגית…" /></div>
          <div className={styles.stationList}>{visibleStations.map((station) => {
            const routePosition = routeStopByStation.get(station.id);
            return <button type="button" key={station.id} className={`${styles.stationRow} ${selectedStationId === station.id ? styles.stationRowSelected : ""}`} onClick={() => openStation(station)}>
              <span className={styles.stationThumb}>{station.hero_image_url ? <img src={station.hero_image_url} alt="" /> : "⌖"}</span>
              <span className={styles.stationText}><strong>{titleOf(station.title, station.slug)}</strong><small>{station.address.he || station.slug}</small><em>{riddlesByStation.get(station.id)?.length ?? 0} שאלות</em></span>
              <span className={routePosition ? styles.sequenceBadge : styles.healthBadge}>{routePosition ? routePosition.index + 1 : station.health_status === "verified" ? "✓" : "!"}</span>
            </button>;
          })}{!visibleStations.length && <div className={styles.emptyState}>לא נמצאו תחנות.</div>}</div>
        </aside>

        <section className={`${styles.mapPanel} ${mobilePane === "map" ? styles.mobileShown : styles.mobileHidden}`}>
          <div ref={mapContainerRef} className={styles.map} />
          {!mapReady && !mapError && <div className={styles.mapOverlay}>טוען מפה…</div>}
          {mapError && <div className={styles.mapOverlay}><strong>המפה לא נטענה</strong><span>{mapError}</span><button className={styles.primaryButton} onClick={() => { mapLibrePromise = null; setMapAttempt((value) => value + 1); }}>נסה שוב</button></div>}
          <div className={styles.mapHint}>{placementMode ? "לחץ במפה או גרור את הסמן למיקום המדויק" : "בחר תחנה כדי לערוך אותה"}</div>
          <div className={styles.mapLegend}><span><i className={styles.legendRoute} /> במסלול</span><span><i className={styles.legendLibrary} /> בספרייה</span><span><i className={styles.legendSelected} /> נבחרת</span></div>
        </section>

        <aside className={`${styles.editorPanel} ${mobilePane === "editor" ? styles.mobileShown : styles.mobileHidden}`}>
          {!stationDraft ? <div className={styles.editorEmpty}><span>⌖</span><h2>בחר תחנה</h2><p>כל הפרטים, התמונות והשאלות יופיעו כאן.</p><button className={styles.primaryButton} onClick={createStation}>יצירת תחנה חדשה</button></div> : <>
            <header className={styles.editorHeader}><div><span className={styles.eyebrow}>{stationDraft.id ? "Station editor" : "New station"}</span><h2>{stationDraft.titleHe || "תחנה חדשה"}</h2><p>{stationDraft.slug || "יש לשמור כדי להעלות תמונות ושאלות"}</p></div></header>
            <nav className={styles.editorTabs}>
              {([ ["details", "פרטים"], ["media", "תמונות"], ["questions", `שאלות (${selectedRiddles.length})`], ["route", "מסלול"] ] as Array<[EditorTab, string]>).map(([value, label]) => <button key={value} type="button" className={editorTab === value ? styles.activeEditorTab : ""} onClick={() => { setEditorTab(value); if (value !== "questions") setRiddleDraft(null); }}>{label}</button>)}
            </nav>

            {editorTab === "details" && <form className={styles.editorBody} onSubmit={saveStation}>
              <div className={styles.formGrid}>
                <label><span>Slug</span><input required value={stationDraft.slug} onChange={(event) => setStationDraft({ ...stationDraft, slug: event.target.value })} placeholder="reading-power-station" /></label>
                <label><span>סטטוס</span><select value={stationDraft.status} onChange={(event) => setStationDraft({ ...stationDraft, status: event.target.value })}><option value="draft">טיוטה</option><option value="active">פעילה</option><option value="archived">ארכיון</option></select></label>
              </div>
              <label><span>שם בעברית</span><input required value={stationDraft.titleHe} onChange={(event) => setStationDraft({ ...stationDraft, titleHe: event.target.value })} /></label>
              <label><span>שם באנגלית</span><input value={stationDraft.titleEn} onChange={(event) => setStationDraft({ ...stationDraft, titleEn: event.target.value })} /></label>
              <label><span>תיאור</span><textarea rows={4} value={stationDraft.descriptionHe} onChange={(event) => setStationDraft({ ...stationDraft, descriptionHe: event.target.value })} /></label>
              <label><span>כתובת / נקודת זיהוי</span><input value={stationDraft.addressHe} onChange={(event) => setStationDraft({ ...stationDraft, addressHe: event.target.value })} /></label>
              <label><span>תגיות</span><input value={stationDraft.tags} onChange={(event) => setStationDraft({ ...stationDraft, tags: event.target.value })} placeholder="נמל, היסטוריה, צילום" /></label>
              <div className={styles.sectionTitle}><h3>מיקום מדויק</h3><button type="button" className={placementMode ? styles.activePlacement : styles.textButton} onClick={() => { setPlacementMode((value) => !value); setMobilePane("map"); }}>{placementMode ? "מצב הצבה פעיל" : "הצבה במפה"}</button></div>
              <div className={styles.formGrid}>
                <label><span>Latitude</span><input inputMode="decimal" value={stationDraft.latitude} onChange={(event) => setStationDraft({ ...stationDraft, latitude: event.target.value })} /></label>
                <label><span>Longitude</span><input inputMode="decimal" value={stationDraft.longitude} onChange={(event) => setStationDraft({ ...stationDraft, longitude: event.target.value })} /></label>
              </div>
              <label><span>רדיוס הפעלה במטרים</span><input type="number" min="5" max="1000" value={stationDraft.radiusMeters} onChange={(event) => setStationDraft({ ...stationDraft, radiusMeters: event.target.value })} /></label>
              <div className={styles.checkGrid}><label><input type="checkbox" checked={stationDraft.wheelchair} onChange={(event) => setStationDraft({ ...stationDraft, wheelchair: event.target.checked })} />נגיש לכיסא גלגלים</label><label><input type="checkbox" checked={stationDraft.stroller} onChange={(event) => setStationDraft({ ...stationDraft, stroller: event.target.checked })} />נגיש לעגלה</label><label><input type="checkbox" checked={stationDraft.fieldRequired} onChange={(event) => setStationDraft({ ...stationDraft, fieldRequired: event.target.checked })} />דורש אימות שטח</label></div>
              {stationDraft.fieldRequired && <><label><span>מצב אימות</span><select value={stationDraft.healthStatus} onChange={(event) => setStationDraft({ ...stationDraft, healthStatus: event.target.value })}><option value="pending">ממתין</option><option value="verified">מאומת</option><option value="needs_attention">דורש טיפול</option><option value="blocked">חסום</option></select></label><label><span>הערות שטח</span><textarea rows={3} value={stationDraft.healthNotes} onChange={(event) => setStationDraft({ ...stationDraft, healthNotes: event.target.value })} /></label></>}
              <footer className={styles.editorFooter}><button type="submit" className={styles.primaryButton} disabled={busy !== ""}>{stationDraft.id ? "שמירת תחנה" : "יצירת תחנה"}</button>{stationDraft.id && <button type="button" className={styles.dangerButton} onClick={deleteStation}>מחיקה</button>}</footer>
            </form>}

            {editorTab === "media" && <div className={styles.editorBody}>
              {!stationDraft.id ? <div className={styles.inlineNotice}>שמור את התחנה כדי להעלות תמונות.</div> : <>
                <section className={styles.mediaSection}><div className={styles.sectionTitle}><div><h3>תמונה ראשית</h3><p>מוצגת בכרטיס התחנה ובחוויית השחקן.</p></div><div><button className={styles.primaryButton} onClick={() => heroInputRef.current?.click()}>העלאת תמונה</button>{selectedStation?.hero_image_url && <button className={styles.textButton} onClick={removeHero}>הסרה</button>}</div></div>
                  <input ref={heroInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void uploadHero(file); event.target.value = ""; }} />
                  <div className={styles.heroImage}>{selectedStation?.hero_image_url ? <img src={selectedStation.hero_image_url} alt="" /> : <span>אין תמונה ראשית</span>}</div>
                </section>
                <section className={styles.mediaSection}><div className={styles.sectionTitle}><div><h3>גלריית התחנה</h3><p>תמונות עזר, אימות שטח ורפרנסים.</p></div><button className={styles.secondaryButton} onClick={() => galleryInputRef.current?.click()}>+ תמונה</button></div>
                  <input ref={galleryInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void uploadGallery(file); event.target.value = ""; }} />
                  <div className={styles.galleryGrid}>{selectedGallery.map((entry) => <figure key={entry.path}><img src={entry.url} alt="" /><button type="button" onClick={() => void removeGallery(entry.path)}>×</button>{entry.note && <figcaption>{entry.note}</figcaption>}</figure>)}{!selectedGallery.length && <div className={styles.emptyState}>עדיין אין תמונות בגלריה.</div>}</div>
                </section>
              </>}
            </div>}

            {editorTab === "questions" && <div className={styles.editorBody}>
              {!stationDraft.id ? <div className={styles.inlineNotice}>שמור את התחנה כדי ליצור שאלות.</div> : !riddleDraft ? <>
                <div className={styles.sectionTitle}><div><h3>שאלות התחנה</h3><p>כל שאלה נשארת מחוברת לתחנה וניתן לבחור איזו מהן פעילה בכל מסלול.</p></div><button className={styles.primaryButton} onClick={() => openRiddle()}>+ שאלה</button></div>
                <div className={styles.questionList}>{selectedRiddles.map((riddle) => <button key={riddle.id} onClick={() => openRiddle(riddle)}><span className={styles.kindBadge}>{riddleKinds.find(([value]) => value === riddle.kind)?.[1] ?? riddle.kind}</span><strong>{titleOf(riddle.title, riddle.slug)}</strong><small>{riddle.status} · {riddle.slug}</small></button>)}{!selectedRiddles.length && <div className={styles.emptyState}>אין עדיין שאלות בתחנה הזו.</div>}</div>
              </> : <form onSubmit={saveRiddle} className={styles.questionForm}>
                <button type="button" className={styles.backButton} onClick={() => setRiddleDraft(null)}>← חזרה לשאלות</button>
                <div className={styles.formGrid}><label><span>Slug</span><input required value={riddleDraft.slug} onChange={(event) => setRiddleDraft({ ...riddleDraft, slug: event.target.value })} /></label><label><span>סוג</span><select value={riddleDraft.kind} onChange={(event) => setRiddleDraft({ ...riddleDraft, kind: event.target.value })}>{riddleKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
                <label><span>כותרת</span><input required value={riddleDraft.titleHe} onChange={(event) => setRiddleDraft({ ...riddleDraft, titleHe: event.target.value })} /></label>
                <label><span>סיפור / הקשר</span><textarea rows={3} value={riddleDraft.storyHe} onChange={(event) => setRiddleDraft({ ...riddleDraft, storyHe: event.target.value })} /></label>
                <label><span>השאלה או המשימה</span><textarea rows={4} required value={riddleDraft.promptHe} onChange={(event) => setRiddleDraft({ ...riddleDraft, promptHe: event.target.value })} /></label>
                <label><span>רמז מיקום</span><input value={riddleDraft.locationHintHe} onChange={(event) => setRiddleDraft({ ...riddleDraft, locationHintHe: event.target.value })} /></label>
                <label><span>הודעת הצלחה</span><textarea rows={2} value={riddleDraft.successHe} onChange={(event) => setRiddleDraft({ ...riddleDraft, successHe: event.target.value })} /></label>
                {riddleDraft.kind === "choice" ? <><label><span>אפשרויות — שורה לכל אפשרות</span><textarea rows={4} value={riddleDraft.choiceOptions} onChange={(event) => setRiddleDraft({ ...riddleDraft, choiceOptions: event.target.value })} /></label><label><span>האפשרות הנכונה</span><input value={riddleDraft.acceptedOption} onChange={(event) => setRiddleDraft({ ...riddleDraft, acceptedOption: event.target.value })} /></label></> : riddleDraft.kind === "photo" ? <label><span>קריטריונים לתמונה</span><textarea rows={4} value={riddleDraft.photoCriteria} onChange={(event) => setRiddleDraft({ ...riddleDraft, photoCriteria: event.target.value })} /></label> : <label><span>תשובות תקינות — שורה לכל תשובה</span><textarea rows={4} value={riddleDraft.acceptedAnswers} onChange={(event) => setRiddleDraft({ ...riddleDraft, acceptedAnswers: event.target.value })} /></label>}
                <label><span>רמזים — שורה לכל רמז</span><textarea rows={4} value={riddleDraft.hints} onChange={(event) => setRiddleDraft({ ...riddleDraft, hints: event.target.value })} /></label>
                <div className={styles.formGrid}><label><span>תגיות</span><input value={riddleDraft.tags} onChange={(event) => setRiddleDraft({ ...riddleDraft, tags: event.target.value })} /></label><label><span>סטטוס</span><select value={riddleDraft.status} onChange={(event) => setRiddleDraft({ ...riddleDraft, status: event.target.value })}><option value="draft">טיוטה</option><option value="active">פעילה</option><option value="archived">ארכיון</option></select></label></div>
                <footer className={styles.editorFooter}><button type="submit" className={styles.primaryButton}>שמירת שאלה</button>{riddleDraft.id && <button type="button" className={styles.dangerButton} onClick={deleteRiddle}>מחיקה</button>}</footer>
              </form>}
            </div>}

            {editorTab === "route" && <div className={styles.editorBody}>
              <div className={styles.routeSummary}><span>מסלול נבחר</span><strong>{selectedRoute ? titleOf(selectedRoute.title, selectedRoute.slug) : "—"}</strong><small>{selectedVersionSummary ? `v${selectedVersionSummary.version} · ${selectedVersionSummary.status}` : ""}</small></div>
              {!stationDraft.id ? <div className={styles.inlineNotice}>שמור את התחנה כדי לשייך אותה למסלול.</div> : selectedStop ? <section className={styles.routeStationCard}><div><span className={styles.sequenceBadge}>{routeStopByStation.get(stationDraft.id)?.index! + 1}</span><div><strong>התחנה נמצאת במסלול</strong><small>{selectedStop.slug}</small></div></div><label><span>השאלה שמופעלת במסלול</span><select value={selectedStop.riddle_id} disabled={!routeEditable} onChange={(event) => void updateStopRiddle(selectedStop, event.target.value)}>{selectedRiddles.map((riddle) => <option key={riddle.id} value={riddle.id}>{titleOf(riddle.title, riddle.slug)}</option>)}</select></label><button className={styles.dangerButton} disabled={!routeEditable} onClick={() => void removeStop(selectedStop)}>הסרה מהמסלול</button></section> : <div className={styles.inlineNotice}><p>התחנה אינה במסלול הנבחר.</p><button className={styles.primaryButton} disabled={!routeEditable} onClick={() => void addSelectedToRoute()}>הוספה למסלול</button></div>}
              <div className={styles.sectionTitle}><div><h3>סדר המסלול</h3><p>שינוי הסדר מתעדכן מיד במפה.</p></div></div>
              <div className={styles.stopList}>{activeStops.map((stop, index) => { const station = stationsById.get(stop.station_id); return <div key={stop.id} className={`${styles.stopRow} ${stop.station_id === stationDraft.id ? styles.stopRowSelected : ""}`}><button className={styles.stopMain} onClick={() => station && openStation(station)}><span>{index + 1}</span><div><strong>{station ? titleOf(station.title, station.slug) : stop.slug}</strong><small>{riddles.find((riddle) => riddle.id === stop.riddle_id)?.title.he || "ללא שאלה"}</small></div></button><div className={styles.stopButtons}><button disabled={!routeEditable || index === 0} onClick={() => moveStop(stop.id, -1)}>↑</button><button disabled={!routeEditable || index === activeStops.length - 1} onClick={() => moveStop(stop.id, 1)}>↓</button></div></div>; })}</div>
            </div>}
          </>}
        </aside>
      </section>
    </main>
  );
}
