import { requireAdmin } from "@/lib/admin-auth";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";
import { generateRouteOrdering } from "@/lib/providers";
import { enforceAdminRateLimit } from "@/lib/rate-limit";
import {
  analyzeRoute,
  nearestNeighborOrder,
  pointInPolygon,
  polygonCenter,
  type RouteCoordinate,
  type RouteStation
} from "@/lib/route-planning";
import { resolveAdminTenant } from "@/lib/tenant-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const localizedTitle = (
  value: unknown,
  locale: "he" | "en",
  fallback: string
) => {
  const title = objectValue(value);
  const primary = title[locale];
  const secondary = title[locale === "he" ? "en" : "he"];
  return typeof primary === "string" && primary.trim()
    ? primary.trim()
    : typeof secondary === "string" && secondary.trim()
      ? secondary.trim()
      : fallback;
};

const parsePolygon = (value: unknown): RouteCoordinate[] => {
  if (!Array.isArray(value) || value.length < 3 || value.length > 100) {
    throw new Error("A polygon with 3–100 points is required");
  }
  const polygon = value.map((raw) => {
    const point = objectValue(raw);
    const latitude = Number(point.latitude);
    const longitude = Number(point.longitude);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new Error("Polygon contains an invalid coordinate");
    }
    return { latitude, longitude };
  });
  return polygon;
};

