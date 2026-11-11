"use client";

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { addDays, kstMidnight, MINUTE_MS } from "@/lib/time";
import { WEEKDAYS, weekday } from "../calendar";

// 주간 7일 격자(Figma 07·17). 세로는 하루 시간 범위의 30분 슬롯, 가로는 날짜.
// 격자 한 자리 = 슬롯 하나. 키는 슬롯 시작 시각(epoch 밀리초)이다.
//
// 드래그 선택(Figma 상호작용 규칙, 티켓 07):
// - 처음 누른 슬롯이 비어 있으면 추가, 선택돼 있으면 해제한다.
// - 누른 곳과 지금 포인터가 있는 곳을 꼭짓점으로 하는 사각 범위(날짜 × 시간)에 적용한다.
// - 포인터 캡처를 써서 포인터가 격자 밖으로 나가도 놓는 순간 끝난다. 한 번 누르고 떼면 슬롯 하나만 바뀐다.
//
// 터치(Figma 23·24, vote-ui-extras 02):
// - 선택 모드에서는 터치 드래그가 위와 같이 선택하고, 스크롤 모드에서는 화면이 움직인다(슬롯을 바꾸지 않는다).
// - 날짜 열(머리글·슬롯)을 2초 동안 누르고 있으면 그 날짜의 반복 메뉴가 열린다. 데스크톱의 우클릭에 해당한다.

export type SlotView =
  | { kind: "outside" } // 날짜 범위 밖
  | { kind: "past"; selected: boolean; count: number } // serverTime 기준 지난 슬롯
  | { kind: "open"; selected: boolean; count: number };

type Point = { day: number; row: number };

/**
 * 큰 시간 블록(TIME-09-02, 2026-11-10 결정): 날짜마다 오전·오후·저녁.
 * 하루 시간 범위 밖의 슬롯은 블록에 넣지 않는다.
 */
const DAY_BLOCKS = [
  { name: "오전", from: 0, to: 12 * 60 },
  { name: "오후", from: 12 * 60, to: 18 * 60 },
  { name: "저녁", from: 18 * 60, to: 24 * 60 },
] as const;

/** 고를 수 있는 슬롯 중 선택된 정도. 일부 선택은 전체 선택과 다르게 보인다(TIME-09-03). */
type Coverage = "none" | "partial" | "full" | "unavailable";
type Drag = { anchor: Point; current: Point; add: boolean };

/** 터치 조작 모드. select: 드래그로 슬롯 선택, scroll: 화면 이동 */
export type TouchMode = "select" | "scroll";
/** 반복 메뉴를 연 방법. mouse는 우클릭·메뉴 키, touch는 길게 누르기 */
export type RepeatTrigger = "mouse" | "touch";

/** 길게 누르기로 반복 메뉴를 여는 시간 */
const LONG_PRESS_MS = 2000;
/** 이만큼 움직이면 길게 누르기가 아니라 드래그·스크롤로 본다 */
const LONG_PRESS_SLOP_PX = 10;

