import {
  formatCheckpointMessage,
  type CheckpointMessageLocale
} from "./checkpoint-messages";

export type WhatsappRunStatus =
  | "draft"
  | "registration_open"
  | "ready"
  | "active"
  | "paused"
  | "finished"
  | "cancelled";

export type WhatsappTeamStatus =
  | "waiting"
  | "travelling"
  | "solving"
  | "finished"
  | "disqualified";

export type WhatsappGameContext = {
  joined_at: string;
  participant: {
    id: string;
    language: CheckpointMessageLocale;
  };
  run: {
    id: string;
    public_code: string;
    status: WhatsappRunStatus;
    scheduled_at: string | null;
    started_at: string | null;
    finished_at: string | null;
    retention_until: string | null;
  };
  team: null | {
    id: string;
    status: WhatsappTeamStatus;
    current_checkpoint_slug: string | null;
    score: number;
    completed_count: number;
    wrong_attempts: number;
    hints_used: number;
    started_at: string | null;
    finished_at: string | null;
    last_progress_at: string | null;
  };
  checkpoint_count: number;
  checkpoint: null | {
    id: string;
    slug: string;
    sequence_no: number;
    kind: string;
    content: Record<string, unknown>;
    validation: Record<string, unknown>;
    hints: unknown[];
    scoring: Record<string, unknown>;
    fallback_checkpoint: Record<string, unknown> | null;
    latitude: number | null;
    longitude: number | null;
    radius_meters: number | null;
  };
};

export type WhatsappContextResolution =
  | {
      kind: "none";
      requestedRunCode?: string;
    }
  | {
      kind: "ambiguous";
      locale: CheckpointMessageLocale;
      runCodes: string[];
    }
  | {
      kind: "resolved";
      context: WhatsappGameContext;
    };

export type WhatsappCommand = "status" | "mission" | "hint" | "start" | null;

export type ParsedWhatsappCommand = {
  command: WhatsappCommand;
  requestedRunCode?: string;
};

const commandPatterns: Array<{
  command: Exclude<WhatsappCommand, null>;
  aliases: string[];
}> = [
  { command: "status", aliases: ["status", "/status", "סטטוס"] },
  { command: "mission", aliases: ["mission", "/mission", "משימה"] },
  { command: "hint", aliases: ["hint", "/hint", "רמז", "עזרה"] },
  { command: "start", aliases: ["start", "/start", "התחל"] }
];

export const parseWhatsappCommand = (body: string): ParsedWhatsappCommand => {
  const normalized = body.trim().replace(/\s+/g, " ").toLocaleLowerCase("he-IL");

  for (const { command, aliases } of commandPatterns) {
    for (const alias of aliases) {
      if (normalized === alias) return { command };
      if (!normalized.startsWith(`${alias} `)) continue;

      const selector = normalized.slice(alias.length + 1).trim();
      if (/^[a-z0-9]{4,12}$/i.test(selector)) {
        return { command, requestedRunCode: selector.toUpperCase() };
      }
    }
  }

  return { command: null };
};

