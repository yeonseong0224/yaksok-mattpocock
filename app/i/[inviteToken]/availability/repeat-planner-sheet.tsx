"use client";

import { useState } from "react";
import { Button } from "@/app/_components/ui";
import {
  datesOnWeekdays,
  dayRangesError,
  planDayRanges,
  type MinuteRange,
} from "@/lib/availability/day-edit";
import type { RepeatPlan } from "@/lib/availability/repeat";
import type { SlotRange } from "@/lib/availability/slots";
import { dayLabel, monthCells, shortDateLabel, WEEKDAYS } from "../calendar";
import { MonthHeader } from "../month-header";
import { BottomSheet } from "./bottom-sheet";
import { RangeRows } from "./range-rows";

// 모바일 "반복" 버튼 시트(vote-ui-extras 04). 원본 날짜를 복사하는 대신, 넣을 시간(구간 여러 개)과
// 날짜(매주 요일 + 기간, 또는 달력에서 여러 날짜)를 직접 고른다. 적용하면 제출 전 선택에 합집합으로 더해진다.

/** 미리보기에 날짜를 보여줄 최대 개수. 나머지는 "외 N개"로 줄인다. */
const PREVIEW_DATES = 5;
/** 고른 시간이 없을 때 처음 보여줄 구간 18:00~20:00(하루 시간 범위 안으로 맞춘다) */
const DEFAULT_RANGE: MinuteRange = { start: 18 * 60, end: 20 * 60 };

