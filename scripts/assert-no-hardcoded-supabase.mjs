import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const projectHost =
  /\b(?:https:\/\/)?(?:db\.)?([a-z0-9]{20})\.supabase\.co\b/g;

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8"
})
  .split("\0")
  .filter(Boolean);

const findings = [];

for (const path of trackedFiles) {
  const content = readFileSync(path);
  if (content.includes(0)) continue;

  const text = content.toString("utf8");
  for (const match of text.matchAll(projectHost)) {
    const line = text.slice(0, match.index).split("\n").length;
    findings.push(`${path}:${line}`);
  }
}

if (findings.length > 0) {
  console.error(
    [
      "Hardcoded Supabase project hostname found:",
      ...findings.map((finding) => `- ${finding}`),
      "Use environment variables and the your-project-ref placeholder instead."
    ].join("\n")
  );
  process.exitCode = 1;
} else {
  console.log("No hardcoded Supabase project hostnames found.");
}
