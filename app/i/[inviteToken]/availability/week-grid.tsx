"use client";

import { addDays, kstMidnight } from "@/lib/time";
import { WEEKDAYS, weekday } from "../calendar";

// 주간 7일 격자(Figma 07·17). 세로는 하루 시간 범위의 30분 슬롯, 가로는 날짜.
// 격자 한 자리 = 슬롯 하나. 키는 슬롯 시작 시각(epoch 밀리초)이다.

// PR #5(후보 계산)가 머지되면 lib/time.ts의 MINUTE_MS로 바꾼다.
const MINUTE_MS = 60_000;

export type SlotView =
  | { kind: "outside" } // 날짜 범위 밖
  | { kind: "past"; selected: boolean; count: number } // serverTime 기준 지난 칸
  | { kind: "open"; selected: boolean; count: number };

export function WeekGrid({
  weekStart,
  dailyStartMinute,
  dailyEndMinute,
  mode,
  total,
  today,
  slotView,
  onToggle,
}: {
  /** 그 주 일요일(YYYY-MM-DD) */
  weekStart: string;
  dailyStartMinute: number;
  dailyEndMinute: number;
  /** mine: 내 가능 시간 선택, heatmap: 시간별 가능 인원 */
  mode: "mine" | "heatmap";
  total: number;
  today: string;
  slotView: (slotMs: number, date: string) => SlotView;
  onToggle?: (slotMs: number) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const minutes: number[] = [];
  for (let m = dailyStartMinute; m < dailyEndMinute; m += 30) minutes.push(m);

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <div
        role="grid"
        aria-label="주간 가능 시간표"
        className="grid min-w-[640px]"
        style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}
      >
        <div className="flex items-end border-b border-line px-2 pb-1 text-[11px] text-muted">
          KST
        </div>
        {days.map((date) => (
          <div
            key={date}
            role="columnheader"
            className={`border-b border-l border-line py-2 text-center text-sm ${
              date === today ? "bg-brand/10 font-medium text-brand-ink" : ""
            }`}
          >
            {WEEKDAYS[weekday(date)]} {Number(date.slice(8, 10))}
          </div>
        ))}

        {minutes.map((minute) => (
          <Row
            key={minute}
            minute={minute}
            days={days}
            mode={mode}
            total={total}
            slotView={slotView}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  minute,
  days,
  mode,
  total,
  slotView,
  onToggle,
}: {
  minute: number;
  days: string[];
  mode: "mine" | "heatmap";
  total: number;
  slotView: (slotMs: number, date: string) => SlotView;
  onToggle?: (slotMs: number) => void;
}) {
  const onHour = minute % 60 === 0;
  return (
    <>
      <div className="relative h-7 pr-2 text-right text-[11px] text-muted" aria-hidden>
        {onHour && <span className="absolute -top-2 right-2">{label(minute)}</span>}
      </div>
      {days.map((date) => {
        const slotMs = kstMidnight(date).getTime() + minute * MINUTE_MS;
        const view = slotView(slotMs, date);
        return (
          <SlotCell
            key={date}
            view={view}
            mode={mode}
            total={total}
            label={`${date} ${label(minute)}`}
            topBorder={onHour}
            onToggle={onToggle ? () => onToggle(slotMs) : undefined}
          />
        );
      })}
    </>
  );
}

function SlotCell({
  view,
  mode,
  total,
  label: slotLabel,
  topBorder,
  onToggle,
}: {
  view: SlotView;
  mode: "mine" | "heatmap";
  total: number;
  label: string;
  topBorder: boolean;
  onToggle?: () => void;
}) {
  const border = `border-l border-line ${topBorder ? "border-t" : "border-t border-t-line/40"}`;
  if (view.kind === "outside") {
    return <div className={`h-7 bg-canvas ${border}`} aria-label={`${slotLabel} 범위 밖`} />;
  }

  const past = view.kind === "past";
  if (mode === "heatmap") {
    const ratio = total > 0 ? view.count / total : 0;
    return (
      <div
        className={`flex h-7 items-center justify-center text-[11px] ${border} ${past ? "opacity-50" : ""}`}
        style={{
          backgroundColor: view.count > 0 ? `rgb(63 99 217 / ${0.15 + ratio * 0.75})` : undefined,
          color: ratio > 0.5 ? "white" : undefined,
        }}
        aria-label={`${slotLabel} ${view.count}/${total}명 가능`}
      >
        {view.count > 0 && `${view.count}/${total}명`}
      </div>
    );
  }

  const editable = !past && onToggle;
  return (
    <button
      type="button"
      disabled={!editable}
      aria-pressed={view.selected}
      aria-label={`${slotLabel}${view.selected ? " 가능" : ""}${past ? " 지난 시간" : ""}`}
      onClick={onToggle}
      className={`h-7 ${border} ${
        view.selected
          ? past
            ? "bg-brand/40"
            : "bg-brand hover:bg-brand-strong"
          : past
            ? "bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,rgb(0_0_0/0.04)_4px,rgb(0_0_0/0.04)_8px)]"
            : "hover:bg-brand/10"
      } disabled:cursor-not-allowed`}
    />
  );
}

function label(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
