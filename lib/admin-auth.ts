import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env";
import { AppError } from "@/lib/http";

const unauthorized = () =>
  new AppError({
    message: "נדרשת התחברות. / Authentication is required.",
    status: 401,
    code: "unauthorized"
  });

export const requireAdmin = async (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!accessToken) throw unauthorized();

  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.getUser(accessToken);
  const email = data.user?.email?.toLowerCase();
  if (error || !data.user || !email) throw unauthorized();

  const envAllowed = getServerEnv().adminEmails.has(email);
  const { data: row } = await supabase
    .from("admin_allowlist")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  if (!envAllowed && !row) {
    throw new AppError({
      message: "אין הרשאת מנהל. / Admin access is not allowed.",
      status: 403,
      code: "forbidden"
    });
  }
  return { user: data.user, email, supabase };
};
