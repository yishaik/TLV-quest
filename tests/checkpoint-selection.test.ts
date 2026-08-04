import { describe, expect, it } from "vitest";
import { selectCoherentCheckpoints } from "@/lib/checkpoint-selection";

const route = Array.from({ length: 10 }, (_, index) => ({
  sequence_no: index + 1,
  slug: `stop-${index + 1}`,
  kind: index === 9 ? "finale" : "text"
}));

describe("coherent checkpoint selection", () => {
  it("keeps the authored opening, finale and forward order", () => {
    const selected = selectCoherentCheckpoints(route, 6);
    expect(selected).toHaveLength(6);
    expect(selected[0].slug).toBe("stop-1");
    expect(selected.at(-1)?.slug).toBe("stop-10");
    expect(selected.map((item) => item.sequence_no)).toEqual(
      [...selected].map((item) => item.sequence_no).sort((a, b) => a - b)
    );
  });

  it("spreads middle stops across the whole route", () => {
    expect(selectCoherentCheckpoints(route, 4).map((item) => item.slug)).toEqual([
      "stop-1", "stop-4", "stop-7", "stop-10"
    ]);
  });

  it("clamps invalid lengths without duplicating stops", () => {
    expect(selectCoherentCheckpoints(route, 99)).toHaveLength(10);
    expect(selectCoherentCheckpoints(route, 1).map((item) => item.slug)).toEqual(["stop-1"]);
  });
});
