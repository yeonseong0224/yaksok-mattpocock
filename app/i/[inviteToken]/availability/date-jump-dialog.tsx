"use client";

import { useState } from "react";
import { Button } from "@/app/_components/ui";
import { monthCells, WEEKDAYS } from "../calendar";
import { MonthHeader } from "../month-header";
import { useCloseOnEscape } from "../use-close-on-escape";

// 이동할 날짜 선택 팝업(Figma 13~15). 날짜를 누르면 그 주로 이동한다. 회색 날짜는 입력 범위 밖이다.
export function DateJumpDialog({
  initialMonth,
  rangeStart,
  rangeEnd,
  onPick,
  onClose,
}: {
  initialMonth: string;
  rangeStart: string;
  rangeEnd: string;
  onPick: (date: string) => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(initialMonth);
  useCloseOnEscape(onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="date-jump-title"
      className="fixed inset-0 z-20 flex items-end justify-center bg-ink/30 sm:items-center sm:px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[calc(100dvh-4.5rem)] w-full overflow-y-auto rounded-t-[20px] bg-surface p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-xl sm:max-h-none sm:max-w-md sm:rounded-2xl sm:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="date-jump-title" className="text-lg font-bold">
          이동할 날짜 선택
        </h2>
        <div className="mt-4 rounded-xl border border-line p-3">
          <MonthHeader month={month} onChange={setMonth} />
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1 text-xs text-muted">
                {d}
              </div>
            ))}
            {monthCells(month).map((date, i) =>
              date === null ? (
                <div key={`blank-${i}`} />
              ) : (
                <button
                  key={date}
                  type="button"
                  onClick={() => onPick(date)}
                  className={`h-10 rounded-lg text-sm hover:bg-brand/15 ${
                    date >= rangeStart && date <= rangeEnd
                      ? "bg-brand/10 text-ink"
                      : "text-muted/50"
                  }`}
                >
                  {Number(date.slice(8, 10))}
                </button>
              ),
            )}
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted">
          입력 가능 날짜: {rangeStart.replaceAll("-", ".")}–{rangeEnd.slice(5).replace("-", ".")}
          <br />
          회색 날짜는 입력 범위 밖이에요.
        </p>
        <Button variant="secondary" onClick={onClose} className="mt-4">
          닫기
        </Button>
      </div>
    </div>
  );
}
