import { describe, expect, it } from "vitest";
import {
  analyzeRoute,
  nearestNeighborOrder,
  pointInPolygon,
  routeDistanceMeters,
  type RouteStation
} from "../lib/route-planning";

const station = (
  id: string,
  latitude: number,
  longitude: number,
  overrides: Partial<RouteStation> = {}
): RouteStation => ({
  id,
  slug: id,
  title: { en: id },
  latitude,
  longitude,
  tags: [],
  healthStatus: "verified",
  fieldVerificationRequired: true,
  accessibility: { wheelchair: true },
  ...overrides
});

describe("route authoring safety", () => {
  it("filters points against an editorial polygon", () => {
    const polygon = [
      { latitude: 32, longitude: 34 },
      { latitude: 32, longitude: 35 },
      { latitude: 33, longitude: 35 },
      { latitude: 33, longitude: 34 }
    ];
    expect(
      pointInPolygon({ latitude: 32.5, longitude: 34.5 }, polygon)
    ).toBe(true);
    expect(
      pointInPolygon({ latitude: 33.5, longitude: 34.5 }, polygon)
    ).toBe(false);
  });

  it("computes walking distance, time, and safety flags", () => {
    const first = station("first", 32.1, 34.8);
    const second = station("second", 32.101, 34.8, {
      healthStatus: "pending"
    });
    expect(routeDistanceMeters(first, second)).toBeGreaterThan(100);
    const analysis = analyzeRoute([first, second], {
      wheelchairRequired: true
    });
    expect(analysis.totalDistanceMeters).toBeGreaterThan(100);
    expect(analysis.walkingMinutes).toBeGreaterThan(0);
    expect(analysis.flags).toContain("field_verification:second");
    expect(analysis.safe).toBe(false);
  });

  it("orders eligible stations by the closest validated next stop", () => {
    const ordered = nearestNeighborOrder(
      [
        station("far", 32.02, 34),
        station("near", 32.001, 34),
        station("middle", 32.01, 34)
      ],
      { latitude: 32, longitude: 34 }
    );
    expect(ordered.map((item) => item.id)).toEqual([
      "near",
      "middle",
      "far"
    ]);
  });
});
