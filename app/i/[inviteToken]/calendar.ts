import { addDays } from "@/lib/time";

// 달력·주간표가 함께 쓰는 날짜 계산. 날짜는 한국 날짜 YYYY-MM-DD 문자열이다.

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 요일(0 = 일요일) */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

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
