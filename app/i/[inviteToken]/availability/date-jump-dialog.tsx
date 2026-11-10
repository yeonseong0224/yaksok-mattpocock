"use client";

import { useState } from "react";
import { Button } from "@/app/_components/ui";
import { monthCells, monthLabel, shiftMonth, WEEKDAYS } from "../calendar";
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
      className="fixed inset-0 z-20 flex items-center justify-center bg-ink/30 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="date-jump-title" className="text-lg font-bold">
          이동할 날짜 선택
        </h2>
        <div className="mt-4 rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center justify-between">
            <NavButton label="이전 달" onClick={() => setMonth(shiftMonth(month, -1))}>
              ‹
            </NavButton>
            <p className="text-lg font-bold">{monthLabel(month)}</p>
            <NavButton label="다음 달" onClick={() => setMonth(shiftMonth(month, 1))}>
              ›
            </NavButton>
          </div>
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

function NavButton({
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
