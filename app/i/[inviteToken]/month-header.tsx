"use client";

import { monthLabel, shiftMonth } from "./calendar";

/** 월간 달력 머리: ‹ 2026년 10월 ›. month는 YYYY-MM-01 */
export function MonthHeader({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <MonthButton label="이전 달" onClick={() => onChange(shiftMonth(month, -1))}>
        ‹
      </MonthButton>
      <p className="text-lg font-bold" aria-live="polite">
        {monthLabel(month)}
      </p>
      <MonthButton label="다음 달" onClick={() => onChange(shiftMonth(month, 1))}>
        ›
      </MonthButton>
    </div>
  );
}

/** 달력의 ‹ › 버튼 */
export function MonthButton({
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
