"use client";

import { useState } from "react";
import { monthCells, monthLabel, shiftMonth, WEEKDAYS } from "./calendar";

// 월간 달력에서 시작일·종료일을 클릭해 날짜 범위를 고른다(Figma 01·02, TIME-04-01~03).
// 첫 클릭은 시작일, 두 번째 클릭은 종료일. 고를 수 없는 날짜는 비활성으로 보인다.

export type DateRange = { startDate: string | null; endDate: string | null };

export function RangeCalendar({
  value,
  onChange,
  isSelectableStart,
  isSelectableEnd,
  initialMonth,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  isSelectableStart: (date: string) => boolean;
  /** 시작일을 고른 뒤 종료일로 고를 수 있는 날짜인가 */
  isSelectableEnd: (startDate: string, date: string) => boolean;
  /** YYYY-MM-01 */
  initialMonth: string;
}) {
  const [month, setMonth] = useState(initialMonth);
  const pickingEnd = value.startDate !== null && value.endDate === null;

  function pick(date: string) {
    if (pickingEnd && value.startDate && isSelectableEnd(value.startDate, date)) {
      onChange({ startDate: value.startDate, endDate: date });
    } else if (isSelectableStart(date)) {
      onChange({ startDate: date, endDate: null });
    }
  }

  // 종료일을 고르는 중에는 종료일로 쓸 수 없는 날짜(시작일 + 90일 이후 등)를 비활성으로 둔다.
  // 시작일보다 앞 날짜만 새 시작일로 다시 고를 수 있다.
  function enabled(date: string) {
    if (pickingEnd && value.startDate) {
      return (
        isSelectableEnd(value.startDate, date) ||
        (date < value.startDate && isSelectableStart(date))
      );
    }
    return isSelectableStart(date);
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <MonthButton label="이전 달" onClick={() => setMonth(shiftMonth(month, -1))}>
          ‹
        </MonthButton>
        <p className="text-lg font-bold" aria-live="polite">
          {monthLabel(month)}
        </p>
        <MonthButton label="다음 달" onClick={() => setMonth(shiftMonth(month, 1))}>
          ›
        </MonthButton>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center" role="grid">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1 text-xs text-muted">
            {d}
          </div>
        ))}
        {monthCells(month).map((date, i) =>
          date === null ? (
            <div key={`blank-${i}`} />
          ) : (
            <DayCell
              key={date}
              date={date}
              disabled={!enabled(date)}
              tone={toneOf(date, value)}
              onClick={() => pick(date)}
            />
          ),
        )}
      </div>
    </div>
  );
}

function MonthButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-lg text-brand-ink hover:bg-canvas"
    >
      {children}
    </button>
  );
}

type Tone = "edge" | "inside" | "none";

function DayCell({
  date,
  disabled,
  tone,
  onClick,
}: {
  date: string;
  disabled: boolean;
  tone: Tone;
  onClick: () => void;
}) {
  const look =
    tone === "edge"
      ? "bg-brand text-white"
      : tone === "inside"
        ? "bg-brand/15 text-ink"
        : disabled
          ? "text-muted/40"
          : "text-ink hover:bg-canvas";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={tone !== "none"}
      aria-label={date}
      className={`h-10 rounded-lg text-sm disabled:cursor-not-allowed ${look}`}
    >
      {Number(date.slice(8, 10))}
    </button>
  );
}

function toneOf(date: string, { startDate, endDate }: DateRange): Tone {
  if (date === startDate || date === endDate) return "edge";
  if (startDate && endDate && date > startDate && date < endDate) return "inside";
  return "none";
}
