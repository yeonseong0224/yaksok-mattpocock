"use client";

import { useState } from "react";
import { Button } from "@/app/_components/ui";
import { dayRangesError, type MinuteRange } from "@/lib/availability/day-edit";
import { minuteToHhmm } from "@/lib/time";
import { dayLabel } from "../calendar";
import { BottomSheet } from "./bottom-sheet";

// 날짜별 시간 수정 시트(모바일 시간표 개편). 모바일 시간표에서 날짜를 누르면 열린다.
// 그날 고른 시간을 시작·종료 구간으로 보여주고, 구간을 고치거나 더하거나 지운 뒤 "적용하기"로 그날 선택을 바꿔 쓴다.
// 적용은 제출 전 선택에만 반영되고(이 브라우저에 임시 저장), 제출해야 서버에 저장된다.
export function DayEditSheet({
  date,
  initialRanges,
  dailyStartMinute,
  dailyEndMinute,
  hasPast,
  onApply,
  onClose,
}: {
  date: string;
  initialRanges: MinuteRange[];
  dailyStartMinute: number;
  dailyEndMinute: number;
  /** 그날 지난 시간이 있는가(지난 시간은 적용해도 바뀌지 않는다고 알린다) */
  hasPast: boolean;
  onApply: (ranges: MinuteRange[]) => void;
  onClose: () => void;
}) {
  const [ranges, setRanges] = useState(initialRanges);
  const [error, setError] = useState<string | null>(null);

  const starts: number[] = [];
  for (let m = dailyStartMinute; m < dailyEndMinute; m += 30) starts.push(m);
  const ends = starts.map((m) => m + 30);

  function change(index: number, part: keyof MinuteRange, value: number) {
    setRanges(ranges.map((r, i) => (i === index ? { ...r, [part]: value } : r)));
    setError(null);
  }

  /** 새 구간: 마지막 구간 뒤 1시간(하루 끝을 넘지 않게). 자리가 없으면 하루 시작부터 */
  function addRange() {
    const after = ranges.at(-1)?.end ?? dailyStartMinute;
    const start = after + 30 <= dailyEndMinute ? after : dailyStartMinute;
    setRanges([...ranges, { start, end: Math.min(start + 60, dailyEndMinute) }]);
    setError(null);
  }

  function apply() {
    const message = dayRangesError(ranges);
    if (message) return setError(message);
    onApply(ranges);
  }

  const selectClass =
    "h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-1.5 text-sm outline-none focus:ring-2 focus:ring-brand/30";

  return (
    <BottomSheet
      title={`${dayLabel(date)} 시간 수정`}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button onClick={apply}>적용하기</Button>
        </>
      }
    >
      <p className="text-xs leading-5 text-muted">시작·종료 시간을 직접 선택할 수 있어요.</p>
      {ranges.length === 0 ? (
        <p className="mt-3 rounded-lg border border-line bg-canvas p-3 text-xs text-muted">
          아직 선택한 시간이 없어요.
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
                onClick={() => {
                  setRanges(ranges.filter((_, j) => j !== i));
                  setError(null);
                }}
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
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
      <p className="mt-3.5 rounded-lg border border-line bg-canvas p-3 text-[11px] leading-5 text-muted">
        적용한 뒤 &lsquo;가능 시간 제출&rsquo;을 눌러야 저장돼요.
        {hasPast && (
          <>
            <br />
            지난 시간은 바뀌지 않아요.
          </>
        )}
      </p>
    </BottomSheet>
  );
}