const timestamp = (value: string | null | undefined): number => {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const newestBy = (
  candidates: WhatsappGameContext[],
  dateFor: (candidate: WhatsappGameContext) => string | null | undefined
) =>
  [...candidates].sort((left, right) => {
    const leftDate = timestamp(dateFor(left));
    const rightDate = timestamp(dateFor(right));
    if (leftDate !== rightDate) return rightDate - leftDate;
    return timestamp(right.joined_at) - timestamp(left.joined_at);
  })[0];

const retainedFinished = (candidate: WhatsappGameContext, now: Date) =>
  candidate.run.status === "finished" &&
  (!candidate.run.retention_until ||
    timestamp(candidate.run.retention_until) > now.getTime());

export const resolveWhatsappContextCandidates = (
  candidates: WhatsappGameContext[],
  {
    requestedRunCode,
    now = new Date()
  }: {
    requestedRunCode?: string;
    now?: Date;
  } = {}
): WhatsappContextResolution => {
  const requestedCode = requestedRunCode?.trim().toUpperCase();
  if (requestedCode) {
    const selected = newestBy(
      candidates.filter(
        (candidate) =>
          candidate.run.public_code.toUpperCase() === requestedCode &&
          (candidate.run.status !== "finished" ||
            retainedFinished(candidate, now))
      ),
      (candidate) => candidate.joined_at
    );
    return selected
      ? { kind: "resolved", context: selected }
      : { kind: "none", requestedRunCode: requestedCode };
  }

  const live = candidates.filter((candidate) =>
    ["active", "paused"].includes(candidate.run.status)
  );
  if (live.length > 1) {
    const locale =
      newestBy(live, (candidate) => candidate.joined_at)?.participant.language ??
      "he";
    return {
      kind: "ambiguous",
      locale,
      runCodes: [...new Set(live.map((candidate) => candidate.run.public_code))].sort()
    };
  }
  if (live.length === 1) return { kind: "resolved", context: live[0] };

  const finished = candidates.filter((candidate) =>
    retainedFinished(candidate, now)
  );
  const latestFinished = newestBy(
    finished,
    (candidate) =>
      candidate.run.finished_at ??
      candidate.team?.finished_at ??
      candidate.joined_at
  );
  if (latestFinished) return { kind: "resolved", context: latestFinished };

  const notStarted = candidates.filter((candidate) =>
    ["draft", "registration_open", "ready"].includes(candidate.run.status)
  );
  const latestNotStarted = newestBy(
    notStarted,
    (candidate) => candidate.joined_at
  );
  if (latestNotStarted) return { kind: "resolved", context: latestNotStarted };

  const latestCancelled = newestBy(
    candidates.filter((candidate) => candidate.run.status === "cancelled"),
    (candidate) => candidate.joined_at
  );
  return latestCancelled
    ? { kind: "resolved", context: latestCancelled }
    : { kind: "none" };
};

export const formatWhatsappContextChoice = ({
  locale,
  runCodes
}: {
  locale: CheckpointMessageLocale;
  runCodes: string[];
}) => {
  const codes = runCodes.join(", ");
  return locale === "he"
    ? `מצאתי כמה משחקים חיים למספר הזה: ${codes}.\nכדי לבחור בלי לנחש, שלחו “סטטוס קוד”, למשל: סטטוס ${runCodes[0]}.`
    : `I found multiple live games for this number: ${codes}.\nChoose safely by sending “status CODE”, for example: status ${runCodes[0]}.`;
};

export const formatWhatsappContextNotFound = ({
  locale = "he",
  requestedRunCode
}: {
  locale?: CheckpointMessageLocale;
  requestedRunCode?: string;
}) => {
  if (requestedRunCode) {
    return locale === "he"
      ? `לא מצאתי הרשמה למספר הזה במשחק ${requestedRunCode}. בדקו את הקוד או פנו למארגן.`
      : `No registration for this number was found in game ${requestedRunCode}. Check the code or contact the organizer.`;
  }
  return "לא מצאתי הרשמה עדכנית למספר הזה. פתחו את קישור ההרשמה ושלחו PLAY עם קוד השחזור.\nNo current registration was found for this number.";
};

const localizedCheckpointTitle = (
  context: WhatsappGameContext,
  locale: CheckpointMessageLocale
) => {
  const localized = context.checkpoint?.content?.[locale];
  if (!localized || typeof localized !== "object" || Array.isArray(localized)) {
    return "";
  }
  const title = (localized as Record<string, unknown>).title;
  return typeof title === "string" ? title : "";
};

const progressText = (
  context: WhatsappGameContext,
  locale: CheckpointMessageLocale
) => {
  const score = context.team?.score ?? 0;
  const completed = context.team?.completed_count ?? 0;
  const total = context.checkpoint_count;
  const progress = total > 0 ? `${completed}/${total}` : String(completed);
  return locale === "he"
    ? `ניקוד: ${score} · התקדמות: ${progress}`
    : `Score: ${score} · Progress: ${progress}`;
};

const scheduledGuidance = (
  scheduledAt: string | null,
  locale: CheckpointMessageLocale
) => {
  if (!scheduledAt || !Number.isFinite(Date.parse(scheduledAt))) {
    return locale === "he"
      ? "המארגן ישלח את המשימה הראשונה עם תחילת המשחק."
      : "The organizer will release the first mission when the game starts.";
  }
  const formatted = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Jerusalem"
  }).format(new Date(scheduledAt));
  return locale === "he"
    ? `המועד המתוכנן הוא ${formatted}. המארגן יפעיל את המשחק.`
    : `The scheduled start is ${formatted}. The organizer will start the game.`;
};

