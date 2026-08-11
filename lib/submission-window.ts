import type { WeekRow } from "@/types/supabase";

export const SUBMISSION_FUTURE_SKEW_MS = 10 * 60 * 1000;

export type SubmissionWindowState =
  | "before-open"
  | "active"
  | "final-stretch"
  | "closed"
  | "unavailable"
  | "future";

export type SubmissionWindowResult = {
  accepted: boolean;
  code:
    | "DETECTED_AT_IN_FUTURE"
    | "WEEK_CLOSED_AT_DETECTION"
    | "WEEK_NOT_OPEN_AT_DETECTION"
    | "WEEK_WINDOW_UNAVAILABLE"
    | null;
  forceHidden: boolean;
  state: SubmissionWindowState;
};

type HistoricalWeekWindow = Pick<
  WeekRow,
  "final_deadline_at" | "public_freeze_at" | "public_start_at"
>;

function timestamp(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unavailable(): SubmissionWindowResult {
  return {
    accepted: false,
    code: "WEEK_WINDOW_UNAVAILABLE",
    forceHidden: false,
    state: "unavailable",
  };
}

/**
 * Projects the immutable competitive window at the moment the score was
 * detected. Current week status and server receipt time are deliberately
 * excluded from this decision.
 */
export function deriveSubmissionWindowAt(
  week: HistoricalWeekWindow,
  detectedAt: string,
  options: { futureSkewMs?: number; now?: Date | number | string } = {},
): SubmissionWindowResult {
  const startAt = timestamp(week.public_start_at);
  const freezeAt = timestamp(week.public_freeze_at);
  const deadlineAt = timestamp(week.final_deadline_at);
  const detectedAtMs = Date.parse(detectedAt);
  const nowMs =
    options.now instanceof Date
      ? options.now.getTime()
      : typeof options.now === "number"
        ? options.now
        : Date.parse(options.now ?? new Date().toISOString());
  const futureSkewMs = Number.isFinite(options.futureSkewMs)
    ? Math.max(0, Number(options.futureSkewMs))
    : SUBMISSION_FUTURE_SKEW_MS;

  if (
    startAt === null ||
    deadlineAt === null ||
    !Number.isFinite(detectedAtMs) ||
    !Number.isFinite(nowMs) ||
    startAt > deadlineAt ||
    (freezeAt !== null && (freezeAt < startAt || freezeAt > deadlineAt))
  ) {
    return unavailable();
  }

  if (detectedAtMs > nowMs + futureSkewMs) {
    return {
      accepted: false,
      code: "DETECTED_AT_IN_FUTURE",
      forceHidden: false,
      state: "future",
    };
  }

  if (detectedAtMs < startAt) {
    return {
      accepted: false,
      code: "WEEK_NOT_OPEN_AT_DETECTION",
      forceHidden: false,
      state: "before-open",
    };
  }

  if (detectedAtMs >= deadlineAt) {
    return {
      accepted: false,
      code: "WEEK_CLOSED_AT_DETECTION",
      forceHidden: false,
      state: "closed",
    };
  }

  if (freezeAt !== null && detectedAtMs >= freezeAt) {
    return {
      accepted: true,
      code: null,
      forceHidden: true,
      state: "final-stretch",
    };
  }

  return {
    accepted: true,
    code: null,
    forceHidden: false,
    state: "active",
  };
}
