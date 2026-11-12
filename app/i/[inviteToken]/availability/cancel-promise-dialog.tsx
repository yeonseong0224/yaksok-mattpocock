"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/app/_components/ui";
import { ApiError, cancelUrl, postJson } from "../api";
import { useCloseOnEscape } from "../use-close-on-escape";

// 약속 취소 확인 팝업(약속 관리 티켓 05, STATE-API-07). 되돌릴 수 없음을 알린 뒤 방장이 한 번 더 누르면 취소한다.
// Figma 화면 없음: 확정 확인 팝업(Figma 19)과 같은 모양으로 만든다(2026-11-11 결정).
export function CancelPromiseDialog({
  promiseId,
  onCancelled,
  onClose,
}: {
  promiseId: string;
  /** 취소됐다. 화면을 다시 불러오면 링크가 "취소된 약속"으로 바뀐다. */
  onCancelled: () => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // 취소 요청 중에는 닫지 않는다(결과를 모른 채 화면이 바뀌지 않게).
  const dismiss = () => {
    if (!pending) onClose();
  };
  useCloseOnEscape(dismiss);
  useEffect(() => titleRef.current?.focus(), []);

  async function cancel() {
    setPending(true);
    setError(null);
    try {
      await postJson(cancelUrl(promiseId));
      onCancelled();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "취소하지 못했어요. 다시 시도해 주세요.");
      setPending(false);
    }
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cancel-title"
      aria-describedby="cancel-description"
      className="fixed inset-0 z-30 flex items-center justify-center bg-ink/30 px-4"
      onClick={dismiss}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="cancel-title"
          ref={titleRef}
          tabIndex={-1}
          className="text-lg font-bold outline-none"
        >
          약속을 취소할까요?
        </h2>
        <div id="cancel-description" className="mt-4 text-sm leading-6 text-muted">
          <p className="font-medium text-danger">취소하면 되돌릴 수 없어요.</p>
          <p>모든 참여자가 로그아웃되고, 링크를 열면 &ldquo;취소된 약속입니다&rdquo;만 보여요.</p>
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
          <Button variant="danger" onClick={cancel} disabled={pending}>
            {pending ? "취소하는 중…" : "약속 취소하기"}
          </Button>
        </div>
      </div>
    </div>
  );
}
