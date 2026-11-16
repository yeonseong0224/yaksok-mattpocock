"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useCloseOnEscape } from "../use-close-on-escape";

// 모바일 바텀시트 틀(모바일 시간표 개편). 손잡이·제목·닫기(×) 아래에 내용, 맨 아래에 버튼 줄.
// Esc·×·바깥(어두운 부분)을 새로 눌러 닫는다. 열리면 ×로 포커스를 옮기고, 포커스 복귀는 연 쪽에서 한다.
export function BottomSheet({
  title,
  onClose,
  actions,
  children,
}: {
  title: string;
  onClose: () => void;
  /** 맨 아래 버튼 줄 */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // 누른 곳이 바깥일 때만 닫는다(시트 안에서 누르고 바깥에서 뗀 경우는 닫지 않는다).
  const pressedBackdrop = useRef(false);
  useCloseOnEscape(onClose);
  useEffect(() => closeRef.current?.focus(), []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bottom-sheet-title"
      className="fixed inset-0 z-30 flex items-end bg-ink/35"
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[calc(100dvh-4.5rem)] w-full flex-col rounded-t-[20px] bg-surface px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl">
        <div className="mx-auto mb-2.5 h-1 w-9 shrink-0 rounded bg-line" aria-hidden />
        <div className="mb-2 flex min-h-11 items-center gap-2">
          <h2 id="bottom-sheet-title" className="flex-1 text-lg font-bold">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-canvas"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto pb-1">{children}</div>
        {actions && <div className="mt-4 flex shrink-0 gap-2">{actions}</div>}
      </div>
    </div>
  );
}
