import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env";

export const requireAdmin = async (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!accessToken) throw new Error("Unauthorized");

  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.getUser(accessToken);
  const email = data.user?.email?.toLowerCase();
  if (error || !data.user || !email) throw new Error("Unauthorized");

  const envAllowed = getServerEnv().adminEmails.has(email);
  const { data: row } = await supabase
    .from("admin_allowlist")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  if (!envAllowed && !row) throw new Error("Admin access is not allowed");
  return { user: data.user, email, supabase };
};
