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
import { getBrowserClient } from "@/lib/supabase/browser";
import styles from "./ContentMapStudio.module.css";

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

type Station = {
  id: string;
  slug: string;
  title: Localized;
  description: Localized;
  address: Localized;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  hero_image_url: string | null;
  tags: string[];
  accessibility: Record<string, unknown>;
  field_verification_required: boolean;
  health_status: string;
  health_notes: string | null;
  status: string;
  updated_at: string;
};

type Riddle = {
  id: string;
  station_id: string;
  slug: string;
  title: Localized;
  kind: string;
  status: string;
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
};

type LibraryPayload = {
  stations: Station[];
  riddles: Riddle[];
  routeStops: RouteStop[];
};

type StationDraft = {
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
  status: string;
  healthStatus: string;
  healthNotes: string;
};

type LngLat = { lng: number; lat: number };
type Bounds = {
  extend(point: [number, number]): Bounds;
  isEmpty(): boolean;
};
type GeoJsonSource = { setData(data: GeoJsonFeatureCollection): void };
type MapInstance = {
  on(event: string, handler: (event: unknown) => void): void;
  remove(): void;
  addControl(control: unknown, position?: string): void;
  addSource(id: string, source: Record<string, unknown>): void;
  getSource(id: string): GeoJsonSource | undefined;
  addLayer(layer: Record<string, unknown>): void;
  getLayer(id: string): unknown;
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

type GeoJsonFeature = {
  type: "Feature";
  geometry: {
    type: "LineString" | "Polygon";
    coordinates: number[][] | number[][][];
  };
  properties: Record<string, unknown>;
};
type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

declare global {
  interface Window {
    maplibregl?: MapLibreNamespace;
  }
}

const TEL_AVIV_PORT_CENTER: [number, number] = [34.77515, 32.1003];
const MAPLIBRE_VERSION = "5.24.0";
const MAPLIBRE_SCRIPT_ID = "tlv-maplibre-script";
const MAPLIBRE_STYLE_ID = "tlv-maplibre-style";
const EMPTY_FEATURES: GeoJsonFeatureCollection = {
  type: "FeatureCollection",
  features: []
};

let mapLibrePromise: Promise<MapLibreNamespace> | null = null;

function loadMapLibre(): Promise<MapLibreNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Map is available in the browser only"));
  }
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
    if (!existing) {
      script.id = MAPLIBRE_SCRIPT_ID;
      script.src = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
      script.async = true;
      document.head.appendChild(script);
    }

    const complete = () => {
      if (window.maplibregl) resolve(window.maplibregl);
      else reject(new Error("MapLibre failed to initialize"));
    };

    if (window.maplibregl) complete();
    else {
      script.addEventListener("load", complete, { once: true });
      script.addEventListener(
        "error",
        () => reject(new Error("Map library could not be loaded")),
        { once: true }
      );
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

function titleOf(value: Localized | undefined, fallback: string): string {
  return value?.he?.trim() || value?.en?.trim() || fallback;
}

function numberOrNull(value: string): number | null {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : null;
}

function stationToDraft(station: Station): StationDraft {
  return {
    titleHe: station.title.he ?? "",
    titleEn: station.title.en ?? "",
    descriptionHe: station.description.he ?? "",
    descriptionEn: station.description.en ?? "",
    addressHe: station.address.he ?? "",
    addressEn: station.address.en ?? "",
    latitude: station.latitude === null ? "" : String(station.latitude),
    longitude: station.longitude === null ? "" : String(station.longitude),
    radiusMeters: station.radius_meters === null ? "60" : String(station.radius_meters),
    tags: station.tags.join(", "),
    status: station.status,
    healthStatus: station.health_status,
    healthNotes: station.health_notes ?? ""
  };
}

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

function routeFeature(stops: RouteStop[], stationsById: Map<string, Station>): GeoJsonFeatureCollection {
  const coordinates = stops
    .map((stop) => stationsById.get(stop.station_id))
    .filter((station): station is Station => Boolean(station && station.latitude !== null && station.longitude !== null))
    .map((station) => [station.longitude as number, station.latitude as number]);

  if (coordinates.length < 2) return EMPTY_FEATURES;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates }
      }
    ]
  };
}