export const isWhatsappContextPlayable = (context: WhatsappGameContext) =>
  context.run.status === "active" &&
  Boolean(context.checkpoint) &&
  Boolean(
    context.team &&
      ["travelling", "solving"].includes(context.team.status)
  );

export const formatWhatsappRunStatus = ({
  context,
  resumeLink
}: {
  context: WhatsappGameContext;
  resumeLink: string;
}) => {
  const locale = context.participant.language;
  const teamFinished = context.team?.status === "finished";

  if (teamFinished || context.run.status === "finished") {
    return locale === "he"
      ? `🎉 המסלול הושלם.\n${progressText(context, locale)}\n\nלתוצאות ולסיכום:\n${resumeLink}`
      : `🎉 The route is complete.\n${progressText(context, locale)}\n\nResults and recap:\n${resumeLink}`;
  }

  if (context.run.status === "cancelled") {
    return locale === "he"
      ? `המשחק בוטל. פנו למארגן לקבלת עדכון או קישור להרצה חלופית.\n\nממשק המשחק:\n${resumeLink}`
      : `This game was cancelled. Contact the organizer for an update or a replacement run.\n\nWeb game:\n${resumeLink}`;
  }

  if (
    ["draft", "registration_open", "ready"].includes(context.run.status)
  ) {
    return locale === "he"
      ? `המשחק עדיין לא התחיל.\n${scheduledGuidance(context.run.scheduled_at, locale)}\n\nממשק המשחק:\n${resumeLink}`
      : `The game has not started yet.\n${scheduledGuidance(context.run.scheduled_at, locale)}\n\nWeb game:\n${resumeLink}`;
  }

  if (context.run.status === "paused") {
    const sequence = context.checkpoint?.sequence_no;
    const title = localizedCheckpointTitle(context, locale);
    const current =
      sequence || title
        ? locale === "he"
          ? `התחנה הנוכחית נשמרה: ${sequence ? `תחנה ${sequence}` : ""}${title ? `${sequence ? " — " : ""}${title}` : ""}.`
          : `Your current checkpoint is preserved: ${sequence ? `checkpoint ${sequence}` : ""}${title ? `${sequence ? " — " : ""}${title}` : ""}.`
        : "";
    return locale === "he"
      ? `⏸️ המשחק מושהה כרגע וההתקדמות נשמרה.\n${current}\n${progressText(context, locale)}\n\nממשק המשחק:\n${resumeLink}`
      : `⏸️ The game is paused and your progress is preserved.\n${current}\n${progressText(context, locale)}\n\nWeb game:\n${resumeLink}`;
  }

  if (context.team?.status === "disqualified") {
    return locale === "he"
      ? `הצוות אינו פעיל עוד בהרצה הזאת. פנו למארגן לבירור.\n\nממשק המשחק:\n${resumeLink}`
      : `Your team is no longer active in this run. Contact the organizer for help.\n\nWeb game:\n${resumeLink}`;
  }

  const header =
    locale === "he"
      ? `המשחק פעיל.\n${progressText(context, locale)}`
      : `The game is active.\n${progressText(context, locale)}`;
  if (!context.checkpoint) {
    return locale === "he"
      ? `${header}\nאין כרגע משימה פעילה לצוות. פנו למארגן אם המסך לא מתעדכן.\n\nממשק המשחק:\n${resumeLink}`
      : `${header}\nThere is no current mission for the team. Contact the organizer if the screen does not update.\n\nWeb game:\n${resumeLink}`;
  }

  return `${header}\n\n${formatCheckpointMessage({
    contentValue: context.checkpoint.content,
    locale,
    sequenceNo: context.checkpoint.sequence_no,
    resumeLink
  })}`;
};
