import type { TimeRange } from "@/lib/availability/repeat";
import { addDays, toKstIso, weekday } from "@/lib/time";

export { weekday };

// 달력·주간표가 함께 쓰는 날짜 계산. 날짜는 한국 날짜 YYYY-MM-DD 문자열이다.

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 그 날짜가 들어 있는 주의 일요일 */
export function weekStartOf(date: string): string {
  return addDays(date, -weekday(date));
}

/** 그 달의 날짜 칸. 1일 앞의 빈칸은 null. month는 YYYY-MM-01 */
export function monthCells(month: string): (string | null)[] {
  const cells: (string | null)[] = Array.from({ length: weekday(month) }, () => null);
  for (let date = month; date.slice(0, 7) === month.slice(0, 7); date = addDays(date, 1)) {
    cells.push(date);
  }
  return cells;
}

/** YYYY-MM-01을 delta개월 옮긴다. */
export function shiftMonth(month: string, delta: number): string {
  const d = new Date(`${month}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 10);
}

export function monthLabel(month: string): string {
  return `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월`;
}

/** "12월 1일 (화)" — 한국 날짜 YYYY-MM-DD를 화면 표기로 */
export function dayLabel(date: string): string {
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 (${WEEKDAYS[weekday(date)]})`;
}

/** "12월 1일 (화) 14:00–16:00". 끝이 다음 날 00:00이면 24:00으로 쓴다. 시각은 epoch 밀리초. */
export function timeRangeLabel(startMs: number, endMs: number): string {
  const { start, end } = clockRange(startMs, endMs);
  return `${dayLabel(toKstIso(new Date(startMs)).slice(0, 10))} ${start}–${end}`;
}

/** 시작·끝의 한국 시각 "HH:mm". 끝이 다음 날 00:00이면 24:00으로 쓴다. */
export function clockRange(startMs: number, endMs: number): { start: string; end: string } {
  const start = toKstIso(new Date(startMs)).slice(11, 16);
  const end = toKstIso(new Date(endMs)).slice(11, 16);
  return { start, end: end === "00:00" ? "24:00" : end };
}

/** "18:00–19:30, 20:00–21:00" — 이어진 시간 구간들을 한국 시각으로 */
export function clockRangesLabel(ranges: TimeRange[]): string {
  return ranges
    .map(({ start, end }) => {
      const c = clockRange(start, end);
      return `${c.start}–${c.end}`;
    })
    .join(", ");
}

/** "10/13" — 한국 날짜 YYYY-MM-DD를 짧게 */
export function shortDateLabel(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** 분을 "1시간 30분"처럼 */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h}시간` : "", m > 0 ? `${m}분` : ""].filter(Boolean).join(" ");
}
