import { normalizeContentSlug } from "@/lib/content-os";

export type ContentImportError = {
  row: number | null;
  field: string;
  code: string;
  message: string;
};

export type NormalizedContentImportRow = {
  station: {
    slug: string;
    brandKey: string;
    title: { he: string; en: string };
    description: { he: string; en: string };
    address: { he: string; en: string };
    latitude: number | null;
    longitude: number | null;
    radiusMeters: number | null;
    tags: string[];
    accessibility: Record<string, unknown>;
    fieldVerificationRequired: boolean;
    status: "draft" | "active";
  };
  riddle: {
    slug: string;
    title: { he: string; en: string };
    kind: string;
    content: {
      he: Record<string, string>;
      en: Record<string, string>;
    };
    validation: Record<string, unknown>;
    hints: unknown[];
    scoring: Record<string, unknown>;
    fallback: Record<string, unknown> | null;
    interaction: Record<string, unknown>;
    tags: string[];
    status: "draft" | "active";
  };
  stop: {
    slug: string;
    isOptional: boolean;
    isActive: boolean;
    overrides: Record<string, unknown>;
  };
};

type FlatRow = Record<string, unknown>;

const IMPORT_KINDS = new Set([
  "text",
  "choice",
  "scan",
  "location",
  "photo",
  "hybrid",
  "finale"
]);

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();

const valueFor = (row: FlatRow, ...keys: string[]) => {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
  }
  return undefined;
};

const boolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  const normalized = text(value).toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
};

const nullableNumber = (value: unknown) => {
  if (value === null || value === undefined || text(value) === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const list = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean);
  }
  return text(value)
    .split(/\s*[|;]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const jsonValue = <T>(
  value: unknown,
  fallback: T,
  row: number,
  field: string,
  errors: ContentImportError[],
  expected: "array" | "object"
): T => {
  if (value === undefined || value === null || value === "") return fallback;
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      errors.push({
        row,
        field,
        code: "invalid_json",
        message: `${field} must contain valid JSON.`
      });
      return fallback;
    }
  }
  const valid =
    expected === "array"
      ? Array.isArray(parsed)
      : Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  if (!valid) {
    errors.push({
      row,
      field,
      code: `expected_${expected}`,
      message: `${field} must be a JSON ${expected}.`
    });
    return fallback;
  }
  return parsed as T;
};

export const parseContentImportCsv = (source: string): FlatRow[] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = source.replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => value.trim())) rows.push(row);
  if (!rows.length) return [];

  const headers = rows[0].map((header) =>
    header.trim().toLowerCase().replace(/[\s-]+/g, "_")
  );
  return rows.slice(1).map((values) =>
    Object.fromEntries(
      headers.map((header, index) => [header, values[index]?.trim() ?? ""])
    )
  );
};

export const parseContentImportSource = ({
  format,
  content
}: {
  format: "csv" | "json";
  content: string;
}): FlatRow[] => {
  if (format === "csv") return parseContentImportCsv(content);
  const parsed = JSON.parse(content) as unknown;
  if (!Array.isArray(parsed)) throw new Error("JSON import must be an array of rows");
  return parsed.filter(
    (row): row is FlatRow =>
      Boolean(row && typeof row === "object" && !Array.isArray(row))
  );
};

