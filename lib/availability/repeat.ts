import { addDays, kstDate, kstMidnight, SLOT_MS, weekday } from "@/lib/time";
import { isWithinRange, type SlotRange } from "./slots";

// 가능 시간 반복 적용(vote-ui-extras 01, Figma 09~12). 원본 날짜에 고른 가능 시간을 다른 날짜에 복사한다.
// 클라이언트에서 제출 전 선택에만 더하는 계산이라 서버 규칙은 바뀌지 않는다. 날짜는 한국 날짜 YYYY-MM-DD,
// 슬롯은 시작 시각(epoch 밀리초)이다.

/** 이어진 시간 구간 [start, end), epoch 밀리초 */
export type TimeRange = { start: number; end: number };

/** 그 날짜(KST)에 고른 슬롯(오름차순) */
function slotsOn(selected: Iterable<number>, date: string): number[] {
  return [...selected].filter((ms) => kstDate(new Date(ms)) === date).sort((a, b) => a - b);
}

/** 그 날짜에 고른 슬롯을 이어진 구간으로 묶는다. 반복 메뉴·팝업의 시간 표시에 쓴다. */
export function slotRanges(selected: Iterable<number>, date: string): TimeRange[] {
  const ranges: TimeRange[] = [];
  for (const slot of slotsOn(selected, date)) {
    const last = ranges.at(-1);
    if (last && last.end === slot) last.end = slot + SLOT_MS;
    else ranges.push({ start: slot, end: slot + SLOT_MS });
  }
  return ranges;
}

/** 주간 반복 대상: 원본 다음 날부터 종료일까지, 고른 요일(0 = 일요일)의 날짜 */
export function weeklyDates(source: string, weekdays: number[], until: string): string[] {
  const dates: string[] = [];
  for (let date = addDays(source, 1); date <= until; date = addDays(date, 1)) {
    if (weekdays.includes(weekday(date))) dates.push(date);
  }
  return dates;
}

export type RepeatPlan = {
  /** 새로 더해지는 시간이 있는 대상 날짜(오름차순)와 그날 더해질 슬롯 */
  dates: { date: string; slots: number[] }[];
  /** 더할 슬롯 전체(오름차순). 기존 선택에 합집합으로 더한다. */
  slots: number[];
};

/**
 * 원본 날짜에 고른 시간을 대상 날짜마다 같은 시각으로 복사한 결과.
 * 원본 날짜, 날짜·하루 시간 범위 밖, 지난 슬롯(시작 ≤ 현재, TIME-08-01), 이미 고른 슬롯은 뺀다.
 */
export function planRepeat({
  selected,
  source,
  targets,
  range,
  now,
}: {
  selected: Iterable<number>;
  source: string;
  targets: string[];
  range: SlotRange;
  /** 서버 시각(serverTime) */
  now: number;
}): RepeatPlan {
  const already = new Set(selected);
  const sourceStart = kstMidnight(source).getTime();
  const offsets = slotsOn(already, source).map((ms) => ms - sourceStart);
  const dates: RepeatPlan["dates"] = [];
  for (const date of [...new Set(targets)].sort()) {
    if (date === source) continue;
    const start = kstMidnight(date).getTime();
    const slots = offsets
      .map((offset) => start + offset)
      .filter((slot) => slot > now && isWithinRange(slot, range) && !already.has(slot));
    if (slots.length > 0) dates.push({ date, slots });
  }
  return { dates, slots: dates.flatMap((d) => d.slots) };
}