export async function GET(request: Request) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { tenantId } = await resolveAdminTenant({ supabase, email });
    const { data, error } = await supabase
      .from("route_generation_drafts")
      .select(
        "id,template_id,request,proposed_route,provenance,confidence,verification_requirements,status,created_at,reviewed_at,reviewed_by"
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) throw error;
    return jsonOk(data ?? []);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, email } = await requireAdmin(request);
    await enforceAdminRateLimit("routeGenerator", email);
    const body = await readJson<Record<string, unknown>>(request);
    const { tenantId } = await resolveAdminTenant({
      supabase,
      email,
      requestedTenantId:
        typeof body.tenantId === "string" ? body.tenantId : null
    });
    const polygon = parsePolygon(body.polygon);
    const locale = body.locale === "en" ? "en" : "he";
    const audience =
      typeof body.audience === "string"
        ? body.audience.trim().slice(0, 80) || "general"
        : "general";
    const durationMinutes = Math.max(
      30,
      Math.min(360, Math.round(Number(body.durationMinutes) || 90))
    );
    const constraints = objectValue(body.constraints);
    const templateId =
      typeof body.templateId === "string" && body.templateId.trim()
        ? body.templateId.trim()
        : null;
    if (templateId) {
      const { data: template, error } = await supabase
        .from("game_templates")
        .select("id")
        .eq("id", templateId)
        .eq("tenant_id", tenantId)
        .single();
      if (error || !template) throw new Error("Template was not found");
    }

    const [{ data: stationRows, error: stationError }, { data: riddles, error: riddleError }] =
      await Promise.all([
        supabase
          .from("content_stations")
          .select(
            "id,slug,title,latitude,longitude,tags,accessibility,field_verification_required,health_status,status"
          )
          .eq("status", "active")
          .not("latitude", "is", null)
          .not("longitude", "is", null),
        supabase
          .from("content_riddles")
          .select("id,station_id,slug,title,kind,status,tags")
          .eq("status", "active")
      ]);
    if (stationError) throw stationError;
    if (riddleError) throw riddleError;

    const wheelchairRequired = constraints.wheelchair === true;
    const stations: RouteStation[] = (stationRows ?? [])
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        title: objectValue(row.title),
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        tags: Array.isArray(row.tags)
          ? row.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        healthStatus: row.health_status,
        fieldVerificationRequired: row.field_verification_required,
        accessibility: objectValue(row.accessibility)
      }))
      .filter(
        (station) =>
          pointInPolygon(station, polygon) &&
          (!wheelchairRequired ||
            station.accessibility.wheelchair === true)
      );
    if (stations.length < 2) {
      throw new Error("The polygon does not contain enough eligible stations");
    }

    const riddleByStation = new Map<
      string,
      Array<NonNullable<typeof riddles>[number]>
    >();
    for (const riddle of riddles ?? []) {
      const rows = riddleByStation.get(riddle.station_id) ?? [];
      rows.push(riddle);
      riddleByStation.set(riddle.station_id, rows);
    }
    const eligible = stations.filter(
      (station) => (riddleByStation.get(station.id)?.length ?? 0) > 0
    );
    if (eligible.length < 2) {
      throw new Error("Eligible stations need active riddles before generation");
    }

    const heuristicOrder = nearestNeighborOrder(eligible, polygonCenter(polygon));
    const ai = await generateRouteOrdering({
      locale,
      audience,
      durationMinutes,
      constraints,
      candidates: eligible.map((station) => ({
        stationId: station.id,
        title: localizedTitle(station.title, locale, station.slug),
        tags: station.tags,
        healthStatus: station.healthStatus,
        latitude: station.latitude,
        longitude: station.longitude
      }))
    });
    const stationById = new Map(eligible.map((station) => [station.id, station]));
    const aiIds = [
      ...new Set(
        (ai?.stationIds ?? []).filter((stationId) =>
          stationById.has(stationId)
        )
      )
    ];
    const proposedOrder =
      aiIds.length >= 2
        ? [
            ...aiIds.map((id) => stationById.get(id) as RouteStation),
            ...heuristicOrder.filter((station) => !aiIds.includes(station.id))
          ]
        : heuristicOrder;

    const fitted: RouteStation[] = [];
    for (const station of proposedOrder.slice(0, 12)) {
      const candidate = [...fitted, station];
      const analysis = analyzeRoute(candidate, { wheelchairRequired });
      if (
        candidate.length <= 2 ||
        analysis.estimatedExperienceMinutes <= durationMinutes
      ) {
        fitted.push(station);
      }
    }
    const finaleStation = fitted.find((station) =>
      (riddleByStation.get(station.id) ?? []).some(
        (riddle) => riddle.kind === "finale"
      )
    );
    const ordered = finaleStation
      ? [...fitted.filter((station) => station.id !== finaleStation.id), finaleStation]
      : fitted;
    const analysis = analyzeRoute(ordered, { wheelchairRequired });
    const verificationRequirements = [...analysis.flags];
    if (!finaleStation) verificationRequirements.push("finale_required");
    if (analysis.estimatedExperienceMinutes > durationMinutes) {
      verificationRequirements.push("duration_exceeds_target");
    }
    if (!ai) verificationRequirements.push("ai_provider_unavailable");

    const stops = ordered.map((station, index) => {
      const candidates = riddleByStation.get(station.id) ?? [];
      const riddle =
        index === ordered.length - 1
          ? candidates.find((candidate) => candidate.kind === "finale") ??
            candidates[0]
          : candidates.find((candidate) => candidate.kind !== "finale") ??
            candidates[0];
      return {
        sequence: index + 1,
        stationId: station.id,
        stationSlug: station.slug,
        stationTitle: station.title,
        riddleId: riddle.id,
        riddleSlug: riddle.slug,
        riddleTitle: riddle.title,
        kind: riddle.kind,
        latitude: station.latitude,
        longitude: station.longitude,
        healthStatus: station.healthStatus,
        requiresFieldVerification:
          station.fieldVerificationRequired &&
          station.healthStatus !== "verified"
      };
    });
    const verifiedRatio =
      ordered.filter(
        (station) =>
          !station.fieldVerificationRequired ||
          station.healthStatus === "verified"
      ).length / Math.max(1, ordered.length);
    const confidence = Math.max(
      0.1,
      Math.min(
        0.98,
        0.45 +
          verifiedRatio * 0.3 +
          (ai ? 0.12 : 0) +
          (analysis.estimatedExperienceMinutes <= durationMinutes ? 0.08 : 0) +
          (finaleStation ? 0.05 : 0)
      )
    );
    const generatedAt = new Date().toISOString();
    const proposedRoute = {
      publicationState: "draft",
      stops,
      analysis,
      rationale:
        ai?.rationale ||
        "Nearest-neighbor ordering constrained by duration, station health and accessibility.",
      requiresHumanReview: true
    };
    const provenance = {
      provider: ai?.provider ?? "deterministic",
      model: ai?.model ?? null,
      algorithm: ai ? "validated-ai-order-plus-safety-fit" : "nearest-neighbor-safety-fit",
      candidateCount: eligible.length,
      generatedAt,
      source: "content_station_and_riddle_library"
    };
    const { data: draft, error: insertError } = await supabase
      .from("route_generation_drafts")
      .insert({
        tenant_id: tenantId,
        template_id: templateId,
        requested_by: email,
        request: {
          polygon,
          locale,
          audience,
          durationMinutes,
          constraints
        },
        proposed_route: proposedRoute,
        provenance,
        confidence,
        verification_requirements: verificationRequirements
      })
      .select(
        "id,proposed_route,provenance,confidence,verification_requirements,status,created_at"
      )
      .single();
    if (insertError) throw insertError;
    if (ai) {
      const { error: usageError } = await supabase
        .from("tenant_usage_events")
        .insert({
          tenant_id: tenantId,
          kind: "ai_request",
          idempotency_key: `route-ai:${draft.id}`,
          metadata: { feature: "route_generator", draftId: draft.id }
        });
      if (usageError) throw usageError;
    }
    return jsonOk(draft, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