export const normalizeContentImportRows = (
  inputRows: FlatRow[]
): {
  rows: NormalizedContentImportRow[];
  errors: ContentImportError[];
} => {
  const errors: ContentImportError[] = [];
  const rows: NormalizedContentImportRow[] = [];
  if (!inputRows.length) {
    return {
      rows,
      errors: [
        {
          row: null,
          field: "file",
          code: "empty_import",
          message: "The import contains no data rows."
        }
      ]
    };
  }
  if (inputRows.length > 500) {
    return {
      rows,
      errors: [
        {
          row: null,
          field: "file",
          code: "too_many_rows",
          message: "One import can contain at most 500 rows."
        }
      ]
    };
  }

  inputRows.forEach((source, index) => {
    const rowNumber = index + 2;
    const stationObject =
      source.station &&
      typeof source.station === "object" &&
      !Array.isArray(source.station)
        ? (source.station as FlatRow)
        : source;
    const riddleObject =
      source.riddle &&
      typeof source.riddle === "object" &&
      !Array.isArray(source.riddle)
        ? (source.riddle as FlatRow)
        : source;
    const stopObject =
      source.stop && typeof source.stop === "object" && !Array.isArray(source.stop)
        ? (source.stop as FlatRow)
        : source;

    const stationSlug = normalizeContentSlug(
      text(valueFor(stationObject, "slug", "station_slug", "stationSlug"))
    );
    const riddleSlug = normalizeContentSlug(
      text(valueFor(riddleObject, "slug", "riddle_slug", "riddleSlug"))
    );
    const stopSlug = normalizeContentSlug(
      text(valueFor(stopObject, "slug", "stop_slug", "stopSlug")) ||
        `${stationSlug}-${riddleSlug}`
    );
    const stationTitleHe = text(
      valueFor(stationObject, "title_he", "station_title_he", "titleHe")
    );
    const stationTitleEn = text(
      valueFor(stationObject, "title_en", "station_title_en", "titleEn")
    );
    const riddleTitleHe = text(
      valueFor(riddleObject, "riddle_title_he", "title_he", "titleHe")
    );
    const riddleTitleEn = text(
      valueFor(riddleObject, "riddle_title_en", "title_en", "titleEn")
    );
    const promptHe = text(
      valueFor(riddleObject, "prompt_he", "riddle_prompt_he", "promptHe")
    );
    const promptEn = text(
      valueFor(riddleObject, "prompt_en", "riddle_prompt_en", "promptEn")
    );
    const kind = text(valueFor(riddleObject, "kind", "riddle_kind")).toLowerCase();

    const required: Array<[string, string]> = [
      ["station_slug", stationSlug],
      ["station_title_he", stationTitleHe],
      ["station_title_en", stationTitleEn],
      ["riddle_slug", riddleSlug],
      ["riddle_title_he", riddleTitleHe],
      ["riddle_title_en", riddleTitleEn],
      ["prompt_he", promptHe],
      ["prompt_en", promptEn],
      ["stop_slug", stopSlug]
    ];
    for (const [field, value] of required) {
      if (!value) {
        errors.push({
          row: rowNumber,
          field,
          code: "required",
          message: `${field} is required.`
        });
      }
    }
    if (!IMPORT_KINDS.has(kind)) {
      errors.push({
        row: rowNumber,
        field: "kind",
        code: "unsupported_kind",
        message: `Unsupported checkpoint kind: ${kind || "(empty)"}.`
      });
    }

    const latitude = nullableNumber(
      valueFor(stationObject, "latitude", "station_latitude")
    );
    const longitude = nullableNumber(
      valueFor(stationObject, "longitude", "station_longitude")
    );
    const radiusMeters = nullableNumber(
      valueFor(stationObject, "radius_meters", "radiusMeters")
    );
    if (
      ["location", "finale"].includes(kind) &&
      (latitude === null ||
        longitude === null ||
        radiusMeters === null ||
        radiusMeters <= 0)
    ) {
      errors.push({
        row: rowNumber,
        field: "location",
        code: "missing_location",
        message: "Location and finale rows require coordinates and a positive radius."
      });
    }

    const accepted = list(
      valueFor(riddleObject, "accepted_answers", "accepted", "acceptedAnswers")
    );
    const options = list(
      valueFor(riddleObject, "choice_options", "options", "choiceOptions")
    );
    const acceptedOption = text(
      valueFor(riddleObject, "accepted_option", "acceptedOption")
    );
    const photoCriteria = text(
      valueFor(riddleObject, "photo_criteria", "criteria", "photoCriteria")
    );
    let validation: Record<string, unknown>;
    if (kind === "choice") {
      validation = { type: "choice", options, acceptedOption };
      if (options.length < 2 || !options.includes(acceptedOption)) {
        errors.push({
          row: rowNumber,
          field: "accepted_option",
          code: "invalid_choice",
          message: "Choice rows need two options and an accepted option from that list."
        });
      }
    } else if (kind === "photo") {
      validation = {
        type: "photo",
        criteria: photoCriteria,
        confidenceThreshold: nullableNumber(
          valueFor(riddleObject, "confidence_threshold", "confidenceThreshold")
        ) ?? 0.86
      };
      if (!photoCriteria) {
        errors.push({
          row: rowNumber,
          field: "photo_criteria",
          code: "required",
          message: "Photo rows require validation criteria."
        });
      }
    } else if (kind === "scan") {
      validation = { type: "scan" };
    } else {
      validation = {
        type: "text",
        accepted,
        fuzzyThreshold:
          nullableNumber(
            valueFor(riddleObject, "fuzzy_threshold", "fuzzyThreshold")
          ) ?? 0.94
      };
      if (!accepted.length) {
        errors.push({
          row: rowNumber,
          field: "accepted_answers",
          code: "required",
          message: "Text-based rows require accepted answers."
        });
      }
    }

    const hints = jsonValue<unknown[]>(
      valueFor(riddleObject, "hints_json", "hints"),
      [],
      rowNumber,
      "hints",
      errors,
      "array"
    );
    const scoring = jsonValue<Record<string, unknown>>(
      valueFor(riddleObject, "scoring_json", "scoring"),
      {},
      rowNumber,
      "scoring",
      errors,
      "object"
    );
    const fallback = jsonValue<Record<string, unknown> | null>(
      valueFor(riddleObject, "fallback_json", "fallback"),
      null,
      rowNumber,
      "fallback",
      errors,
      "object"
    );
    const accessibility = jsonValue<Record<string, unknown>>(
      valueFor(stationObject, "accessibility_json", "accessibility"),
      {},
      rowNumber,
      "accessibility",
      errors,
      "object"
    );
    const overrides = jsonValue<Record<string, unknown>>(
      valueFor(stopObject, "overrides_json", "overrides"),
      {},
      rowNumber,
      "overrides",
      errors,
      "object"
    );

    rows.push({
      station: {
        slug: stationSlug,
        brandKey: text(valueFor(stationObject, "brand_key", "brandKey")) || "tlv-quest",
        title: { he: stationTitleHe, en: stationTitleEn },
        description: {
          he: text(valueFor(stationObject, "station_description_he", "description_he")),
          en: text(valueFor(stationObject, "station_description_en", "description_en"))
        },
        address: {
          he: text(valueFor(stationObject, "address_he", "station_address_he")),
          en: text(valueFor(stationObject, "address_en", "station_address_en"))
        },
        latitude,
        longitude,
        radiusMeters,
        tags: list(valueFor(stationObject, "station_tags", "tags")),
        accessibility,
        fieldVerificationRequired: boolean(
          valueFor(
            stationObject,
            "field_verification_required",
            "fieldVerificationRequired"
          ),
          ["location", "finale"].includes(kind)
        ),
        status:
          text(valueFor(stationObject, "station_status")) === "active"
            ? "active"
            : "draft"
      },
      riddle: {
        slug: riddleSlug,
        title: { he: riddleTitleHe, en: riddleTitleEn },
        kind,
        content: {
          he: {
            title: riddleTitleHe,
            story: text(valueFor(riddleObject, "story_he", "riddle_story_he")),
            prompt: promptHe,
            locationHint: text(
              valueFor(riddleObject, "location_hint_he", "locationHintHe")
            ),
            success: text(valueFor(riddleObject, "success_he", "successHe"))
          },
          en: {
            title: riddleTitleEn,
            story: text(valueFor(riddleObject, "story_en", "riddle_story_en")),
            prompt: promptEn,
            locationHint: text(
              valueFor(riddleObject, "location_hint_en", "locationHintEn")
            ),
            success: text(valueFor(riddleObject, "success_en", "successEn"))
          }
        },
        validation,
        hints,
        scoring,
        fallback,
        interaction: {
          primary: kind === "photo" ? "photo" : "web",
          webFallback: true,
          requiresScan: kind === "scan" || kind === "hybrid"
        },
        tags: list(valueFor(riddleObject, "riddle_tags")),
        status:
          text(valueFor(riddleObject, "riddle_status")) === "active"
            ? "active"
            : "draft"
      },
      stop: {
        slug: stopSlug,
        isOptional: boolean(
          valueFor(stopObject, "is_optional", "isOptional"),
          false
        ),
        isActive: boolean(valueFor(stopObject, "is_active", "isActive"), true),
        overrides
      }
    });
  });

  const duplicateErrors = (
    values: string[],
    field: string,
    code: string
  ) => {
    const seen = new Map<string, number>();
    values.forEach((value, index) => {
      const first = seen.get(value);
      if (first !== undefined) {
        errors.push({
          row: index + 2,
          field,
          code,
          message: `${field} duplicates row ${first + 2}.`
        });
      } else {
        seen.set(value, index);
      }
    });
  };
  duplicateErrors(
    rows.map((row) => row.station.slug),
    "station_slug",
    "duplicate_station_slug"
  );
  duplicateErrors(
    rows.map((row) => row.stop.slug),
    "stop_slug",
    "duplicate_stop_slug"
  );

  const activeFinales = rows.filter(
    (row) => row.stop.isActive && row.riddle.kind === "finale"
  );
  if (activeFinales.length !== 1) {
    errors.push({
      row: null,
      field: "kind",
      code: "invalid_finale_count",
      message: "An import must contain exactly one active finale."
    });
  } else if (rows.at(-1) !== activeFinales[0]) {
    errors.push({
      row: null,
      field: "kind",
      code: "finale_not_last",
      message: "The finale must be the last row."
    });
  }

  return { rows, errors };
};

export const contentImportCsvTemplate = [
  "station_slug,station_title_he,station_title_en,riddle_slug,riddle_title_he,riddle_title_en,kind,prompt_he,prompt_en,accepted_answers,choice_options,accepted_option,photo_criteria,latitude,longitude,radius_meters,stop_slug,is_optional,is_active",
  'sample-station,תחנה לדוגמה,Sample station,sample-riddle,חידה לדוגמה,Sample riddle,text,"מה המפתח?","What is the key?",answer|תשובה,,,,32.1,34.8,45,sample-stop,false,true',
  'sample-finale,סיום,Finale,sample-finale-riddle,סיום,Finale,finale,"מה הקוד האחרון?","What is the final code?",final|סיום,,,,32.1,34.8,45,sample-finale,false,true'
].join("\n");
