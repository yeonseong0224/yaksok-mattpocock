"use client";

import { useState, type PointerEvent } from "react";
import { addDays, kstMidnight, MINUTE_MS } from "@/lib/time";
import { WEEKDAYS, weekday } from "../calendar";

// 주간 7일 격자(Figma 07·17). 세로는 하루 시간 범위의 30분 슬롯, 가로는 날짜.
// 격자 한 자리 = 슬롯 하나. 키는 슬롯 시작 시각(epoch 밀리초)이다.
//
// 드래그 선택(Figma 상호작용 규칙, 티켓 07):
// - 처음 누른 슬롯이 비어 있으면 추가, 선택돼 있으면 해제한다.
// - 누른 곳과 지금 포인터가 있는 곳을 꼭짓점으로 하는 사각 범위(날짜 × 시간)에 적용한다.
// - 포인터 캡처를 써서 포인터가 격자 밖으로 나가도 놓는 순간 끝난다. 한 번 누르고 떼면 슬롯 하나만 바뀐다.

export type SlotView =
  | { kind: "outside" } // 날짜 범위 밖
  | { kind: "past"; selected: boolean; count: number } // serverTime 기준 지난 슬롯
  | { kind: "open"; selected: boolean; count: number };

type Point = { day: number; row: number };
type Drag = { anchor: Point; current: Point; add: boolean };

export function WeekGrid({
  weekStart,
  dailyStartMinute,
  dailyEndMinute,
  mode,
  total,
  today,
  slotView,
  onSelect,
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
  /** 슬롯들을 한꺼번에 추가(add=true)하거나 해제한다. 없으면 읽기 전용이다. */
  onSelect?: (slots: number[], add: boolean) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const minutes: number[] = [];
  for (let m = dailyStartMinute; m < dailyEndMinute; m += 30) minutes.push(m);

  const slotAt = ({ day, row }: Point) =>
    kstMidnight(days[day]).getTime() + minutes[row] * MINUTE_MS;
  const viewAt = (point: Point) => slotView(slotAt(point), days[point.day]);
  const selectable = mode === "mine" && onSelect !== undefined;

  function inDrag(point: Point): boolean {
    if (!drag) return false;
    const [d0, d1] = [drag.anchor.day, drag.current.day].sort((a, b) => a - b);
    const [r0, r1] = [drag.anchor.row, drag.current.row].sort((a, b) => a - b);
    return point.day >= d0 && point.day <= d1 && point.row >= r0 && point.row <= r1;
  }

  function finishDrag() {
    if (!drag || !onSelect) return setDrag(null);
    const slots: number[] = [];
    for (let day = 0; day < days.length; day++) {
      for (let row = 0; row < minutes.length; row++) {
        const point = { day, row };
        // 지난 슬롯과 범위 밖은 바꾸지 않는다.
        if (inDrag(point) && viewAt(point).kind === "open") slots.push(slotAt(point));
      }
    }
    onSelect(slots, drag.add);
    setDrag(null);
  }

  function pointFrom(target: EventTarget | null): Point | null {
    const el =
      target instanceof Element ? target.closest<HTMLElement>("[data-day][data-row]") : null;
    if (!el) return null;
    return { day: Number(el.dataset.day), row: Number(el.dataset.row) };
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!selectable || e.button !== 0) return;
    const point = pointFrom(e.target);
    if (!point) return;
    const view = viewAt(point);
    if (view.kind !== "open") return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ anchor: point, current: point, add: !view.selected });
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    // 포인터를 캡처하면 이벤트 대상이 격자로 고정되므로, 좌표로 아래에 있는 슬롯을 찾는다.
    const point = pointFrom(document.elementFromPoint(e.clientX, e.clientY));
    if (point && (point.day !== drag.current.day || point.row !== drag.current.row)) {
      setDrag({ ...drag, current: point });
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <div
        role="grid"
        aria-label="주간 가능 시간표"
        className={`grid min-w-[640px] ${selectable ? "select-none" : ""}`}
        style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={() => setDrag(null)}
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

        {minutes.map((minute, row) => (
          <div key={minute} role="row" className="contents">
            <div className="relative h-7 pr-2 text-right text-[11px] text-muted" aria-hidden>
              {minute % 60 === 0 && (
                <span className="absolute -top-2 right-2">{label(minute)}</span>
              )}
            </div>
            {days.map((date, day) => {
              const point = { day, row };
              const view = viewAt(point);
              // 드래그 중에는 놓았을 때의 결과를 미리 보여준다.
              const preview =
                view.kind === "open" && drag && inDrag(point)
                  ? { ...view, selected: drag.add }
                  : view;
              return (
                <SlotCell
                  key={date}
                  day={day}
                  row={row}
                  view={preview}
                  mode={mode}
                  total={total}
                  label={`${date} ${label(minute)}`}
                  topBorder={minute % 60 === 0}
                  onKeyboardToggle={
                    selectable && view.kind === "open"
                      ? () => onSelect!([slotAt(point)], !view.selected)
                      : undefined
                  }
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function SlotCell({
  day,
  row,
  view,
  mode,
  total,
  label: slotLabel,
  topBorder,
  onKeyboardToggle,
}: {
  day: number;
  row: number;
  view: SlotView;
  mode: "mine" | "heatmap";
  total: number;
  label: string;
  topBorder: boolean;
  /** 키보드(Enter·Space)로 슬롯 하나를 바꾼다. 마우스·터치는 격자의 드래그가 처리한다. */
  onKeyboardToggle?: () => void;
}) {
  const border = `border-l border-line ${topBorder ? "border-t" : "border-t border-t-line/40"}`;
  const position = { "data-day": day, "data-row": row };
  if (view.kind === "outside") {
    return (
      <div
        role="gridcell"
        className={`h-7 bg-canvas ${border}`}
        aria-label={`${slotLabel} 범위 밖`}
        {...position}
      />
    );
  }

  const past = view.kind === "past";
  if (mode === "heatmap") {
    const ratio = total > 0 ? view.count / total : 0;
    return (
      <div
        role="gridcell"
        className={`flex h-7 items-center justify-center text-[11px] ${border} ${past ? "opacity-50" : ""}`}
        style={{
          backgroundColor: view.count > 0 ? `rgb(63 99 217 / ${0.15 + ratio * 0.75})` : undefined,
          color: ratio > 0.5 ? "white" : undefined,
        }}
        aria-label={`${slotLabel} ${view.count}/${total}명 가능`}
        {...position}
      >
        {view.count > 0 && `${view.count}/${total}명`}
      </div>
    );
  }

  return (
    <button
      type="button"
      role="gridcell"
      disabled={!onKeyboardToggle}
      aria-selected={view.selected}
      aria-label={`${slotLabel}${view.selected ? " 가능" : ""}${past ? " 지난 시간" : ""}`}
      // 마우스 클릭은 드래그(한 슬롯짜리)로 처리되므로, 키보드로 누른 경우(detail 0)만 여기서 바꾼다.
      onClick={(e) => e.detail === 0 && onKeyboardToggle?.()}
      {...position}
      className={`h-7 ${onKeyboardToggle ? "touch-none" : ""} ${border} ${
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
