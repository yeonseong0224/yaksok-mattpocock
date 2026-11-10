import { countGraphemes } from "@/lib/text";
import { addDays, addMinutes, isDateString, kstDate, kstMidnight } from "@/lib/time";

// 모집 시작 설정 검증(STATE-03-01, TIME-03-01·04-01~03·13-01·14-01/02).
// 판정 시각을 인자로 받는다. 라우트는 잠금 후 DB 시각을 넘기고, 화면은 같은 규칙으로 미리 확인한다.

export const TITLE_MAX_LENGTH = 30;
export const PARTICIPANT_LIMIT_MIN = 2;
export const PARTICIPANT_LIMIT_MAX = 30;
/** 날짜 범위는 양 끝 포함 최대 90일. 종료일 ≤ 시작일 + 89일 */
export const DATE_RANGE_MAX_DAYS = 90;
/** 마감은 처리 시각보다 이만큼 이상 뒤여야 한다(TIME-14-01) */
export const DEADLINE_MIN_LEAD_MINUTES = 30;

/** MVP 고정값(STATE-03-01): 하루 시간 범위 09:00~24:00, 약속 길이 2시간 */
export const MVP_DAILY_START_MINUTE = 540;
export const MVP_DAILY_END_MINUTE = 1440;
export const MVP_DURATION_MINUTES = 120;

const SLOT_MS = 30 * 60_000;
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export type StartSettingsInput = {
  title: string;
  participantLimit: number;
  dateRange: { startDate: string; endDate: string };
  votingDeadlineAt: string;
};

export type StartSettings = {
  title: string;
  participantLimit: number;
  dateRangeStart: string;
  dateRangeEnd: string;
  dailyStartMinute: number;
  dailyEndMinute: number;
  durationMinutes: number;
  votingDeadlineAt: Date;
};

export type SettingsField = "title" | "participantLimit" | "dateRange" | "votingDeadlineAt";
export type SettingsError = { field: SettingsField; message: string };

export type StartSettingsResult =
  { ok: true; settings: StartSettings } | { ok: false; errors: SettingsError[] };

/** 요청 본문이 모양(타입)만 맞는지 본다. 값 규칙은 `validateStartSettings`가 본다. 어긋나면 null. */
export function parseStartSettingsBody(body: Record<string, unknown>): StartSettingsInput | null {
  const { title, participantLimit, dateRange, votingDeadlineAt } = body;
  if (typeof title !== "string" || typeof participantLimit !== "number") return null;
  if (typeof votingDeadlineAt !== "string") return null;
  if (typeof dateRange !== "object" || dateRange === null) return null;
  const { startDate, endDate } = dateRange as Record<string, unknown>;
  if (typeof startDate !== "string" || typeof endDate !== "string") return null;
  return { title, participantLimit, dateRange: { startDate, endDate }, votingDeadlineAt };
}

export function validateStartSettings(input: StartSettingsInput, now: Date): StartSettingsResult {
  const errors: SettingsError[] = [];

  const title = input.title.trim();
  const titleLength = countGraphemes(title);
  if (titleLength < 1 || titleLength > TITLE_MAX_LENGTH) {
    errors.push({
      field: "title",
      message: `약속 이름은 1자 이상 ${TITLE_MAX_LENGTH}자 이하로 입력해 주세요.`,
    });
  }

  const { participantLimit } = input;
  if (
    !Number.isInteger(participantLimit) ||
    participantLimit < PARTICIPANT_LIMIT_MIN ||
    participantLimit > PARTICIPANT_LIMIT_MAX
  ) {
    errors.push({
      field: "participantLimit",
      message: `정원은 ${PARTICIPANT_LIMIT_MIN}명 이상 ${PARTICIPANT_LIMIT_MAX}명 이하로 정해 주세요.`,
    });
  }

  const { startDate, endDate } = input.dateRange;
  const rangeError = dateRangeError(startDate, endDate, now);
  if (rangeError) errors.push({ field: "dateRange", message: rangeError });

  const deadline = parseDeadline(input.votingDeadlineAt);
  // 마지막 날 00:00과의 비교는 날짜 범위가 올바를 때만 한다(같은 원인으로 오류가 두 번 나지 않게).
  const lastDayMidnight = rangeError ? null : kstMidnight(endDate);
  const deadlineError = votingDeadlineError(deadline, lastDayMidnight, now);
  if (deadlineError) errors.push({ field: "votingDeadlineAt", message: deadlineError });

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    settings: {
      title,
      participantLimit,
      dateRangeStart: startDate,
      dateRangeEnd: endDate,
      dailyStartMinute: MVP_DAILY_START_MINUTE,
      dailyEndMinute: MVP_DAILY_END_MINUTE,
      durationMinutes: MVP_DURATION_MINUTES,
      votingDeadlineAt: deadline!,
    },
  };
}