export function WeekGrid({
  weekStart,
  dailyStartMinute,
  dailyEndMinute,
  mode,
  total,
  today,
  slotView,
  onSelect,
  onInspect,
  onRepeatMenu,
  touchMode,
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
  /** 히트맵에서 슬롯을 누르면 그 시간의 상세(누가 가능한지)를 연다. */
  onInspect?: (slotMs: number) => void;
  /**
   * 날짜 열(머리글·슬롯)을 우클릭하면 그 날짜의 반복 메뉴를 연다(Figma 09).
   * origin은 메뉴를 닫을 때 포커스를 돌려줄 요소다.
   */
  onRepeatMenu?: (
    date: string,
    at: { x: number; y: number },
    origin: HTMLElement,
    trigger: RepeatTrigger,
  ) => void;
  touchMode: TouchMode;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  // 길게 누르기 진행 상태. 타이머가 울리기 전에 떼거나 움직이면 취소한다.
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  // 길게 누르기로 메뉴를 연 직후 손을 떼면 머리글 click이 따라오는데, 그 click은 무시한다.
  const suppressClick = useRef(false);
  // Android는 길게 누르면 contextmenu를 보낸다. 터치에서 온 것은 우클릭 메뉴로 열지 않는다.
  const lastPointerType = useRef<PointerEvent["pointerType"]>("mouse");
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const minutes: number[] = [];
  for (let m = dailyStartMinute; m < dailyEndMinute; m += 30) minutes.push(m);

  const slotAt = ({ day, row }: Point) =>
    kstMidnight(days[day]).getTime() + minutes[row] * MINUTE_MS;
  const viewAt = (point: Point) => slotView(slotAt(point), days[point.day]);
  const selectable = mode === "mine" && onSelect !== undefined;

  // 누르는 중에 주를 옮기거나 탭을 바꾸거나 격자가 사라지면 길게 누르기를 취소한다.
  useEffect(
    () => () => {
      if (press.current) window.clearTimeout(press.current.timer);
      press.current = null;
    },
    [weekStart, selectable],
  );

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

  /** 그날 rows 안의 고를 수 있는(지나지 않은, 범위 안) 슬롯과 그 선택 정도 */
  function openSlotsOf(day: number, rows: number[]) {
    const slots: number[] = [];
    let selected = 0;
    for (const row of rows) {
      const view = viewAt({ day, row });
      if (view.kind !== "open") continue;
      slots.push(slotAt({ day, row }));
      if (view.selected) selected++;
    }
    const coverage: Coverage =
      slots.length === 0
        ? "unavailable"
        : selected === 0
          ? "none"
          : selected === slots.length
            ? "full"
            : "partial";
    return { slots, coverage };
  }

  /** 날짜·블록을 누르면: 일부만 또는 하나도 선택돼 있지 않으면 전체 선택, 전체 선택돼 있으면 전체 해제(TIME-09-04) */
  function toggleGroup(day: number, rows: number[]) {
    const { slots, coverage } = openSlotsOf(day, rows);
    if (slots.length > 0) onSelect?.(slots, coverage !== "full");
  }

  const allRows = minutes.map((_, row) => row);
  const rowsIn = (from: number, to: number) =>
    allRows.filter((row) => minutes[row] >= from && minutes[row] < to);

  function pointFrom(target: EventTarget | null): Point | null {
    const el =
      target instanceof Element ? target.closest<HTMLElement>("[data-day][data-row]") : null;
    if (!el) return null;
    return { day: Number(el.dataset.day), row: Number(el.dataset.row) };
  }

  function cancelPress() {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  }

  /** 반복 메뉴를 닫을 때 포커스를 돌려줄 곳: 누른 버튼, 안 되면(범위 밖·지난 슬롯) 그날 머리글 버튼, 그것도 안 되면 격자 */
  function repeatOrigin(target: Element, grid: HTMLElement, day: string): HTMLElement {
    const enabledButton = (el: Element | null) =>
      el instanceof HTMLButtonElement && !el.disabled ? el : null;
    return (
      enabledButton(target.closest("button")) ??
      enabledButton(grid.querySelector(`[role=columnheader][data-day="${day}"] button`)) ??
      grid
    );
  }

  function startPress(e: PointerEvent<HTMLDivElement>) {
    cancelPress();
    if (!onRepeatMenu || !(e.target instanceof Element)) return;
    const column = e.target.closest<HTMLElement>("[data-day]");
    if (!column) return;
    const { clientX: x, clientY: y } = e;
    const target = e.target;
    const grid = e.currentTarget;
    const timer = window.setTimeout(() => {
      press.current = null;
      setDrag(null); // 누르는 동안 시작된 드래그는 없던 일로 한다.
      suppressClick.current = true;
      navigator.vibrate?.(15);
      const day = column.dataset.day!;
      onRepeatMenu(days[Number(day)], { x, y }, repeatOrigin(target, grid, day), "touch");
    }, LONG_PRESS_MS);
    press.current = { timer, x, y };
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    lastPointerType.current = e.pointerType;
    suppressClick.current = false;
    if (!selectable || e.button !== 0) return;
    const touch = e.pointerType !== "mouse";
    if (touch) startPress(e);
    // 스크롤 모드의 터치는 화면 이동에 맡기고 슬롯을 바꾸지 않는다.
    if (touch && touchMode === "scroll") return;
    const point = pointFrom(e.target);
    if (!point) return;
    const view = viewAt(point);
    if (view.kind !== "open") return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ anchor: point, current: point, add: !view.selected });
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (
      press.current &&
      Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > LONG_PRESS_SLOP_PX
    ) {
      cancelPress();
    }
    if (!drag) return;
    // 포인터를 캡처하면 이벤트 대상이 격자로 고정되므로, 좌표로 아래에 있는 슬롯을 찾는다.
    const point = pointFrom(document.elementFromPoint(e.clientX, e.clientY));
    if (point && (point.day !== drag.current.day || point.row !== drag.current.row)) {
      setDrag({ ...drag, current: point });
    }
  }

  function onContextMenu(e: MouseEvent<HTMLDivElement>) {
    if (!selectable || !onRepeatMenu) return;
    const column = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-day]") : null;
    if (!column) return;
    e.preventDefault();
    // 터치의 길게 누르기는 startPress가 2초 기준으로 따로 연다.
    // 키보드(메뉴 키·Shift+F10)로 열면 좌표가 0이다.
    const fromKeyboard = e.clientX === 0 && e.clientY === 0;
    if (lastPointerType.current !== "mouse" && !fromKeyboard) return;
    const origin = repeatOrigin(e.target as Element, e.currentTarget, column.dataset.day!);
    // 키보드로 열면 요소 위치에 연다.
    const rect = origin.getBoundingClientRect();
    const at = fromKeyboard ? { x: rect.left, y: rect.bottom } : { x: e.clientX, y: e.clientY };
    onRepeatMenu(days[Number(column.dataset.day)], at, origin, "mouse");
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <div
        role="grid"
        tabIndex={-1}
        aria-label="주간 가능 시간표"
        className={`grid min-w-[640px] outline-none ${selectable ? "select-none [-webkit-touch-callout:none]" : ""}`}
        style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          cancelPress();
          finishDrag();
        }}
        onPointerCancel={() => {
          cancelPress();
          setDrag(null);
        }}
        onClickCapture={(e) => {
          // 길게 눌러 메뉴를 연 뒤 따라오는 click은 날짜·블록 선택으로 처리하지 않는다.
          if (suppressClick.current) {
            suppressClick.current = false;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
        onContextMenu={onContextMenu}
      >
        <div className="flex items-end border-b border-line px-2 pb-1 text-[11px] text-muted">
          KST
        </div>
        {days.map((date, day) => {
          const heading = `${WEEKDAYS[weekday(date)]} ${Number(date.slice(8, 10))}`;
          if (!selectable) {
            return (
              <div
                key={date}
                role="columnheader"
                className={`border-b border-l border-line py-2 text-center text-sm ${
                  date === today ? "bg-brand/10 font-medium text-brand-ink" : ""
                }`}
              >
                {heading}
              </div>
            );
          }
          // 날짜를 누르면 그날 전체, 블록을 누르면 그 블록만(TIME-09-01·09-02).
          const whole = openSlotsOf(day, allRows).coverage;
          return (
            <div
              key={date}
              role="columnheader"
              data-day={day}
              className="border-b border-l border-line p-1"
            >
              <GroupButton
                coverage={whole}
                label={`${date} 하루 전체`}
                onClick={() => toggleGroup(day, allRows)}
                className={`h-8 w-full text-sm ${date === today && whole === "none" ? "font-medium text-brand-ink" : ""}`}
              >
                {heading}
              </GroupButton>
              <div className="mt-1 grid grid-cols-3 gap-0.5">
                {DAY_BLOCKS.map((block) => {
                  const rows = rowsIn(block.from, block.to);
                  if (rows.length === 0) return <span key={block.name} />;
                  return (
                    <GroupButton
                      key={block.name}
                      coverage={openSlotsOf(day, rows).coverage}
                      label={`${date} ${block.name}`}
                      onClick={() => toggleGroup(day, rows)}
                      className="h-6 text-[11px]"
                    >
                      {block.name}
                    </GroupButton>
                  );
                })}
              </div>
            </div>
          );
        })}

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
                  onInspect={onInspect ? () => onInspect(slotAt(point)) : undefined}
                  touchSelect={selectable && touchMode === "select"}
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

function GroupButton({
  coverage,
  label: groupLabel,
  onClick,
  className,
  children,
}: {
  coverage: Coverage;
  label: string;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}) {
  const look =
    coverage === "full"
      ? "bg-brand text-white hover:bg-brand-strong"
      : coverage === "partial"
        ? "bg-brand/20 text-brand-ink hover:bg-brand/30"
        : coverage === "none"
          ? "hover:bg-brand/10"
          : "text-muted/50";
  const state = {
    full: "전체 선택됨",
    partial: "일부 선택됨",
    none: "선택 안 됨",
    unavailable: "고를 수 없음",
  }[coverage];
  return (
    <button
      type="button"
      disabled={coverage === "unavailable"}
      onClick={onClick}
      aria-label={`${groupLabel} ${state}`}
      className={`rounded-md disabled:cursor-not-allowed ${look} ${className}`}
    >
      {children}
    </button>
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
  onInspect,
  onKeyboardToggle,
  touchSelect,
}: {
  day: number;
  row: number;
  view: SlotView;
  mode: "mine" | "heatmap";
  total: number;
  label: string;
  topBorder: boolean;
  onInspect?: () => void;
  /** 키보드(Enter·Space)로 슬롯 하나를 바꾼다. 마우스·터치는 격자의 드래그가 처리한다. */
  onKeyboardToggle?: () => void;
  /** 터치 드래그로 고르는 중이면 브라우저 스크롤을 막는다(선택 모드) */
  touchSelect: boolean;
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
      <button
        type="button"
        role="gridcell"
        disabled={!onInspect}
        onClick={onInspect}
        className={`flex h-7 items-center justify-center text-[11px] hover:outline hover:outline-brand/40 ${border} ${past ? "opacity-50" : ""}`}
        style={{
          backgroundColor: view.count > 0 ? `rgb(63 99 217 / ${0.15 + ratio * 0.75})` : undefined,
          color: ratio > 0.5 ? "white" : undefined,
        }}
        aria-label={`${slotLabel} ${view.count}/${total}명 가능`}
        {...position}
      >
        {view.count > 0 && `${view.count}/${total}명`}
      </button>
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
      className={`h-7 ${onKeyboardToggle && touchSelect ? "touch-none" : ""} ${border} ${
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
