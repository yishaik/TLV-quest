import { randomUUID } from "node:crypto";
import { submitPhoto } from "@/lib/physical-actions";
import { handleRouteError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const form = await request.formData();
    const file = form.get("photo");
    if (!(file instanceof File)) throw new Error("Photo is required");

    const bytes = new Uint8Array(await file.arrayBuffer());
    return jsonOk(
      await submitPhoto({
        token,
        bytes,
        mimeType: file.type,
        idempotencyKey:
          request.headers.get("idempotency-key") ?? `photo:${randomUUID()}`
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
