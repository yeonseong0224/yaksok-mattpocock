"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/app/_components/ui";
import { ApiError } from "./api";
import { useCloseOnEscape } from "./use-close-on-escape";

// 되돌릴 수 없는 동작(약속 취소, 나가기, 초안 없애기, 내보내기)의 확인 팝업(약속 관리 2026-11-11 결정).
// Figma 화면 없음: 확정 확인 팝업(Figma 19)과 같은 모양이다. 첫 줄은 빨갛게 강조한다.
// 요청 중에는 Esc·바깥 클릭·돌아가기로 닫지 않는다(결과를 모른 채 화면이 바뀌지 않게).
export function DangerConfirmDialog({
  title,
  lines,
  actionLabel,
  onConfirm,
  failureMessage,
  onClose,
}: {
  title: string;
  lines: string[];
  actionLabel: string;
  /** 실제 요청. 성공하면 부르는 쪽이 화면을 바꾼다. 실패하면 던진다. */
  onConfirm: () => Promise<void>;
  /** ApiError의 메시지를 그대로 쓰지 않을 때(예: 401) 고르는 문구 */
  failureMessage?: (error: unknown) => string | null;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const dismiss = () => {
    if (!pending) onClose();
  };
  useCloseOnEscape(dismiss);
  useEffect(() => titleRef.current?.focus(), []);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(
        failureMessage?.(e) ??
          (e instanceof ApiError ? e.message : "처리하지 못했어요. 다시 시도해 주세요."),
      );
      setPending(false);
    }
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="fixed inset-0 z-30 flex items-center justify-center bg-ink/30 px-4"
      onClick={dismiss}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="text-lg font-bold outline-none">
          {title}
        </h2>
        <div id={descriptionId} className="mt-4 text-sm leading-6 text-muted">
          {lines.map((line, i) => (
            <p key={line} className={i === 0 ? "font-medium text-danger" : undefined}>
              {line}
            </p>
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            돌아가기
          </Button>
          <Button variant="danger" onClick={confirm} disabled={pending}>
            {pending ? "처리하는 중…" : actionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
