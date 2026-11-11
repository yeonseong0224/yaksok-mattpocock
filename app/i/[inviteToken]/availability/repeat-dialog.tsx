"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/app/_components/ui";
import { planRepeat, slotRanges, weeklyDates, type RepeatPlan } from "@/lib/availability/repeat";
import type { SlotRange } from "@/lib/availability/slots";
import { addDays, MINUTE_MS } from "@/lib/time";
import {
  clockRangesLabel,
  dayLabel,
  durationLabel,
  monthCells,
  shortDateLabel,
  weekday,
  WEEKDAYS,
} from "../calendar";
import { MonthHeader } from "../month-header";
import { useCloseOnEscape } from "../use-close-on-escape";
import type { RepeatMode } from "./repeat-menu";

// 가능 시간 반복 팝업(Figma 10·11). 원본 날짜에 고른 시간을 주간 반복(요일 + 종료일)이나
// 특정 날짜(달력에서 여러 날짜 토글)로 복사한다. 적용하면 제출 전 내 선택에 합집합으로 더해진다.

/** 미리보기에 날짜별 시간을 보여줄 최대 개수. 나머지는 "외 N개"로 줄인다. */
const PREVIEW_DATES = 5;

export function RepeatDialog({
  source,
  selected,
  range,
  now,
  today,
  initialMode,
  onApply,
  onClose,
}: {
  source: string;
  selected: Set<number>;
  range: SlotRange;
  /** 서버 시각(serverTime) */
  now: number;
  /** 서버 시각 기준 한국 날짜 */
  today: string;
  initialMode: RepeatMode;
  onApply: (plan: RepeatPlan) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [weekdays, setWeekdays] = useState<number[]>([weekday(source)]);
  const [until, setUntil] = useState(range.dateRangeEnd);
  const [picked, setPicked] = useState<string[]>([]);
  const [month, setMonth] = useState(`${source.slice(0, 7)}-01`);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useCloseOnEscape(onClose);
  useEffect(() => titleRef.current?.focus(), []);

  const ranges = slotRanges(selected, source);
  const totalMinutes = ranges.reduce((sum, r) => sum + (r.end - r.start) / MINUTE_MS, 0);
  // 범위 밖·지난 시간은 planRepeat가 뺀다.
  const targets = mode === "weekly" ? weeklyDates(source, weekdays, until) : picked;
  const plan = planRepeat({ selected, source, targets, range, now });

  // 특정 날짜: 범위 안, 원본이 아닌, 오늘 이후 날짜만 고를 수 있다.
  const pickable = (date: string) =>
    date !== source && date >= today && date >= range.dateRangeStart && date <= range.dateRangeEnd;
  const togglePicked = (date: string) =>
    setPicked((prev) => (prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]));
  const toggleWeekday = (day: number) =>
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));

  const hiddenCount = plan.dates.length - PREVIEW_DATES;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="repeat-title"
      className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-6 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="repeat-title"
            ref={titleRef}
            tabIndex={-1}
            className="text-lg font-bold outline-none"
          >
            가능 시간 반복 사용
          </h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-brand-ink hover:bg-canvas"
          >
            ✕
          </button>
        </div>

        <p className="mt-4 text-sm font-medium">원본 날짜 · {dayLabel(source)}</p>
        <div className="mt-2 rounded-xl bg-brand/10 px-4 py-4 text-center text-sm text-brand-ink">
          {clockRangesLabel(ranges)} · {durationLabel(totalMinutes)}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-canvas p-1" role="tablist">
          <ModeTab active={mode === "weekly"} onClick={() => setMode("weekly")}>
            주간 반복
          </ModeTab>
          <ModeTab active={mode === "dates"} onClick={() => setMode("dates")}>
            특정 날짜 반복
          </ModeTab>
        </div>

        {mode === "weekly" ? (
          <div className="mt-4">
            <p className="text-sm font-medium" id="repeat-weekdays">
              반복할 요일
            </p>
            <div
              className="mt-2 grid grid-cols-7 gap-1"
              role="group"
              aria-labelledby="repeat-weekdays"
            >
              {WEEKDAYS.map((name, day) => {
                const on = weekdays.includes(day);
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleWeekday(day)}
                    className={`h-10 rounded-lg text-sm ${on ? "bg-brand text-white" : "hover:bg-canvas"}`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
            <label className="mt-4 block text-sm font-medium" htmlFor="repeat-until">
              반복 종료일
            </label>
            <input
              id="repeat-until"
              type="date"
              value={until}
              min={addDays(source, 1)}
              max={range.dateRangeEnd}
              onChange={(e) => setUntil(e.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm"
            />
            <p className="mt-2 text-xs text-muted">
              {weekdays.length === 0
                ? "반복할 요일을 골라 주세요."
                : `선택 범위 안에서 매주 ${[...weekdays]
                    .sort((a, b) => a - b)
                    .map((d) => WEEKDAYS[d])
                    .join("·")}요일에 반복해요.`}
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-line p-3">
            <MonthHeader month={month} onChange={setMonth} />
            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-1 text-xs text-muted">
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
                    aria-label={`${dayLabel(date)}${date === source ? " 원본 날짜" : ""}`}
                    onClick={() => togglePicked(date)}
                    className={`h-10 rounded-lg text-sm disabled:cursor-not-allowed ${
                      on
                        ? "bg-brand text-white"
                        : date === source
                          ? "border border-brand text-brand-ink"
                          : "hover:bg-canvas disabled:text-muted/40 disabled:hover:bg-transparent"
                    }`}
                  >
                    {Number(date.slice(8, 10))}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-4" aria-live="polite">
          {plan.dates.length === 0 ? (
            <p className="text-sm font-medium text-brand-ink">추가할 날짜가 없어요.</p>
          ) : (
            <>
              <p className="text-sm font-medium text-brand-ink">
                {plan.dates.length}개 날짜에 추가 ·{" "}
                {plan.dates.map((d) => shortDateLabel(d.date)).join(", ")}
              </p>
              <ul className="mt-2 flex flex-col gap-1 rounded-lg bg-canvas px-3 py-2 text-xs text-ink">
                {plan.dates.slice(0, PREVIEW_DATES).map(({ date, slots }) => (
                  <li key={date}>
                    {dayLabel(date)} · {clockRangesLabel(slotRanges(slots, date))}
                  </li>
                ))}
                {hiddenCount > 0 && <li className="text-muted">외 {hiddenCount}개 날짜</li>}
              </ul>
            </>
          )}
        </div>
        <p className="mt-2 text-xs leading-5 text-muted">
          기존 시간은 유지되며 겹치는 시간은 중복 추가되지 않아요. 지난 시간과 범위 밖 시간은
          빠져요.
        </p>

        <div className="mt-4 grid grid-cols-[1fr_2fr] gap-2">
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button disabled={plan.dates.length === 0} onClick={() => onApply(plan)}>
            {plan.dates.length === 0 ? "적용" : `${plan.dates.length}개 날짜에 적용`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`h-9 rounded-md text-sm ${active ? "bg-surface font-medium text-brand-ink shadow-sm" : "text-muted"}`}
    >
      {children}
    </button>
  );
}