/** 달력에서 시작일로 고를 수 있는 날짜인가(오늘 이후, TIME-04-01) */
export function canStartOn(date: string, now: Date): boolean {
  return isDateString(date) && date >= kstDate(now);
}

/** 시작일을 고른 뒤 종료일로 고를 수 있는 날짜인가. 모집 시작 검증과 같은 규칙이다. */
export function canEndOn(startDate: string, date: string, now: Date): boolean {
  return dateRangeError(startDate, date, now) === null;
}

function dateRangeError(startDate: string, endDate: string, now: Date): string | null {
  if (!isDateString(startDate) || !isDateString(endDate)) return "날짜를 다시 골라 주세요.";
  if (startDate < kstDate(now)) return "시작일은 오늘 이후로 골라 주세요.";
  if (endDate < startDate) return "종료일은 시작일보다 앞설 수 없어요.";
  if (endDate > addDays(startDate, DATE_RANGE_MAX_DAYS - 1)) {
    return `날짜 범위는 최대 ${DATE_RANGE_MAX_DAYS}일까지 고를 수 있어요.`;
  }
  // 마감은 "지금 + 30분 이상"이고 "마지막 날 00:00 미만"인 30분 경계여야 한다. 그런 시각이 하나라도 있어야
  // 종료일로 고를 수 있다: 가장 이른 마감 후보(지금 + 30분을 30분 단위로 올림)가 00:00보다 앞(TIME-14-02 보충).
  if (earliestVotingDeadline(now) >= kstMidnight(endDate)) {
    return "종료일은 내일 이후로 골라 주세요. 마감을 정할 시간이 필요해요.";
  }
  return null;
}

/** 고를 수 있는 가장 이른 마감: 지금 + 30분을 30분 단위로 올린 시각(TIME-13-01, TIME-14-01) */
function earliestVotingDeadline(now: Date): Date {
  return roundUpToSlot(addMinutes(now, DEADLINE_MIN_LEAD_MINUTES));
}

function roundUpToSlot(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / SLOT_MS) * SLOT_MS);
}

function parseDeadline(value: string): Date | null {
  if (!ISO_WITH_OFFSET.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function votingDeadlineError(deadline: Date | null, lastDayMidnight: Date | null, now: Date) {
  if (!deadline) return "마감 날짜와 시각을 다시 골라 주세요.";
  if (deadline.getTime() % SLOT_MS !== 0) return "마감 시각은 30분 단위로 골라 주세요.";
  if (deadline < addMinutes(now, DEADLINE_MIN_LEAD_MINUTES)) {
    return `마감은 지금부터 ${DEADLINE_MIN_LEAD_MINUTES}분 이상 뒤로 정해 주세요.`;
  }
  if (lastDayMidnight && deadline >= lastDayMidnight) {
    return "마감은 날짜 범위 마지막 날 00:00보다 앞이어야 해요.";
  }
  return null;
}

/**
 * 마감 기본값(TIME-13-02): 지금 + 24시간을 30분 단위로 올림. 마지막 날 00:00 이후면 그 직전 30분 경계.
 * 종료일을 아직 고르지 않았으면 올림 값만 돌려준다.
 */
export function defaultVotingDeadline(now: Date, endDate: string | null): Date {
  const roundedUp = roundUpToSlot(addMinutes(now, 24 * 60));
  if (!endDate) return roundedUp;
  const latest = new Date(kstMidnight(endDate).getTime() - SLOT_MS);
  return roundedUp > latest ? latest : roundedUp;
}
