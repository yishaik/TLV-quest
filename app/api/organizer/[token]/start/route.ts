import { startRunByOrganizerToken } from "@/lib/repository";
import { handleRouteError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    return jsonOk(await startRunByOrganizerToken(token));
  } catch (error) {
    return handleRouteError(error);
  }
}
