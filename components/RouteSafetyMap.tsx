"use client";

import { useMemo } from "react";
import { analyzeRoute, type RouteStation } from "@/lib/route-planning";

type Station = {
  id: string;
  slug: string;
  title: { he?: string; en?: string };
  latitude: number | null;
  longitude: number | null;
  tags: string[];
  accessibility: Record<string, unknown>;
  field_verification_required: boolean;
  health_status: string;
};

type Stop = {
  id: string;
  station_id: string;
  sequence_no: number;
  is_active: boolean;
};

const titleOf = (station: Station) =>
  station.title.he || station.title.en || station.slug;

export function RouteSafetyMap({
  stops,
  stations,
  wheelchairRequired = false
}: {
  stops: Stop[];
  stations: Station[];
  wheelchairRequired?: boolean;
}) {
  const route = useMemo(
    () =>
      stops
        .filter((stop) => stop.is_active)
        .sort((left, right) => left.sequence_no - right.sequence_no)
        .map((stop) => stations.find((station) => station.id === stop.station_id))
        .filter(
          (station): station is Station =>
            Boolean(
              station &&
                station.latitude !== null &&
                station.longitude !== null
            )
        ),
    [stations, stops]
  );
  const analysis = useMemo(
    () =>
      analyzeRoute(
        route.map(
          (station): RouteStation => ({
            id: station.id,
            slug: station.slug,
            title: station.title,
            latitude: station.latitude as number,
            longitude: station.longitude as number,
            tags: station.tags,
            accessibility: station.accessibility,
            fieldVerificationRequired: station.field_verification_required,
            healthStatus: station.health_status
          })
        ),
        { wheelchairRequired }
      ),
    [route, wheelchairRequired]
  );

  if (!route.length) {
    return (
      <section className="route-safety-panel">
        <p>הוסיפו תחנות עם קואורדינטות כדי לראות מרחקים ובדיקות בטיחות.</p>
      </section>
    );
  }

  const latitudes = route.map((station) => station.latitude as number);
  const longitudes = route.map((station) => station.longitude as number);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const latitudeSpan = Math.max(0.0001, maxLatitude - minLatitude);
  const longitudeSpan = Math.max(0.0001, maxLongitude - minLongitude);
  const points = route.map((station, index) => ({
    station,
    index,
    x:
      34 +
      (((station.longitude as number) - minLongitude) / longitudeSpan) * 532,
    y:
      266 -
      (((station.latitude as number) - minLatitude) / latitudeSpan) * 232
  }));

  return (
    <section className="route-safety-panel">
      <header>
        <div>
          <span>SAFETY-AWARE ROUTE MAP</span>
          <h3>מרחק, זמן הליכה וסיכוני מסלול</h3>
        </div>
        <div className="route-safety-stats">
          <strong>{(analysis.totalDistanceMeters / 1000).toFixed(1)} ק״מ</strong>
          <strong>{analysis.walkingMinutes} דק׳ הליכה</strong>
          <strong>{analysis.estimatedExperienceMinutes} דק׳ משוערות</strong>
        </div>
      </header>
      <svg
        className="route-safety-map"
        viewBox="0 0 600 300"
        role="img"
        aria-label="Route coordinate map"
      >
        <defs>
          <linearGradient id="route-line" x1="0" x2="1">
            <stop offset="0" stopColor="#9c632b" />
            <stop offset="1" stopColor="#f4d68d" />
          </linearGradient>
        </defs>
        <rect width="600" height="300" rx="18" fill="#07111c" />
        <g opacity=".14" stroke="#f3eee3">
          {[50, 100, 150, 200, 250].map((y) => (
            <line key={`y-${y}`} x1="0" x2="600" y1={y} y2={y} />
          ))}
          {[100, 200, 300, 400, 500].map((x) => (
            <line key={`x-${x}`} x1={x} x2={x} y1="0" y2="300" />
          ))}
        </g>
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke="url(#route-line)"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        {points.map((point) => (
          <g key={point.station.id}>
            <circle
              cx={point.x}
              cy={point.y}
              r="14"
              fill={
                point.station.health_status === "verified"
                  ? "#7ed5a5"
                  : "#f4d68d"
              }
              stroke="#07111c"
              strokeWidth="4"
            />
            <text
              x={point.x}
              y={point.y + 4}
              textAnchor="middle"
              fill="#07111c"
              fontSize="11"
              fontWeight="800"
            >
              {point.index + 1}
            </text>
            <title>
              {point.index + 1}. {titleOf(point.station)}
            </title>
          </g>
        ))}
      </svg>
      <div className={`route-safety-verdict ${analysis.safe ? "safe" : "review"}`}>
        <strong>{analysis.safe ? "✓ המסלול עבר בדיקה אוטומטית" : "נדרשת בדיקה אנושית"}</strong>
        <span>
          {analysis.flags.length
            ? analysis.flags.join(" · ")
            : "לא נמצאו מקטעים ארוכים, תחנות חסומות או אימותי שטח חסרים."}
        </span>
      </div>
      <div className="route-segment-list">
        {analysis.segments.map((segment, index) => (
          <div key={`${segment.fromId}-${segment.toId}`}>
            <span>
              {index + 1} → {index + 2}
            </span>
            <strong>{segment.distanceMeters} מ׳</strong>
            <small>{segment.walkingMinutes} דק׳ הליכה</small>
            <small>{segment.flags.join(", ") || "תקין"}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
