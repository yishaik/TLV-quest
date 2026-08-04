import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const resumeRoute = readFileSync("app/resume/[token]/route.ts", "utf8");
const repository = readFileSync("lib/repository.ts", "utf8");

describe("stable participant game links", () => {
  it("uses the same derived play token at registration and resume", () => {
    expect(repository).toContain("stableParticipantPlayToken(participant.id)");
    expect(resumeRoute).toContain("stableParticipantPlayToken(participant.id)");
  });

  it("does not rotate to a fresh random token whenever a return link opens", () => {
    expect(resumeRoute).not.toContain("randomToken");
  });
});
