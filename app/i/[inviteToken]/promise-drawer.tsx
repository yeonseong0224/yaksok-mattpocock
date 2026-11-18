"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { HEADER_START_SLOT_ID } from "@/app/_components/ui";
import { useCloseOnEscape } from "./use-close-on-escape";

// 모바일 약속 정보 서랍(모바일 와이어프레임 "PromiseSlide / 열림" 92:1915).
// 데스크톱(lg 이상)의 왼쪽 약속 정보(PromiseSidebar)를, 그보다 좁은 화면에서는 헤더의 ☰로 여는
// 왼쪽 서랍에 넣는다. ×·바깥 영역·Esc로 닫고, 닫으면 포커스는 ☰로 돌아간다.

/** 데스크톱 레이아웃으로 바뀌는 폭(Tailwind lg) */
const DESKTOP_QUERY = "(min-width: 64rem)";

// 헤더는 서버에서 그려지므로, 그 안의 빈 자리를 찾아 ☰를 포털로 넣는다.
const subscribeNothing = () => () => {};
const getHeaderSlot = () => document.getElementById(HEADER_START_SLOT_ID);
const getNoSlot = () => null;

export function PromiseDrawer({
  children,
}: {
  /** 서랍 내용. 받은 함수로, 날짜 이동처럼 화면을 바꾸는 동작 뒤에 서랍을 닫는다. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const slot = useSyncExternalStore(subscribeNothing, getHeaderSlot, getNoSlot);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <>
      {slot &&
        createPortal(
          <button
            ref={triggerRef}
            type="button"
            aria-label="약속 정보 열기"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="mr-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-lg text-white shadow-sm hover:bg-brand-strong lg:hidden"
          >
            ☰
          </button>,
          slot,
        )}
      {open && (
        // 날짜 이동으로 닫을 때는 화면이 바뀌므로 포커스를 ☰로 되돌리지 않는다.
        <DrawerPanel onClose={close}>{children(() => setOpen(false))}</DrawerPanel>
      )}
    </>
  );
}

function DrawerPanel({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeOnDesktop = useEffectEvent((e: MediaQueryListEvent) => {
    if (e.matches) onClose();
  });
  useCloseOnEscape(onClose);

  useEffect(() => {
    closeRef.current?.focus();
    // 서랍이 열린 동안 뒤 화면이 스크롤되지 않게 한다.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // 화면을 돌리거나 넓혀서 데스크톱 레이아웃이 되면 서랍은 필요 없으니 닫는다.
    const desktop = window.matchMedia(DESKTOP_QUERY);
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      document.body.style.overflow = previous;
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="promise-drawer-title"
      className="fixed inset-0 z-40 bg-ink/40 lg:hidden"
      onClick={onClose}
    >
      <div
        className="flex h-full w-[312px] max-w-[85vw] flex-col gap-4 overflow-y-auto bg-surface px-4 pt-3 pb-6 shadow-xl *:shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="promise-drawer-title" className="text-lg text-ink">
            약속 정보
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label="약속 정보 닫기"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-line text-lg text-brand-ink hover:bg-canvas"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
