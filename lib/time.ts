const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** API 응답용 시각 표기: ISO 8601, 밀리초 3자리, `+09:00`. 예: `2026-10-11T12:10:00.000+09:00` */
export function toKstIso(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().replace("Z", "+09:00");
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}
