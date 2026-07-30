import {
  normalizeContentImportRows,
  parseContentImportSource
} from "@/lib/content-import";
import { requireAdmin } from "@/lib/admin-auth";
import {
  AppError,
  handleRouteError,
  jsonOk,
  readJson,
  requireIdempotencyKey
} from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseVersion = (value: string) => {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new AppError({
      message: "Invalid template version",
      code: "invalid_template_version"
    });
  }
  return version;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ templateId: string; version: string }> }
) {
  try {
    const { supabase } = await requireAdmin(request);
    const { templateId, version: rawVersion } = await context.params;
    const version = parseVersion(rawVersion);
    const { data, error } = await supabase
      .from("content_import_batches")
      .select(
        "id,format,status,row_count,summary,actor,created_at,rolled_back_at,rolled_back_by"
      )
      .eq("template_id", templateId)
      .eq("version", version)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    return jsonOk(data ?? []);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ templateId: string; version: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { templateId, version: rawVersion } = await context.params;
    const version = parseVersion(rawVersion);
    await enforceRateLimit({
      scope: "content-bulk-import",
      identifier: email,
      limit: 10,
      windowSeconds: 60
    });
    const idempotencyKey = requireIdempotencyKey(request, "content-import");
    const body = await readJson<Record<string, unknown>>(request);
    const format = body.format === "csv" ? "csv" : body.format === "json" ? "json" : null;
    const content = typeof body.content === "string" ? body.content : "";
    const dryRun = body.dryRun !== false;
    if (!format) {
      throw new AppError({
        message: "Import format must be csv or json",
        code: "invalid_import_format"
      });
    }
    if (!content.trim() || content.length > 2_000_000) {
      throw new AppError({
        message: "Import content is empty or exceeds 2 MB",
        code: "invalid_import_size"
      });
    }

    let inputRows: ReturnType<typeof parseContentImportSource>;
    try {
      inputRows = parseContentImportSource({ format, content });
    } catch (cause) {
      throw new AppError({
        message:
          cause instanceof Error ? cause.message : "Import could not be parsed",
        code: "import_parse_failed"
      });
    }
    const normalized = normalizeContentImportRows(inputRows);
    if (normalized.errors.length) {
      return jsonOk({
        ok: false,
        dryRun,
        rowCount: inputRows.length,
        errors: normalized.errors
      });
    }

    const { data, error } = await supabase.rpc("content_bulk_import", {
      p_template_id: templateId,
      p_version: version,
      p_rows: normalized.rows,
      p_actor: email,
      p_idempotency_key: idempotencyKey,
      p_format: format,
      p_dry_run: dryRun
    });
    if (error) throw error;
    return jsonOk(data);
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
    requireIdempotencyKey(request, "content-import-rollback");
    const body = await readJson<Record<string, unknown>>(request);
    const batchId = typeof body.batchId === "string" ? body.batchId : "";
    if (!batchId) {
      throw new AppError({
        message: "Import batch id is required",
        code: "import_batch_required"
      });
    }
    const { data: batch, error: batchError } = await supabase
      .from("content_import_batches")
      .select("id")
      .eq("id", batchId)
      .eq("template_id", templateId)
      .eq("version", version)
      .single();
    if (batchError || !batch) throw new Error("Import batch was not found");

    const { data, error } = await supabase.rpc("content_rollback_import", {
      p_batch_id: batchId,
      p_actor: email
    });
    if (error) throw error;
    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
