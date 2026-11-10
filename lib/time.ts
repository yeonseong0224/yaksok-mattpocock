const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** API 응답용 시각 표기: ISO 8601, 밀리초 3자리, `+09:00`. 예: `2026-10-11T12:10:00.000+09:00` */
export function toKstIso(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().replace("Z", "+09:00");
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** 한국 기준 날짜(YYYY-MM-DD). '오늘'은 서버 시각을 Asia/Seoul로 바꾼 날짜다(TIME-03-01). */
export function kstDate(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-DD 날짜의 00:00(KST) 시점 */
export function kstMidnight(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - KST_OFFSET_MS);
}

/** YYYY-MM-DD 날짜에 일수를 더한다. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 실제로 있는 날짜의 YYYY-MM-DD 문자열인가(2026-11-31은 아니다) */
export function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** 하루 시작부터의 분 값을 HH:mm으로. 1440은 24:00이다. */
export function minuteToHhmm(minute: number): string {
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** "HH:mm"을 하루 시작부터의 분으로. "24:00"은 1440이다(minuteToHhmm의 반대). */
export function hhmmToMinute(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}
