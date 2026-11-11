"use client";

import { useEffect, useRef, useState } from "react";
import type { TimeRange } from "@/lib/availability/repeat";
import { clockRangesLabel, dayLabel } from "../calendar";
import { useCloseOnEscape } from "../use-close-on-escape";
import type { RepeatMode } from "./repeat-menu";

// 모바일 반복 바텀시트(Figma 24). 데스크톱 우클릭 메뉴(RepeatMenu) 대신 쓴다.
// - 길게 누르기로 열면 그 날짜가 원본이라 바로 주간 반복·특정 날짜 반복을 고른다.
// - 하단 "반복 사용" 버튼으로 열면 원본으로 쓸 날짜(시간을 고른 날짜)부터 고른다.
// 버튼은 44px 이상 터치 영역. Esc·바깥(어두운 부분) 누르기·닫기로 닫고, 포커스는 연 쪽(onClose)에서 돌려놓는다.

export type RepeatSource = { date: string; ranges: TimeRange[] };

export function RepeatSheet({
  sources,
  initialDate,
  onChoose,
  onClose,
}: {
  /** 원본으로 고를 수 있는 날짜(시간을 고른 날짜)와 그날의 시간 */
  sources: RepeatSource[];
  /** 정해진 원본 날짜. 없으면 날짜부터 고른다. */
  initialDate?: string;
  onChoose: (date: string, mode: RepeatMode) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate ?? null);
  const sheetRef = useRef<HTMLDivElement>(null);
  // 길게 누르기로 열면 손을 뗄 때의 click이 바깥(어두운 부분)으로 올 수 있다.
  // 바깥에서 새로 누른 경우에만 닫는다.
  const pressedBackdrop = useRef(false);
  useCloseOnEscape(onClose);
  // 단계가 바뀔 때마다 첫 버튼으로 포커스를 옮긴다.
  useEffect(() => {
    sheetRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [date]);

  const ranges = date === null ? [] : (sources.find((s) => s.date === date)?.ranges ?? []);
  const empty = date !== null && ranges.length === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="repeat-sheet-title"
      className="fixed inset-0 z-30 flex items-end bg-ink/30"
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={sheetRef}
        className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl bg-surface px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="repeat-sheet-title" className="text-lg font-bold">
          가능 시간 반복 사용
        </h2>
        {date === null ? (
          <>
            <p className="mt-1 text-xs text-muted">복사할 날짜를 골라 주세요.</p>
            <div className="mt-4 flex flex-col gap-2">
              {sources.map((s) => (
                <SheetButton key={s.date} onClick={() => setDate(s.date)}>
                  {dayLabel(s.date)} · {clockRangesLabel(s.ranges)}
                </SheetButton>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted">
              {dayLabel(date)} · {empty ? "고른 시간이 없어요" : clockRangesLabel(ranges)}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <SheetButton disabled={empty} onClick={() => onChoose(date, "weekly")}>
                주간 반복
              </SheetButton>
              <SheetButton disabled={empty} onClick={() => onChoose(date, "dates")}>
                특정 날짜 반복
              </SheetButton>
            </div>
            {empty && (
              <p className="mt-2 text-xs text-muted">
                이 날짜에 시간을 먼저 고르면 반복할 수 있어요.
              </p>
            )}
            {initialDate === undefined && (
              <div className="mt-2 flex flex-col">
                <SheetButton onClick={() => setDate(null)}>다른 날짜 고르기</SheetButton>
              </div>
            )}
          </>
        )}
        <div className="mt-2 flex flex-col">
          <SheetButton onClick={onClose}>닫기</SheetButton>
        </div>
      </div>
    </div>
  );
}

function SheetButton({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-11 rounded-lg border border-line px-4 py-2 text-sm text-brand-ink hover:bg-canvas disabled:cursor-not-allowed disabled:text-muted/50"
    >
      {children}
    </button>
  );
}
