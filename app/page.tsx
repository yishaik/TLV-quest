import { MarketingHome } from "@/components/MarketingHome";
import { getMarketingRoute } from "@/lib/marketing-route";

// The route is read per request rather than baked in: the page describes what
// is actually bookable, and the previous version drifted precisely because it
// could not.
export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const params = await searchParams;
  const route = await getMarketingRoute().catch(() => null);
  return (
    <MarketingHome locale={params.lang === "en" ? "en" : "he"} route={route} />
  );
}
