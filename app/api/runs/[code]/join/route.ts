import { joinRun } from "@/lib/repository";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);
    const result = await joinRun({
      runCode: code,
      firstName: typeof body.firstName === "string" ? body.firstName : "",
      publicAlias:
        typeof body.publicAlias === "string" ? body.publicAlias : undefined,
      phone: typeof body.phone === "string" ? body.phone : undefined,
      language: body.language === "en" ? "en" : "he",
      requestedTeamName:
        typeof body.requestedTeamName === "string"
          ? body.requestedTeamName
          : undefined,
      consent: body.consent === true
    });
    return jsonOk(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
