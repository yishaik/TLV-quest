import {
  handleRouteError,
  jsonOk,
  readJson,
  requireIdempotencyKey
} from "@/lib/http";
import { issuePhotoUpload } from "@/lib/photo-uploads";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const body = await readJson<{
      mimeType?: unknown;
      size?: unknown;
    }>(request);
    return jsonOk(
      await issuePhotoUpload({
        token,
        mimeType: body.mimeType,
        size: body.size,
        idempotencyKey: requireIdempotencyKey(request)
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
