import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { galleryEntries } from "@/lib/station-gallery";

export type MarketingStop = {
  slug: string;
  name: string;
  kind: string;
  photo: string | null;
};

export type MarketingRoute = {
  slug: string;
  title: { he?: string; en?: string };
  stops: MarketingStop[];
  metres: number;
};

const metresBetween = (
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
) => {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * The published route, read straight from the content tables.
 *
 * Deliberately not hardcoded copy. The previous marketing page described a
 * time capsule and three checkpoints that no longer existed anywhere, and
 * nobody noticed because the text had no relationship to the data. Reading it
 * live means the site cannot drift from what is actually bookable.
 */
/**
 * How long the homepage will wait for content before rendering without it.
 *
 * The route strip is an enhancement; the page sells the product with or
 * without it. Blocking the render on a database round trip would mean a slow
 * or unreachable Postgres takes the marketing site down with it — and in CI,
 * where the Supabase host is a placeholder, it made every navigation hang.
 */
const CONTENT_TIMEOUT_MS = 2_500;

const readRoute = async (): Promise<MarketingRoute | null> => {
  const supabase = createAdminClient();

  const { data: template } = await supabase
    .from("game_templates")
    .select("id,slug,title,active_version")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!template) return null;

  const { data: checkpoints } = await supabase
    .from("template_checkpoints")
    .select("slug,kind,sequence_no,latitude,longitude,config,source_station_id")
    .eq("template_id", template.id)
    .eq("version", template.active_version)
    .eq("is_active", true)
    .order("sequence_no");
  if (!checkpoints || checkpoints.length === 0) return null;

  const stationIds = checkpoints
    .map((checkpoint) => checkpoint.source_station_id)
    .filter((id): id is string => Boolean(id));
  const { data: stations } = await supabase
    .from("content_stations")
    .select("id,title,gallery")
    .in("id", stationIds.length > 0 ? stationIds : ["00000000-0000-0000-0000-000000000000"]);

  const byId = new Map((stations ?? []).map((station) => [station.id, station]));

  let metres = 0;
  for (let index = 1; index < checkpoints.length; index += 1) {
    const previous = checkpoints[index - 1];
    const current = checkpoints[index];
    if (
      typeof previous.latitude === "number" &&
      typeof previous.longitude === "number" &&
      typeof current.latitude === "number" &&
      typeof current.longitude === "number"
    ) {
      metres += metresBetween(
        { lat: previous.latitude, lon: previous.longitude },
        { lat: current.latitude, lon: current.longitude }
      );
    }
  }

  return {
    slug: template.slug,
    title: (template.title ?? {}) as { he?: string; en?: string },
    metres: Math.round(metres),
    stops: checkpoints.map((checkpoint) => {
      const station = checkpoint.source_station_id
        ? byId.get(checkpoint.source_station_id)
        : undefined;
      const config = (checkpoint.config ?? {}) as Record<string, unknown>;
      const content = (config.content ?? {}) as Record<string, { title?: string }>;
      const stationTitle = (station?.title ?? {}) as { he?: string; en?: string };
      return {
        slug: checkpoint.slug,
        name:
          content.he?.title ||
          stationTitle.he ||
          stationTitle.en ||
          checkpoint.slug,
        kind: checkpoint.kind as string,
        photo: galleryEntries(station?.gallery)[0]?.url ?? null
      };
    })
  };
};

export const getMarketingRoute = async (): Promise<MarketingRoute | null> =>
  Promise.race([
    readRoute(),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), CONTENT_TIMEOUT_MS)
    )
  ]).catch(() => null);
