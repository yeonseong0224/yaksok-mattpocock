import { kstDate, kstMidnight, MINUTE_MS, SLOT_MS } from "@/lib/time";
import { slotRanges } from "./repeat";
import { isWithinRange, type SlotRange } from "./slots";

// 모바일 날짜별 시간 수정 시트. 날짜를 누르면 그날 고른 시간을 시작·종료 구간으로 보여주고,
// 고친 구간으로 그날의 선택을 바꿔 쓴다. 제출 전 선택에만 적용하는 클라이언트 계산이다.

/** 하루 안의 구간 [start, end), 0시부터의 분. end는 최대 1440(24:00) */
export type MinuteRange = { start: number; end: number };

const SLOT_MINUTES = SLOT_MS / MINUTE_MS;

/** 그날 고른 슬롯을 이어진 분 구간으로 묶는다. */
export function dayMinuteRanges(selected: Iterable<number>, date: string): MinuteRange[] {
  const midnight = kstMidnight(date).getTime();
  return slotRanges(selected, date).map(({ start, end }) => ({
    start: (start - midnight) / MINUTE_MS,
    end: (end - midnight) / MINUTE_MS,
  }));
}

/** 적용할 수 없는 구간이 있으면 안내 문구, 없으면 null */
export function dayRangesError(ranges: MinuteRange[]): string | null {
  return ranges.some((r) => r.end <= r.start) ? "종료 시간은 시작 시간보다 늦어야 해요." : null;
}

/**
 * 그날의 선택을 ranges로 바꿔 쓴 새 선택.
 * 고칠 수 있는 슬롯(지나지 않았고 날짜·하루 시간 범위 안)만 빼고 더한다. 지난 슬롯은 그대로 둔다(TIME-08-01).
 */
export function applyDayRanges({
  selected,
  date,
  ranges,
  range,
  now,
}: {
  selected: Iterable<number>;
  date: string;
  ranges: MinuteRange[];
  range: SlotRange;
  /** 서버 시각(serverTime) */
  now: number;
}): Set<number> {
  const editable = (slot: number) => slot > now && isWithinRange(slot, range);
  const next = new Set(selected);
  for (const slot of next) {
    if (kstDate(new Date(slot)) === date && editable(slot)) next.delete(slot);
  }
  const midnight = kstMidnight(date).getTime();
  for (const { start, end } of ranges) {
    for (let minute = start; minute < end; minute += SLOT_MINUTES) {
      const slot = midnight + minute * MINUTE_MS;
      if (editable(slot)) next.add(slot);
    }
  }
  return next;
}
