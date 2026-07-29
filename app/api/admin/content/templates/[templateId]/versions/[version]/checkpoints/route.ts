import { requireAdmin } from "@/lib/admin-auth";
import { normalizeContentSlug, textValue } from "@/lib/content-os";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseVersion = (value: string) => {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) throw new Error("Invalid template version");
  return version;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ templateId: string; version: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { templateId, version: rawVersion } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);
    const version = parseVersion(rawVersion);
    const slug = normalizeContentSlug(textValue(body.slug));
    const kind = textValue(body.kind, "text");
    const afterCheckpointId =
      typeof body.afterCheckpointId === "string" && body.afterCheckpointId.trim()
        ? body.afterCheckpointId.trim()
        : null;

    if (!slug) throw new Error("Checkpoint slug is required and must use Latin letters or numbers");

    const { data, error } = await supabase.rpc("content_create_checkpoint", {
      p_template_id: templateId,
      p_version: version,
      p_slug: slug,
      p_kind: kind,
      p_actor: email,
      p_after_checkpoint_id: afterCheckpointId
    });
    if (error) throw error;

    return jsonOk({ checkpointId: String(data) }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ templateId: string; version: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { templateId, version: rawVersion } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);
    const version = parseVersion(rawVersion);
    const checkpointIds = Array.isArray(body.checkpointIds)
      ? body.checkpointIds.filter(
          (value): value is string => typeof value === "string" && Boolean(value.trim())
        )
      : [];

    const { data, error } = await supabase.rpc("content_reorder_checkpoints", {
      p_template_id: templateId,
      p_version: version,
      p_checkpoint_ids: checkpointIds,
      p_actor: email
    });
    if (error) throw error;

    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
