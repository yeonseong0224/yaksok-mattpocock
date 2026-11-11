"use client";

import { useState } from "react";
import { addDays } from "@/lib/time";
import { dayLabel, monthCells, shiftMonth, WEEKDAYS } from "../calendar";
import { MonthButton } from "../month-header";

// 약속 정보의 월간 달력(Figma 07 PromiseSidebar, 모바일 PromiseSlide / 열림).
// ‹ ›는 한 달씩 이동하고, 월 제목을 누르면 날짜 이동 팝업을 연다(Figma 상호작용 규칙 「월 / 주 이동」).
// 날짜를 누르면 그 주로 이동한다. 날짜 범위 밖은 회색이고 고를 수 없다. 오늘은 테두리, 보고 있는 주는 옅은 색.
export function MiniCalendar({
  initialMonth,
  rangeStart,
  rangeEnd,
  today,
  weekStart,
  onPickDate,
  onOpenJump,
}: {
  /** YYYY-MM-01 */
  initialMonth: string;
  rangeStart: string;
  rangeEnd: string;
  today: string;
  /** 주간표에서 보고 있는 주의 일요일 */
  weekStart: string;
  onPickDate: (date: string) => void;
  /** 월 제목을 누르면 날짜 이동 팝업을 연다. 인자는 지금 보고 있는 달(YYYY-MM-01). */
  onOpenJump: (month: string) => void;
}) {
  const [month, setMonth] = useState(initialMonth);
  const weekEnd = addDays(weekStart, 6);

  return (
    <div className="rounded-xl border border-line bg-surface p-2">
      <div className="mb-1 flex items-center justify-between">
        <MonthButton label="이전 달" onClick={() => setMonth(shiftMonth(month, -1))}>
          ‹
        </MonthButton>
        <button
          type="button"
          onClick={() => onOpenJump(month)}
          aria-label={`${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월 · 이동할 날짜 선택 열기`}
          className="h-9 rounded-md px-2 text-sm font-medium hover:bg-canvas"
        >
          {month.slice(0, 4)}.{month.slice(5, 7)}
        </button>
        <MonthButton label="다음 달" onClick={() => setMonth(shiftMonth(month, 1))}>
          ›
        </MonthButton>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1 text-[11px] text-muted">
            {d}
          </div>
        ))}
        {monthCells(month).map((date, i) => {
          if (date === null) return <div key={`blank-${i}`} className="h-8 rounded-md bg-canvas" />;
          const inRange = date >= rangeStart && date <= rangeEnd;
          const inWeek = date >= weekStart && date <= weekEnd;
          return (
            <button
              key={date}
              type="button"
              disabled={!inRange}
              onClick={() => onPickDate(date)}
              aria-label={`${dayLabel(date)}${date === today ? " 오늘" : ""} 주로 이동`}
              aria-current={inWeek ? "date" : undefined}
              className={`h-8 rounded-md text-sm disabled:cursor-not-allowed disabled:text-muted/40 ${
                date === today ? "border border-brand text-brand-ink" : ""
              } ${inWeek && inRange ? "bg-brand/10" : "hover:bg-canvas"}`}
            >
              {Number(date.slice(8, 10))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
