"use client";

import { Button } from "@/app/_components/ui";
import type { MinuteRange } from "@/lib/availability/day-edit";
import { minuteToHhmm } from "@/lib/time";

// 시작~종료 시간 구간 입력 줄(날짜별 시간 수정 시트, 반복 시트). 30분 단위, 하루 시간 범위 안에서 고른다.
// 구간마다 삭제 버튼, 맨 아래 "시간 추가". 값 검증은 쓰는 쪽(dayRangesError)이 한다.
export function RangeRows({
  ranges,
  onChange,
  dailyStartMinute,
  dailyEndMinute,
  emptyText,
}: {
  ranges: MinuteRange[];
  onChange: (ranges: MinuteRange[]) => void;
  dailyStartMinute: number;
  dailyEndMinute: number;
  /** 구간이 하나도 없을 때 보여줄 안내 */
  emptyText: string;
}) {
  const starts: number[] = [];
  for (let m = dailyStartMinute; m < dailyEndMinute; m += 30) starts.push(m);
  const ends = starts.map((m) => m + 30);

  const change = (index: number, part: keyof MinuteRange, value: number) =>
    onChange(ranges.map((r, i) => (i === index ? { ...r, [part]: value } : r)));

  /** 새 구간: 마지막 구간 뒤 1시간(하루 끝을 넘지 않게). 자리가 없으면 하루 시작부터 */
  function addRange() {
    const after = ranges.at(-1)?.end ?? dailyStartMinute;
    const start = after + 30 <= dailyEndMinute ? after : dailyStartMinute;
    onChange([...ranges, { start, end: Math.min(start + 60, dailyEndMinute) }]);
  }

  const selectClass =
    "h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-1.5 text-sm outline-none focus:ring-2 focus:ring-brand/30";

  return (
    <>
      {ranges.length === 0 ? (
        <p className="mt-3 rounded-lg border border-line bg-canvas p-3 text-xs text-muted">
          {emptyText}
        </p>
      ) : (
        <ul className="mt-2">
          {ranges.map((r, i) => (
            <li key={i} className="my-2 flex items-center gap-1.5">
              <select
                aria-label={`${i + 1}번째 시작 시간`}
                value={r.start}
                onChange={(e) => change(i, "start", Number(e.target.value))}
                className={selectClass}
              >
                {starts.map((m) => (
                  <option key={m} value={m}>
                    {minuteToHhmm(m)}
                  </option>
                ))}
              </select>
              <span className="text-muted">~</span>
              <select
                aria-label={`${i + 1}번째 종료 시간`}
                value={r.end}
                onChange={(e) => change(i, "end", Number(e.target.value))}
                className={selectClass}
              >
                {ends.map((m) => (
                  <option key={m} value={m}>
                    {m === 1440 ? "24:00" : minuteToHhmm(m)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`${i + 1}번째 시간 삭제`}
                onClick={() => onChange(ranges.filter((_, j) => j !== i))}
                className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-canvas"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden
                  className="h-5 w-5 fill-none stroke-current stroke-[1.7]"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" onClick={addRange} className="mt-2.5">
        ＋ 시간 추가
      </Button>
    </>
  );
}
