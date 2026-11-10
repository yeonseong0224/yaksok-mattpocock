import { isDateString, kstDate } from "@/lib/time";

// 가능 시간 슬롯의 형식·범위 판정(TIME-API-01 처리 순서 2·6)

/** 한 번에 받을 수 있는 슬롯 수(중복 정리 전 개수 기준) */
export const SLOT_LIMIT = 5000;

// PR #5(후보 계산)가 머지되면 lib/time.ts의 SLOT_MS·MINUTE_MS로 바꾼다.
const MINUTE_MS = 60_000;
const SLOT_MS = 30 * MINUTE_MS;
const KST_OFFSET_MS = 9 * 60 * MINUTE_MS;
const SLOT_ISO = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):(00|30):00(\.000)?\+09:00$/;

/** "2026-10-28T14:00:00+09:00" 형식의 슬롯 시작 시각을 epoch 밀리초로. 형식이 틀리면 null. */
export function parseSlot(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = SLOT_ISO.exec(value);
  if (!match || !isDateString(match[1])) return null;
  return Date.parse(value);
}

export type SlotRange = {
  dateRangeStart: string;
  dateRangeEnd: string;
  dailyStartMinute: number;
  dailyEndMinute: number;
};

/**
 * 슬롯이 약속의 날짜·하루 시간 범위 안에 있는가.
 * 한국 날짜가 날짜 범위 안이고, 시작 ≥ 하루 시작, 시작 + 30분 ≤ 하루 종료(24:00 = 1440분)여야 한다(ERD 5.1).
 */
export function isWithinRange(slotMs: number, range: SlotRange): boolean {
  const date = kstDate(new Date(slotMs));
  if (date < range.dateRangeStart || date > range.dateRangeEnd) return false;
  const minuteOfDay = Math.floor(((slotMs + KST_OFFSET_MS) % (24 * 60 * MINUTE_MS)) / MINUTE_MS);
  return (
    minuteOfDay >= range.dailyStartMinute &&
    minuteOfDay + SLOT_MS / MINUTE_MS <= range.dailyEndMinute
  );
}