export function RepeatPlannerSheet({
  selected,
  initialRanges,
  range,
  now,
  today,
  onApply,
  onClose,
}: {
  selected: Set<number>;
  /** 처음 보여줄 시간 구간. 비어 있으면 18:00~20:00 */
  initialRanges: MinuteRange[];
  range: SlotRange;
  /** 서버 시각(serverTime) */
  now: number;
  /** 서버 시각 기준 한국 날짜 */
  today: string;
  onApply: (plan: RepeatPlan) => void;
  onClose: () => void;
}) {
  const firstDate = today > range.dateRangeStart ? today : range.dateRangeStart;
  const [ranges, setRanges] = useState<MinuteRange[]>(() =>
    initialRanges.length > 0 ? initialRanges : [clampRange(DEFAULT_RANGE, range)],
  );
  const [mode, setMode] = useState<"weekly" | "dates">("weekly");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [from, setFrom] = useState(firstDate);
  const [until, setUntil] = useState(range.dateRangeEnd);
  const [picked, setPicked] = useState<string[]>([]);
  const [month, setMonth] = useState(`${firstDate.slice(0, 7)}-01`);

  const rangesError = dayRangesError(ranges);
  const dates = mode === "weekly" ? datesOnWeekdays(from, until, weekdays) : picked;
  const plan = rangesError
    ? { dates: [], slots: [] }
    : planDayRanges({ selected, dates, ranges, range, now });
  const pickable = (date: string) => date >= firstDate && date <= range.dateRangeEnd;
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  const hidden = plan.dates.length - PREVIEW_DATES;

  return (
    <BottomSheet
      title="가능 시간 반복"
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button disabled={plan.dates.length === 0} onClick={() => onApply(plan)}>
            {plan.dates.length === 0 ? "반복 적용" : `${plan.dates.length}개 날짜에 적용`}
          </Button>
        </>
      }
    >
      <p className="text-xs leading-5 text-muted">
        넣을 시간과 날짜를 고르면, 고른 날짜마다 그 시간이 더해져요.
      </p>

      <h3 className="mt-4 text-[13px] font-semibold">시간</h3>
      <RangeRows
        ranges={ranges}
        onChange={setRanges}
        dailyStartMinute={range.dailyStartMinute}
        dailyEndMinute={range.dailyEndMinute}
        emptyText="넣을 시간을 추가해 주세요."
      />
      {rangesError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {rangesError}
        </p>
      )}

      <h3 className="mt-5 text-[13px] font-semibold">날짜</h3>
      <div
        role="tablist"
        className="mt-2 grid h-11 grid-cols-2 gap-0.75 rounded-[10px] bg-line/70 p-0.75"
      >
        {(["weekly", "dates"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-[7px] text-[13px] ${mode === m ? "bg-surface font-semibold text-brand-ink shadow-sm" : "text-muted"}`}
          >
            {m === "weekly" ? "매주 요일로" : "달력에서"}
          </button>
        ))}
      </div>

      {mode === "weekly" ? (
        <>
          <div className="mt-3 grid grid-cols-7 gap-1" role="group" aria-label="반복할 요일">
            {WEEKDAYS.map((name, day) => {
              const on = weekdays.includes(day);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setWeekdays(toggle(weekdays, day))}
                  className={`h-11 rounded-lg border text-sm ${on ? "border-brand/60 bg-brand/10 font-semibold text-brand-ink" : "border-line"}`}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <label className="sr-only" htmlFor="repeat-from">
              시작일
            </label>
            <input
              id="repeat-from"
              type="date"
              value={from}
              min={firstDate}
              max={range.dateRangeEnd}
              onChange={(e) => setFrom(e.target.value || firstDate)}
              className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm"
            />
            <span className="text-muted">~</span>
            <label className="sr-only" htmlFor="repeat-until">
              종료일
            </label>
            <input
              id="repeat-until"
              type="date"
              value={until}
              min={from}
              max={range.dateRangeEnd}
              onChange={(e) => setUntil(e.target.value || range.dateRangeEnd)}
              className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm"
            />
          </div>
        </>
      ) : (
        <div className="mt-3 rounded-xl border border-line p-2">
          <MonthHeader month={month} onChange={setMonth} />
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1 text-[10px] text-muted">
                {d}
              </div>
            ))}
            {monthCells(month).map((date, i) => {
              if (date === null) return <div key={`blank-${i}`} />;
              const on = picked.includes(date);
              return (
                <button
                  key={date}
                  type="button"
                  disabled={!pickable(date)}
                  aria-pressed={on}
                  aria-label={dayLabel(date)}
                  onClick={() => setPicked(toggle(picked, date))}
                  className={`h-10 rounded-md text-sm disabled:cursor-not-allowed disabled:text-muted/40 ${
                    on ? "bg-brand font-semibold text-white" : "hover:bg-brand/10"
                  }`}
                >
                  {Number(date.slice(8, 10))}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p
        aria-live="polite"
        className="mt-4 rounded-lg border border-line bg-canvas p-3 text-[11px] leading-5 text-muted"
      >
        {plan.dates.length === 0 ? (
          dates.length === 0 ? (
            "반복할 날짜나 요일을 골라 주세요."
          ) : (
            "고른 날짜에 더할 시간이 없어요(이미 골랐거나 지난 시간)."
          )
        ) : (
          <>
            <b className="font-semibold text-brand-ink">{plan.dates.length}개 날짜에 추가</b> ·{" "}
            {plan.dates
              .slice(0, PREVIEW_DATES)
              .map((d) => shortDateLabel(d.date))
              .join(", ")}
            {hidden > 0 && ` 외 ${hidden}개`}
          </>
        )}
        <br />
        기존 시간은 그대로 두고, 겹치는 시간은 한 번만 더해요.
      </p>
    </BottomSheet>
  );
}

/** 구간을 하루 시간 범위 안으로 맞춘다. 맞출 수 없으면 하루 시작부터 1시간 */
function clampRange(r: MinuteRange, range: SlotRange): MinuteRange {
  const start = Math.max(r.start, range.dailyStartMinute);
  const end = Math.min(r.end, range.dailyEndMinute);
  if (start < end) return { start, end };
  const s = range.dailyStartMinute;
  return { start: s, end: Math.min(s + 60, range.dailyEndMinute) };
}
