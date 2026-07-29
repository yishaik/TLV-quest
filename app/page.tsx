import { MarketingHome } from "@/components/MarketingHome";

export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const params = await searchParams;
  return <MarketingHome locale={params.lang === "en" ? "en" : "he"} />;
}
