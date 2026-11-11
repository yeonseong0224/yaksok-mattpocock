"use client";

import { useEffect, useEffectEvent, useRef, type KeyboardEvent } from "react";
import type { TimeRange } from "@/lib/availability/repeat";
import { clockRangesLabel, dayLabel } from "../calendar";
import { useCloseOnEscape } from "../use-close-on-escape";

// 반복 메뉴(Figma 09). 날짜 열이나 선택 블록을 우클릭하면 포인터 자리에 열린다.
// 그날 고른 시간이 없으면 항목이 비활성이다. Esc·바깥 클릭으로 닫고, 포커스는 연 쪽(onClose)에서 돌려놓는다.

export type RepeatMode = "weekly" | "dates";

const MENU_WIDTH = 288;

export function RepeatMenu({
  date,
  ranges,
  x,
  y,
  onChoose,
  onClose,
}: {
  date: string;
  /** 원본 날짜에 고른 시간 구간. 비어 있으면 반복할 것이 없다. */
  ranges: TimeRange[];
  x: number;
  y: number;
  onChoose: (mode: RepeatMode) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const empty = ranges.length === 0;
  // 폴링으로 부모가 다시 그려져도 포커스를 다시 옮기지 않도록, 열릴 때 한 번만 등록한다.
  const close = useEffectEvent(onClose);
  useCloseOnEscape(onClose);

  useEffect(() => {
    const menu = menuRef.current;
    // 열리면 첫 항목에, 항목이 비활성이면 메뉴 자체에 포커스를 둔다.
    (menu?.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)") ?? menu)?.focus();
    // 바깥을 누르면 닫기만 한다. 캡처 단계에서 막아서 그 누름이 격자 드래그로 이어지지 않게 한다.
    const onPointerDown = (e: PointerEvent) => {
      if (menu?.contains(e.target as Node)) return;
      e.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [
        ...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)") ?? []),
      ];
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length].focus();
    }
  }

  // 화면 밖으로 나가지 않게 오른쪽·아래 끝에서 안쪽으로 당긴다.
  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - 240));

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="가능 시간 반복"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-30 rounded-xl border border-line bg-surface p-3 shadow-xl outline-none"
      style={{ left, top, width: MENU_WIDTH }}
    >
      <p className="px-2 text-sm font-bold">해당 가능 날짜 반복 사용</p>
      <p className="mt-1 px-2 text-xs text-muted">
        {dayLabel(date)}
        {empty ? " · 고른 시간이 없어요" : ` · ${clockRangesLabel(ranges)}`}
      </p>
      <div className="mt-2 flex flex-col gap-1">
        <MenuItem disabled={empty} onClick={() => onChoose("weekly")}>
          주간 반복
        </MenuItem>
        <MenuItem disabled={empty} onClick={() => onChoose("dates")}>
          특정 날짜 반복
        </MenuItem>
      </div>
      <p className="mt-2 px-2 text-xs text-muted">
        {empty
          ? "이 날짜에 시간을 먼저 고르면 반복할 수 있어요."
          : "원본 날짜의 모든 가능 시간을 복사해요."}
      </p>
    </div>
  );
}

function MenuItem({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 items-center rounded-lg px-3 text-left text-sm text-brand-ink hover:bg-brand/10 focus:bg-brand/15 focus:outline-none disabled:cursor-not-allowed disabled:text-muted/50 disabled:hover:bg-transparent"
    >
      {children}{" "}
      <span aria-hidden className="ml-2">
        ›
      </span>
    </button>
  );
}
