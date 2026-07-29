import { requireAdmin } from "@/lib/admin-auth";
import {
  buildContentValidationReport,
  checkpointNeedsFieldVerification,
  normalizeContentSlug,
  numberOrNull,
  objectValue,
  type ContentCheckpoint,
  type ContentHealth
} from "@/lib/content-os";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checkpointKinds = new Set([
  "text",
  "choice",
  "scan",
  "location",
  "photo",
  "hybrid",
  "finale"
]);

const parseVersion = (value: string) => {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("Invalid template version");
  }
  return version;
};

async function getVersionDetail({
  supabase,
  templateId,
  version
}: {
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"];
  templateId: string;
  version: number;
}) {
  const [templateResult, versionResult, checkpointsResult, healthResult, auditResult] =
    await Promise.all([
      supabase
        .from("game_templates")
        .select("id,slug,brand_key,title,description,active_version,is_active,created_at,updated_at")
        .eq("id", templateId)
        .single(),
      supabase
        .from("template_versions")
        .select("template_id,version,status,release_name,release_notes,theme,route_config,validation_report,created_by,updated_by,published_by,created_at,updated_at,published_at")
        .eq("template_id", templateId)
        .eq("version", version)
        .single(),
      supabase
        .from("template_checkpoints")
        .select("id,template_id,version,slug,sequence_no,kind,latitude,longitude,radius_meters,accessibility,config,is_optional,is_active,created_at")
        .eq("template_id", templateId)
        .eq("version", version)
        .order("sequence_no"),
      supabase
        .from("checkpoint_health")
        .select("checkpoint_id,template_id,version,status,checklist,notes,last_checked_at,verified_at,verified_by,updated_at,updated_by")
        .eq("template_id", templateId)
        .eq("version", version),
      supabase
        .from("content_audit_log")
        .select("id,checkpoint_id,actor_email,action,payload,created_at")
        .eq("template_id", templateId)
        .eq("version", version)
        .order("created_at", { ascending: false })
        .limit(60)
    ]);

  if (templateResult.error) throw templateResult.error;
  if (versionResult.error) throw versionResult.error;
  if (checkpointsResult.error) throw checkpointsResult.error;
  if (healthResult.error) throw healthResult.error;
  if (auditResult.error) throw auditResult.error;

  const checkpoints = (checkpointsResult.data ?? []).map((checkpoint) => ({
    ...checkpoint,
    accessibility: objectValue(checkpoint.accessibility),
    config: objectValue(checkpoint.config)
  })) as ContentCheckpoint[];
  const health = (healthResult.data ?? []).map((item) => ({
    ...item,
    checklist: objectValue(item.checklist)
  })) as ContentHealth[];
  const healthByCheckpoint = new Map(
    health.map((item) => [item.checkpoint_id, item])
  );

  return {
    template: templateResult.data,
    version: versionResult.data,
    checkpoints: checkpoints.map((checkpoint) => ({
      ...checkpoint,
      health: healthByCheckpoint.get(checkpoint.id) ?? null
    })),
    report: buildContentValidationReport({ checkpoints, healthByCheckpoint }),
    audit: auditResult.data ?? []
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ templateId: string; version: string }> }
) {
  try {
    const { supabase } = await requireAdmin(request);
    const { templateId, version: rawVersion } = await context.params;
    return jsonOk(
      await getVersionDetail({
        supabase,
        templateId,
        version: parseVersion(rawVersion)
      })
    );
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
    const version = parseVersion(rawVersion);
    const body = await readJson<Record<string, unknown>>(request);

    const { data: versionRow, error: versionError } = await supabase
      .from("template_versions")
      .select("status")
      .eq("template_id", templateId)
      .eq("version", version)
      .single();
    if (versionError || !versionRow) {
      throw versionError ?? new Error("Template version was not found");
    }
    if (!["draft", "review"].includes(versionRow.status)) {
      throw new Error("Published content is immutable. Create a new draft first.");
    }

    const metadata = objectValue(body.metadata);
    const checkpoint = objectValue(body.checkpoint);
    let changed = false;

    if (Object.keys(metadata).length) {
      const versionUpdates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        updated_by: email
      };

      if (typeof metadata.releaseName === "string") {
        versionUpdates.release_name = metadata.releaseName.trim().slice(0, 120) || null;
      }
      if (typeof metadata.releaseNotes === "string") {
        versionUpdates.release_notes = metadata.releaseNotes.trim().slice(0, 4000) || null;
      }
      if (metadata.theme !== undefined) {
        versionUpdates.theme = objectValue(metadata.theme);
      }
      if (metadata.routeConfig !== undefined) {
        versionUpdates.route_config = objectValue(metadata.routeConfig);
      }
      if (metadata.status === "draft" || metadata.status === "review") {
        versionUpdates.status = metadata.status;
      }

      const { error } = await supabase
        .from("template_versions")
        .update(versionUpdates)
        .eq("template_id", templateId)
        .eq("version", version);
      if (error) throw error;

      const { error: auditError } = await supabase.from("content_audit_log").insert({
        template_id: templateId,
        version,
        actor_email: email,
        action: "VERSION_METADATA_UPDATED",
        payload: { fields: Object.keys(metadata) }
      });
      if (auditError) throw auditError;
      changed = true;
    }

    if (Object.keys(checkpoint).length) {
      const checkpointId =
        typeof checkpoint.id === "string" ? checkpoint.id.trim() : "";
      if (!checkpointId) throw new Error("Checkpoint id is required");

      const checkpointUpdates: Record<string, unknown> = {};
      if (checkpoint.slug !== undefined) {
        const slug = normalizeContentSlug(String(checkpoint.slug));
        if (!slug) throw new Error("Checkpoint slug is required and must use Latin letters or numbers");
        checkpointUpdates.slug = slug;
      }
      if (typeof checkpoint.kind === "string") {
        if (!checkpointKinds.has(checkpoint.kind)) {
          throw new Error("Unsupported checkpoint kind");
        }
        checkpointUpdates.kind = checkpoint.kind;
      }
      if (checkpoint.latitude !== undefined) {
        checkpointUpdates.latitude = numberOrNull(checkpoint.latitude);
      }
      if (checkpoint.longitude !== undefined) {
        checkpointUpdates.longitude = numberOrNull(checkpoint.longitude);
      }
      if (checkpoint.radiusMeters !== undefined) {
        checkpointUpdates.radius_meters = numberOrNull(checkpoint.radiusMeters);
      }
      if (typeof checkpoint.isOptional === "boolean") {
        checkpointUpdates.is_optional = checkpoint.isOptional;
      }
      if (typeof checkpoint.isActive === "boolean") {
        checkpointUpdates.is_active = checkpoint.isActive;
      }
      if (checkpoint.accessibility !== undefined) {
        checkpointUpdates.accessibility = objectValue(checkpoint.accessibility);
      }
      if (checkpoint.config !== undefined) {
        checkpointUpdates.config = objectValue(checkpoint.config);
      }

      if (!Object.keys(checkpointUpdates).length) {
        throw new Error("No checkpoint changes supplied");
      }

      const { data: updated, error } = await supabase
        .from("template_checkpoints")
        .update(checkpointUpdates)
        .eq("id", checkpointId)
        .eq("template_id", templateId)
        .eq("version", version)
        .select("id,slug,kind,latitude,longitude,radius_meters,accessibility,config,is_optional,is_active")
        .single();
      if (error || !updated) {
        throw error ?? new Error("Checkpoint was not found");
      }

      const normalizedCheckpoint = {
        ...updated,
        template_id: templateId,
        version,
        sequence_no: 0,
        accessibility: objectValue(updated.accessibility),
        config: objectValue(updated.config)
      } as ContentCheckpoint;
      const verificationSensitiveFields = [
        "slug",
        "kind",
        "latitude",
        "longitude",
        "radius_meters",
        "accessibility",
        "config"
      ];
      if (
        verificationSensitiveFields.some((field) => field in checkpointUpdates) &&
        checkpointNeedsFieldVerification(normalizedCheckpoint)
      ) {
        const now = new Date().toISOString();
        const { error: healthError } = await supabase.from("checkpoint_health").upsert(
          {
            checkpoint_id: checkpointId,
            template_id: templateId,
            version,
            status: "pending",
            checklist: {},
            notes: "Content, validation or location changed; field verification was reset.",
            last_checked_at: null,
            verified_at: null,
            verified_by: null,
            updated_at: now,
            updated_by: email
          },
          { onConflict: "checkpoint_id" }
        );
        if (healthError) throw healthError;
      }

      const now = new Date().toISOString();
      const { error: versionTouchError } = await supabase
        .from("template_versions")
        .update({ updated_at: now, updated_by: email })
        .eq("template_id", templateId)
        .eq("version", version);
      if (versionTouchError) throw versionTouchError;

      const { error: auditError } = await supabase.from("content_audit_log").insert({
        template_id: templateId,
        version,
        checkpoint_id: checkpointId,
        actor_email: email,
        action: "CHECKPOINT_UPDATED",
        payload: { slug: updated.slug, fields: Object.keys(checkpointUpdates) }
      });
      if (auditError) throw auditError;
      changed = true;
    }

    if (!changed) throw new Error("No content changes supplied");

    return jsonOk(
      await getVersionDetail({ supabase, templateId, version })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ templateId: string; version: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { templateId, version: rawVersion } = await context.params;
    const version = parseVersion(rawVersion);
    const { data, error } = await supabase.rpc("content_delete_version", {
      p_template_id: templateId,
      p_version: version,
      p_actor: email
    });
    if (error) throw error;
    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
