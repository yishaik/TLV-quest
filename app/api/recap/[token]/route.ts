import { getRecapByToken } from "@/lib/recap";
import { AppError, handleRouteError, jsonOk } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    if (
      token.length < 8 ||
      token.length > 200 ||
      !/^[a-zA-Z0-9._:-]+$/.test(token)
    ) {
      throw new AppError({
        message: "Recap link is invalid or expired",
        status: 404,
        code: "recap_not_found"
      });
    }
    await enforceRateLimit({
      scope: "public-recap",
      identifier: token,
      limit: 30,
      windowSeconds: 60
    });
    return jsonOk(await getRecapByToken(token), {
      headers: { "cache-control": "private, no-store" }
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
