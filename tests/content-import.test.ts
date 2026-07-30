import { describe, expect, it } from "vitest";

import {
  contentImportCsvTemplate,
  normalizeContentImportRows,
  parseContentImportCsv,
  parseContentImportSource
} from "@/lib/content-import";

describe("parseContentImportCsv", () => {
  it("keeps commas and escaped quotes inside quoted cells", () => {
    const rows = parseContentImportCsv(
      ['a,b', '"one, two","he said ""hi"""'].join("\n")
    );
    expect(rows).toEqual([{ a: "one, two", b: 'he said "hi"' }]);
  });

  it("normalizes headers and tolerates BOM, CRLF and blank lines", () => {
    const rows = parseContentImportCsv(
      '﻿Station Slug,Riddle-Slug\r\nport-gate,first-clue\r\n\r\n'
    );
    expect(rows).toEqual([{ station_slug: "port-gate", riddle_slug: "first-clue" }]);
  });

  it("returns no rows for empty input", () => {
    expect(parseContentImportCsv("")).toEqual([]);
  });
});

describe("parseContentImportSource", () => {
  it("rejects JSON that is not an array of rows", () => {
    expect(() =>
      parseContentImportSource({ format: "json", content: '{"a":1}' })
    ).toThrow();
  });

  it("drops non-object entries from a JSON array", () => {
    const rows = parseContentImportSource({
      format: "json",
      content: '[{"station_slug":"a"},null,42,["x"]]'
    });
    expect(rows).toEqual([{ station_slug: "a" }]);
  });
});

describe("normalizeContentImportRows", () => {
  // The template is what authors are handed as a starting point, so it has to
  // survive its own importer. This is the regression guard for CNT-04.
  it("accepts the shipped CSV template with no errors", () => {
    const parsed = parseContentImportSource({
      format: "csv",
      content: contentImportCsvTemplate
    });
    expect(parsed).toHaveLength(2);

    const { rows, errors } = normalizeContentImportRows(parsed);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].station.slug).toBe("sample-station");
    expect(rows[0].riddle.slug).toBe("sample-riddle");
    expect(rows[0].station.latitude).toBeCloseTo(32.1);
    expect(rows[0].station.longitude).toBeCloseTo(34.8);
  });

  it("reports the exact row and field for an invalid row", () => {
    const { rows, errors } = normalizeContentImportRows([
      { station_slug: "", riddle_slug: "x", kind: "text" }
    ]);
    expect(errors.length).toBeGreaterThan(0);
    // Note the contract: a best-effort normalized row is still returned next to
    // the errors, so callers must gate on `errors` rather than on `rows` being
    // empty. The import route does exactly that before touching the RPC.
    expect(rows).toHaveLength(1);
    // Acceptance criterion: errors identify the exact row and field.
    expect(errors.every((error) => error.field && error.code)).toBe(true);
    expect(errors.map((error) => error.field)).toContain("station_slug");
  });

  // Row numbers are 1-based and count the header, so the first data row is 2 —
  // the line number an author sees in a spreadsheet. Locking this in because
  // off-by-one here sends people to the wrong line of a large import.
  it("numbers rows as spreadsheet lines, counting the header", () => {
    const { errors } = normalizeContentImportRows([
      { station_slug: "ok", riddle_slug: "a", kind: "text" },
      { station_slug: "", riddle_slug: "b", kind: "text" }
    ]);
    expect(errors.some((error) => error.row === 2)).toBe(true);
    expect(errors.some((error) => error.row === 3)).toBe(true);
    expect(errors.every((error) => error.row !== 1)).toBe(true);
  });
});
