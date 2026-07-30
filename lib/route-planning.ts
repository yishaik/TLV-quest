export type RouteCoordinate = {
  latitude: number;
  longitude: number;
};

export type RouteStation = RouteCoordinate & {
  id: string;
  slug: string;
  title: { he?: string; en?: string };
  tags: string[];
  healthStatus: string;
  fieldVerificationRequired: boolean;
  accessibility: Record<string, unknown>;
};

export type RouteSegment = {
  fromId: string;
  toId: string;
  distanceMeters: number;
  walkingMinutes: number;
  flags: string[];
};

const toRadians = (value: number) => (value * Math.PI) / 180;

export const routeDistanceMeters = (
  from: RouteCoordinate,
  to: RouteCoordinate
) => {
  const earthRadius = 6_371_000;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const originLatitude = toRadians(from.latitude);
  const destinationLatitude = toRadians(to.latitude);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(
    earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
  );
};

export const pointInPolygon = (
  point: RouteCoordinate,
  polygon: RouteCoordinate[]
) => {
  if (polygon.length < 3) return false;
  let inside = false;
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current++
  ) {
    const currentPoint = polygon[current];
    const previousPoint = polygon[previous];
    const crosses =
      currentPoint.latitude > point.latitude !==
        previousPoint.latitude > point.latitude &&
      point.longitude <
        ((previousPoint.longitude - currentPoint.longitude) *
          (point.latitude - currentPoint.latitude)) /
          (previousPoint.latitude - currentPoint.latitude) +
          currentPoint.longitude;
    if (crosses) inside = !inside;
  }
  return inside;
};

export const analyzeRoute = (
  stations: RouteStation[],
  {
    walkingSpeedMetersPerSecond = 1.25,
    wheelchairRequired = false
  }: {
    walkingSpeedMetersPerSecond?: number;
    wheelchairRequired?: boolean;
  } = {}
) => {
  const segments: RouteSegment[] = [];
  const routeFlags = new Set<string>();
  for (const station of stations) {
    if (
      station.fieldVerificationRequired &&
      station.healthStatus !== "verified"
    ) {
      routeFlags.add(`field_verification:${station.slug}`);
    }
    if (station.healthStatus === "blocked") {
      routeFlags.add(`blocked_station:${station.slug}`);
    }
    if (
      wheelchairRequired &&
      station.accessibility.wheelchair !== true
    ) {
      routeFlags.add(`wheelchair_unverified:${station.slug}`);
    }
  }
  for (let index = 1; index < stations.length; index += 1) {
    const from = stations[index - 1];
    const to = stations[index];
    const distanceMeters = routeDistanceMeters(from, to);
    const flags: string[] = [];
    if (distanceMeters > 1200) flags.push("long_segment");
    if (distanceMeters < 20) flags.push("duplicate_or_too_close");
    flags.forEach((flag) =>
      routeFlags.add(`${flag}:${from.slug}:${to.slug}`)
    );
    segments.push({
      fromId: from.id,
      toId: to.id,
      distanceMeters,
      walkingMinutes: Math.max(
        1,
        Math.ceil(distanceMeters / walkingSpeedMetersPerSecond / 60)
      ),
      flags
    });
  }
  return {
    segments,
    totalDistanceMeters: segments.reduce(
      (total, segment) => total + segment.distanceMeters,
      0
    ),
    walkingMinutes: segments.reduce(
      (total, segment) => total + segment.walkingMinutes,
      0
    ),
    estimatedExperienceMinutes:
      segments.reduce((total, segment) => total + segment.walkingMinutes, 0) +
      stations.length * 8,
    flags: [...routeFlags],
    safe: routeFlags.size === 0
  };
};

export const nearestNeighborOrder = (
  stations: RouteStation[],
  start: RouteCoordinate
) => {
  const remaining = [...stations];
  const ordered: RouteStation[] = [];
  let cursor = start;
  while (remaining.length) {
    remaining.sort(
      (left, right) =>
        routeDistanceMeters(cursor, left) - routeDistanceMeters(cursor, right)
    );
    const next = remaining.shift();
    if (!next) break;
    ordered.push(next);
    cursor = next;
  }
  return ordered;
};

export const polygonCenter = (
  polygon: RouteCoordinate[]
): RouteCoordinate => ({
  latitude:
    polygon.reduce((sum, point) => sum + point.latitude, 0) /
    Math.max(1, polygon.length),
  longitude:
    polygon.reduce((sum, point) => sum + point.longitude, 0) /
    Math.max(1, polygon.length)
});