function radiusFeature(station: Station | null, radiusMeters: number): GeoJsonFeatureCollection {
  if (!station || station.latitude === null || station.longitude === null || radiusMeters <= 0) {
    return EMPTY_FEATURES;
  }

  const points = 72;
  const earthRadius = 6_378_137;
  const latRadians = (station.latitude * Math.PI) / 180;
  const coordinates: number[][] = [];
  for (let index = 0; index <= points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const north = Math.cos(angle) * radiusMeters;
    const east = Math.sin(angle) * radiusMeters;
    const latitude = station.latitude + (north / earthRadius) * (180 / Math.PI);
    const longitude =
      station.longitude +
      (east / (earthRadius * Math.cos(latRadians))) * (180 / Math.PI);
    coordinates.push([longitude, latitude]);
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [coordinates] }
      }
    ]
  };
}

function distanceMeters(first: Station, second: Station): number | null {
  if (
    first.latitude === null ||
    first.longitude === null ||
    second.latitude === null ||
    second.longitude === null
  ) return null;

  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const deltaLat = toRadians(second.latitude - first.latitude);
  const deltaLng = toRadians(second.longitude - first.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(first.latitude)) *
      Math.cos(toRadians(second.latitude)) *
      Math.sin(deltaLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(distance: number | null): string {
  if (distance === null) return "—";
  if (distance < 1000) return `${Math.round(distance)} מ׳`;
  return `${(distance / 1000).toFixed(1)} ק״מ`;
}

export function ContentMapStudio() {
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
  const [search, setSearch] = useState("");
  const [routeOnly, setRouteOnly] = useState(false);
  const [placementMode, setPlacementMode] = useState(false);
  const [draggedStopId, setDraggedStopId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [mapReady, setMapReady] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const mapLibreRef = useRef<MapLibreNamespace | null>(null);
  const markerRefs = useRef<Map<string, MarkerInstance>>(new Map());
  const selectedStationIdRef = useRef("");
  const placementModeRef = useRef(false);

  useEffect(() => {
    selectedStationIdRef.current = selectedStationId;
  }, [selectedStationId]);
  useEffect(() => {
    placementModeRef.current = placementMode;
  }, [placementMode]);

  const selectedRoute = useMemo(
    () => catalog.find((route) => route.id === selectedTemplateId) ?? null,
    [catalog, selectedTemplateId]
  );
  const activeStops = useMemo(
    () => routeStops
      .filter((stop) => stop.template_id === selectedTemplateId && stop.version === selectedVersion)
      .sort((left, right) => left.sequence_no - right.sequence_no),
    [routeStops, selectedTemplateId, selectedVersion]
  );
  const stationsById = useMemo(
    () => new Map(stations.map((station) => [station.id, station])),
    [stations]
  );
  const riddlesByStation = useMemo(() => {
    const grouped = new Map<string, Riddle[]>();
    riddles.forEach((riddle) => {
      grouped.set(riddle.station_id, [...(grouped.get(riddle.station_id) ?? []), riddle]);
    });
    return grouped;
  }, [riddles]);
  const routeStopByStation = useMemo(
    () => new Map(activeStops.map((stop, index) => [stop.station_id, { stop, index }])),
    [activeStops]
  );
  const selectedStation = useMemo(
    () => stations.find((station) => station.id === selectedStationId) ?? null,
    [selectedStationId, stations]
  );
  const visibleStations = useMemo(() => {
    const query = search.trim().toLowerCase();
    const routeStationIds = new Set(activeStops.map((stop) => stop.station_id));
    return stations.filter((station) => {
      if (routeOnly && !routeStationIds.has(station.id)) return false;
      if (!query) return true;
      return [
        station.slug,
        titleOf(station.title, ""),
        station.address.he ?? "",
        station.tags.join(" ")
      ].join(" ").toLowerCase().includes(query);
    });
  }, [activeStops, routeOnly, search, stations]);
  const routeDistance = useMemo(() => {
    let total = 0;
    for (let index = 1; index < activeStops.length; index += 1) {
      const first = stationsById.get(activeStops[index - 1].station_id);
      const second = stationsById.get(activeStops[index].station_id);
      if (first && second) total += distanceMeters(first, second) ?? 0;
    }
    return total;
  }, [activeStops, stationsById]);

  const loadAll = useCallback(async (accessToken = token) => {
    if (!accessToken) return;
    const [nextCatalog, library] = await Promise.all([
      requestJson<RouteTemplate[]>("/api/admin/content/templates", accessToken),
      requestJson<LibraryPayload>("/api/admin/content/library", accessToken)
    ]);
    setCatalog(nextCatalog);
    setStations(library.stations);
    setRiddles(library.riddles);
    setRouteStops(library.routeStops);

    const route = nextCatalog.find((item) => item.id === selectedTemplateId) ?? nextCatalog[0];
    if (route) {
      const version =
        route.versions.find((item) => item.version === selectedVersion) ??
        route.versions.find((item) => item.isActiveVersion) ??
        route.versions[0];
      setSelectedTemplateId(route.id);
      setSelectedVersion(version?.version ?? null);
    }
  }, [selectedTemplateId, selectedVersion, token]);

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
    void loadAll(token).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    });
  }, [loadAll, token]);

  useEffect(() => {
    if (!selectedStation) {
      setStationDraft(null);
      return;
    }
    setStationDraft(stationToDraft(selectedStation));
  }, [selectedStation]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    let cancelled = false;

    void loadMapLibre().then((maplibre) => {
      if (cancelled || !mapContainerRef.current) return;
      mapLibreRef.current = maplibre;
      const map = new maplibre.Map({
        container: mapContainerRef.current,
        style: mapStyle(),
        center: TEL_AVIV_PORT_CENTER,
        zoom: 15.6,
        minZoom: 12,
        maxZoom: 19,
        attributionControl: false
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: true }), "top-left");
      map.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-left");
      map.on("load", () => {
        map.addSource("route-line", { type: "geojson", data: EMPTY_FEATURES });
        map.addLayer({
          id: "route-line-shadow",
          type: "line",
          source: "route-line",
          paint: {
            "line-color": "#06141f",
            "line-width": 9,
            "line-opacity": 0.45,
            "line-blur": 1
          }
        });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route-line",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#ffb13b",
            "line-width": 5,
            "line-opacity": 0.95
          }
        });
        map.addSource("station-radius", { type: "geojson", data: EMPTY_FEATURES });
        map.addLayer({
          id: "station-radius-fill",
          type: "fill",
          source: "station-radius",
          paint: { "fill-color": "#0cb7aa", "fill-opacity": 0.13 }
        });
        map.addLayer({
          id: "station-radius-outline",
          type: "line",
          source: "station-radius",
          paint: { "line-color": "#0cb7aa", "line-width": 2, "line-dasharray": [2, 2] }
        });
        setMapReady(true);
      });
      map.on("click", (rawEvent) => {
        if (!placementModeRef.current || !selectedStationIdRef.current) return;
        const event = rawEvent as { lngLat?: LngLat };
        if (!event.lngLat) return;
        setStationDraft((current) => current ? {
          ...current,
          latitude: event.lngLat?.lat.toFixed(7) ?? current.latitude,
          longitude: event.lngLat?.lng.toFixed(7) ?? current.longitude
        } : current);
      });
      mapRef.current = map;
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Map unavailable");
    });

    return () => {
      cancelled = true;
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.getSource("route-line")?.setData(routeFeature(activeStops, stationsById));
  }, [activeStops, mapReady, stationsById]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const radius = stationDraft ? numberOrNull(stationDraft.radiusMeters) ?? 0 : 0;
    const virtualStation = selectedStation && stationDraft
      ? {
          ...selectedStation,
          latitude: numberOrNull(stationDraft.latitude),
          longitude: numberOrNull(stationDraft.longitude)
        }
      : selectedStation;
    map.getSource("station-radius")?.setData(radiusFeature(virtualStation, radius));
  }, [mapReady, selectedStation, stationDraft]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibre = mapLibreRef.current;
    if (!map || !maplibre || !mapReady) return;

    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current.clear();

    visibleStations.forEach((station) => {
      if (station.latitude === null || station.longitude === null) return;
      const routePosition = routeStopByStation.get(station.id);
      const selected = station.id === selectedStationId;
      const element = document.createElement("button");
      element.type = "button";
      element.className = `${styles.mapMarker} ${routePosition ? styles.routeMarker : ""} ${selected ? styles.selectedMarker : ""}`;
      element.setAttribute("aria-label", titleOf(station.title, station.slug));
      element.innerHTML = routePosition
        ? `<span>${routePosition.index + 1}</span>`
        : `<span>•</span>`;
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        setSelectedStationId(station.id);
      });

      const marker = new maplibre.Marker({
        element,
        anchor: "bottom",
        draggable: selected
      })
        .setLngLat([station.longitude, station.latitude])
        .addTo(map);

      if (selected) {
        marker.on("drag", () => {
          const point = marker.getLngLat();
          setStationDraft((current) => current ? {
            ...current,
            latitude: point.lat.toFixed(7),
            longitude: point.lng.toFixed(7)
          } : current);
        });
      }
      markerRefs.current.set(station.id, marker);
    });
  }, [mapReady, routeStopByStation, selectedStationId, visibleStations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = placementMode ? "crosshair" : "grab";
  }, [placementMode]);

  useEffect(() => {
    if (!stationDraft || !selectedStationId) return;
    const latitude = numberOrNull(stationDraft.latitude);
    const longitude = numberOrNull(stationDraft.longitude);
    if (latitude === null || longitude === null) return;
    markerRefs.current.get(selectedStationId)?.setLngLat([longitude, latitude]);
  }, [selectedStationId, stationDraft?.latitude, stationDraft?.longitude]);

  async function runOperation(name: string, action: () => Promise<void>) {
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

  function selectStation(station: Station, fly = true) {
    setSelectedStationId(station.id);
    if (fly && station.latitude !== null && station.longitude !== null) {
      mapRef.current?.flyTo({
        center: [station.longitude, station.latitude],
        zoom: 17.3,
        duration: 700
      });
    }
  }

  function fitRoute() {
    const map = mapRef.current;
    const maplibre = mapLibreRef.current;
    if (!map || !maplibre) return;
    const bounds = new maplibre.LngLatBounds();
    activeStops.forEach((stop) => {
      const station = stationsById.get(stop.station_id);
      if (station && station.latitude !== null && station.longitude !== null) {
        bounds.extend([station.longitude, station.latitude]);
      }
    });
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 90, duration: 700, maxZoom: 17.3 });
  }

  async function saveStation(event: FormEvent) {
    event.preventDefault();
    if (!selectedStation || !stationDraft) return;
    await runOperation("save-station", async () => {
      const saved = await requestJson<Station>(
        `/api/admin/content/stations/${selectedStation.id}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: { he: stationDraft.titleHe, en: stationDraft.titleEn },
            description: { he: stationDraft.descriptionHe, en: stationDraft.descriptionEn },
            address: { he: stationDraft.addressHe, en: stationDraft.addressEn },
            latitude: numberOrNull(stationDraft.latitude),
            longitude: numberOrNull(stationDraft.longitude),
            radiusMeters: numberOrNull(stationDraft.radiusMeters),
            tags: stationDraft.tags.split(",").map((item) => item.trim()).filter(Boolean),
            status: stationDraft.status,
            healthStatus: stationDraft.healthStatus,
            healthNotes: stationDraft.healthNotes
          })
        }
      );
      setStations((current) => current.map((station) => station.id === saved.id ? saved : station));
      setStationDraft(stationToDraft(saved));
      setPlacementMode(false);
      setMessage("התחנה נשמרה והמסלולים שמשתמשים בה עודכנו.");
    });
  }

  async function reorderStops(ids: string[]) {
    if (!selectedTemplateId || selectedVersion === null) return;
    const previous = routeStops;
    const byId = new Map(activeStops.map((stop) => [stop.id, stop]));
    setRouteStops((current) => [
      ...current.filter((stop) => !byId.has(stop.id)),
      ...ids.map((id, index) => ({ ...byId.get(id)!, sequence_no: index + 1 }))
    ]);

    try {
      await requestJson(
        `/api/admin/content/templates/${selectedTemplateId}/versions/${selectedVersion}/stops`,
        token,
        { method: "PATCH", body: JSON.stringify({ stopIds: ids }) }
      );
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
    if (!draggedStopId || draggedStopId === targetId) {
      setDraggedStopId("");
      return;
    }
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

  if (!authChecked) {
    return <main className={styles.shell}><div className={styles.centerState}>טוען את סביבת המפה…</div></main>;
  }

  if (!token) {
    return (
      <main className={styles.shell}>
        <section className={styles.loginCard}>
          <div className={styles.logo}>Q</div>
          <span>Protected workspace</span>
          <h1>נדרשת כניסת מנהל</h1>
          <p>התחבר באמצעות Magic Link כדי לערוך תחנות, מיקומים ומסלולים.</p>
          <Link href="/admin" className={styles.primaryButton}>מעבר לכניסה</Link>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.logo}>Q</div>
          <div><strong>TLV Quest Map Studio</strong><span>מפת תוכן ותפעול</span></div>
        </div>
        <div className={styles.topActions}>
          <span className={styles.cloudState}>{busy ? "שומר שינויים…" : "מחובר ל‑Supabase"}</span>
          <Link href="/admin/content/library" className={styles.secondaryButton}>סטודיו תוכן מלא</Link>
          <Link href="/admin" className={styles.iconLink} aria-label="ניהול מערכת">⋯</Link>
        </div>
      </header>

      <section className={styles.summaryBar}>
        <div>
          <span className={styles.eyebrow}>Map-first content operations</span>
          <h1>כל התחנות והמסלולים, על מפה אחת.</h1>
        </div>
        <div className={styles.metrics}>
          <div><strong>{stations.length}</strong><span>תחנות</span></div>
          <div><strong>{activeStops.length}</strong><span>במסלול</span></div>
          <div><strong>{riddles.length}</strong><span>חידות</span></div>
          <div><strong>{formatDistance(routeDistance)}</strong><span>קו אווירי</span></div>
        </div>
      </section>

      <section className={styles.toolbar}>
        <label>
          <span>מסלול</span>
          <select
            value={selectedTemplateId}
            onChange={(event) => {
              const route = catalog.find((item) => item.id === event.target.value);
              const version = route?.versions.find((item) => item.isActiveVersion) ?? route?.versions[0];
              setSelectedTemplateId(event.target.value);
              setSelectedVersion(version?.version ?? null);
            }}
          >
            {catalog.map((route) => <option key={route.id} value={route.id}>{titleOf(route.title, route.slug)}</option>)}
          </select>
        </label>
        <label>
          <span>גרסה</span>
          <select
            value={selectedVersion ?? ""}
            onChange={(event) => setSelectedVersion(Number(event.target.value))}
          >
            {selectedRoute?.versions.map((version) => (
              <option key={version.version} value={version.version}>
                v{version.version} · {version.release_name || version.status}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.toolbarActions}>
          <label className={styles.switch}>
            <input type="checkbox" checked={routeOnly} onChange={(event) => setRouteOnly(event.target.checked)} />
            <span />רק תחנות המסלול
          </label>
          <button type="button" className={styles.secondaryButton} onClick={fitRoute}>התאמת מפה למסלול</button>
          <button type="button" className={styles.secondaryButton} onClick={() => void loadAll(token)} disabled={busy !== ""}>רענון</button>
        </div>
      </section>

      {message && <div className={styles.successBanner}>✓ {message}</div>}
      {error && <div className={styles.errorBanner}>{error}</div>}

      <section className={styles.workspace}>
        <div className={styles.mapPanel}>
          <div ref={mapContainerRef} className={styles.map} />
          {!mapReady && <div className={styles.mapLoading}>טוען מפה מקצועית…</div>}
          <div className={styles.mapLegend}>
            <span><i className={styles.legendRoute} /> תחנה במסלול</span>
            <span><i className={styles.legendLibrary} /> תחנה בספרייה</span>
            <span><i className={styles.legendSelected} /> תחנה נבחרת</span>
          </div>
          <div className={styles.mapHint}>
            {placementMode ? "לחץ על המפה או גרור את הסמן למיקום המדויק" : "בחר תחנה כדי לערוך את המיקום והרדיוס"}
          </div>
        </div>

        <aside className={styles.sidebar}>
          <div className={styles.sidebarTabs}>
            <button type="button" className={styles.activeSidebarTab}>תחנות</button>
            <Link href="/admin/content/library">חידות ותוכן</Link>
          </div>

          <div className={styles.searchBox}>
            <span>⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="חיפוש תחנה, כתובת או תגית…" />
          </div>

          <div className={styles.stationList}>
            {visibleStations.map((station) => {
              const routePosition = routeStopByStation.get(station.id);
              return (
                <button
                  type="button"
                  key={station.id}
                  className={`${styles.stationRow} ${selectedStationId === station.id ? styles.stationRowSelected : ""}`}
                  onClick={() => selectStation(station)}
                >
                  <span className={styles.stationThumb}>
                    {station.hero_image_url ? <img src={station.hero_image_url} alt="" /> : "⌖"}
                  </span>
                  <span className={styles.stationRowText}>
                    <strong>{titleOf(station.title, station.slug)}</strong>
                    <small>{station.address.he || station.slug}</small>
                  </span>
                  <span className={routePosition ? styles.sequenceBadge : styles.healthBadge}>
                    {routePosition ? routePosition.index + 1 : station.health_status === "verified" ? "✓" : "!"}
                  </span>
                </button>
              );
            })}
            {!visibleStations.length && <div className={styles.emptyList}>לא נמצאו תחנות.</div>}
          </div>

          {selectedStation && stationDraft ? (
            <form className={styles.stationEditor} onSubmit={saveStation}>
              <header className={styles.editorHeader}>
                <div>
                  <span className={styles.eyebrow}>Station inspector</span>
                  <h2>{titleOf(selectedStation.title, selectedStation.slug)}</h2>
                  <p>{riddlesByStation.get(selectedStation.id)?.length ?? 0} חידות · {selectedStation.slug}</p>
                </div>
                <button type="button" onClick={() => setSelectedStationId("")} aria-label="סגירה">×</button>
              </header>

              <div className={styles.editorScroll}>
                <section className={styles.formSection}>
                  <h3>תוכן בסיסי</h3>
                  <label><span>שם בעברית</span><input required value={stationDraft.titleHe} onChange={(event) => setStationDraft({ ...stationDraft, titleHe: event.target.value })} /></label>
                  <label><span>תיאור קצר</span><textarea rows={3} value={stationDraft.descriptionHe} onChange={(event) => setStationDraft({ ...stationDraft, descriptionHe: event.target.value })} /></label>
                  <label><span>כתובת / נקודת זיהוי</span><input value={stationDraft.addressHe} onChange={(event) => setStationDraft({ ...stationDraft, addressHe: event.target.value })} /></label>
                  <label><span>תגיות</span><input value={stationDraft.tags} onChange={(event) => setStationDraft({ ...stationDraft, tags: event.target.value })} placeholder="נמל, היסטוריה, צילום" /></label>
                </section>

                <section className={styles.formSection}>
                  <div className={styles.sectionTitleRow}>
                    <h3>מיקום מדויק</h3>
                    <button type="button" className={placementMode ? styles.placementActive : styles.textButton} onClick={() => setPlacementMode((current) => !current)}>
                      {placementMode ? "מצב הצבה פעיל" : "הצבה על המפה"}
                    </button>
                  </div>
                  <div className={styles.coordinateGrid}>
                    <label><span>Latitude</span><input inputMode="decimal" value={stationDraft.latitude} onChange={(event) => setStationDraft({ ...stationDraft, latitude: event.target.value })} /></label>
                    <label><span>Longitude</span><input inputMode="decimal" value={stationDraft.longitude} onChange={(event) => setStationDraft({ ...stationDraft, longitude: event.target.value })} /></label>
                  </div>
                  <label><span>רדיוס הפעלה במטרים</span><input type="number" min="5" max="1000" value={stationDraft.radiusMeters} onChange={(event) => setStationDraft({ ...stationDraft, radiusMeters: event.target.value })} /></label>
                  <p className={styles.fieldNote}>העיגול הטורקיז במפה מציג את רדיוס ההפעלה בפועל.</p>
                </section>

                <section className={styles.formSection}>
                  <h3>מצב ואימות</h3>
                  <div className={styles.coordinateGrid}>
                    <label><span>סטטוס תוכן</span><select value={stationDraft.status} onChange={(event) => setStationDraft({ ...stationDraft, status: event.target.value })}><option value="draft">טיוטה</option><option value="active">פעילה</option><option value="archived">ארכיון</option></select></label>
                    <label><span>בדיקת שטח</span><select value={stationDraft.healthStatus} onChange={(event) => setStationDraft({ ...stationDraft, healthStatus: event.target.value })}><option value="not_required">לא נדרש</option><option value="pending">ממתין לבדיקה</option><option value="verified">מאומת</option><option value="needs_attention">דורש טיפול</option><option value="blocked">חסום</option></select></label>
                  </div>
                  <label><span>הערות שטח</span><textarea rows={3} value={stationDraft.healthNotes} onChange={(event) => setStationDraft({ ...stationDraft, healthNotes: event.target.value })} /></label>
                </section>

                <section className={styles.formSection}>
                  <div className={styles.sectionTitleRow}><h3>החידות בתחנה</h3><Link href="/admin/content/library">ניהול מלא</Link></div>
                  <div className={styles.riddleList}>
                    {(riddlesByStation.get(selectedStation.id) ?? []).map((riddle) => (
                      <div key={riddle.id}><strong>{titleOf(riddle.title, riddle.slug)}</strong><span>{riddle.kind} · {riddle.status}</span></div>
                    ))}
                    {!(riddlesByStation.get(selectedStation.id)?.length) && <p>עדיין אין חידות לתחנה הזאת.</p>}
                  </div>
                </section>
              </div>

              <footer className={styles.editorFooter}>
                <span>{selectedStation.updated_at ? `עודכן ${new Date(selectedStation.updated_at).toLocaleDateString("he-IL")}` : ""}</span>
                <button className={styles.primaryButton} disabled={busy === "save-station"}>{busy === "save-station" ? "שומר…" : "שמירת התחנה"}</button>
              </footer>
            </form>
          ) : (
            <section className={styles.routeOrder}>
              <div className={styles.routeOrderHeader}>
                <div><span className={styles.eyebrow}>Route order</span><h2>סדר התחנות</h2></div>
                <span>{activeStops.length}</span>
              </div>
              <p>גרור תחנה כדי לשנות את הסדר. הקו במפה מתעדכן מיד.</p>
              <div className={styles.stopList}>
                {activeStops.map((stop, index) => {
                  const station = stationsById.get(stop.station_id);
                  const nextStation = index < activeStops.length - 1 ? stationsById.get(activeStops[index + 1].station_id) : null;
                  if (!station) return null;
                  return (
                    <article
                      key={stop.id}
                      draggable
                      className={`${styles.stopRow} ${draggedStopId === stop.id ? styles.dragging : ""}`}
                      onDragStart={() => setDraggedStopId(stop.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => dropStop(stop.id)}
                      onDragEnd={() => setDraggedStopId("")}
                    >
                      <button type="button" className={styles.stopMain} onClick={() => selectStation(station)}>
                        <span>{index + 1}</span>
                        <div><strong>{titleOf(station.title, station.slug)}</strong><small>{nextStation ? `${formatDistance(distanceMeters(station, nextStation))} לתחנה הבאה` : "תחנת סיום"}</small></div>
                      </button>
                      <div className={styles.stopButtons}>
                        <button type="button" onClick={() => moveStop(stop.id, -1)} disabled={index === 0}>↑</button>
                        <button type="button" onClick={() => moveStop(stop.id, 1)} disabled={index === activeStops.length - 1}>↓</button>
                      </div>
                    </article>
                  );
                })}
                {!activeStops.length && <div className={styles.emptyList}>המסלול עדיין ריק. הוסף תחנות בסטודיו המלא.</div>}
              </div>
              <Link href="/admin/content/library" className={styles.fullWidthButton}>הוספת תחנות וחידות למסלול</Link>
            </section>
          )}
        </aside>
      </section>
    </main>
  );
}
