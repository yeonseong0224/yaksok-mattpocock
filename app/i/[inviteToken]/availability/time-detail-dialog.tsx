"use client";

import { Button } from "@/app/_components/ui";
import { SLOT_MS } from "@/lib/time";
import { useCloseOnEscape } from "../use-close-on-escape";
import type { Availability } from "../api";
import { timeRangeLabel } from "../calendar";

// 시간 상세 팝업(Figma 18). 히트맵에서 슬롯을 누르면 그 30분에 누가 가능한지 보여준다.
// 가능/불가능만 보여주고 미응답은 따로 구분하지 않는다(TIME-12-02, 2026-11-09 결정).
// "이 시간으로 확정하기"는 방장에게, 마감 후에만, 그 슬롯이 표시 후보의 시작 시각일 때만 보인다.
export function TimeDetailDialog({
  slotMs,
  participants,
  onConfirm,
  onClose,
}: {
  slotMs: number;
  participants: Availability["participants"];
  /** 방장·마감 후·이 슬롯이 표시 후보의 시작일 때만 넘긴다(스토리 67, 2026-11-09 결정). */
  onConfirm?: () => void;
  onClose: () => void;
}) {
  const available = new Set(
    participants
      .filter((p) => p.availableSlots.some((s) => Date.parse(s) === slotMs))
      .map((p) => p.participantId),
  );
  const unavailableCount = participants.length - available.size;
  useCloseOnEscape(onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="time-detail-title"
      className="fixed inset-0 z-20 flex items-center justify-center bg-ink/30 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="time-detail-title" className="text-lg font-bold">
          이 시간에는 누가 가능할까요?
        </h2>
        <p className="mt-4 text-xl font-bold text-brand-ink">
          {timeRangeLabel(slotMs, slotMs + SLOT_MS)}
        </p>
        <span className="mt-3 inline-block rounded-md bg-brand/15 px-3 py-1 text-xs text-brand-ink">
          {available.size}/{participants.length}명 가능
        </span>
        <ul className="mt-4 flex flex-col gap-2">
          {participants.map((p) => (
            <li
              key={p.participantId}
              className="flex items-center justify-between rounded-lg border border-line px-4 py-2.5 text-sm"
            >
              <span>
                {p.nickname}
                {p.isHost && <span className="ml-1 text-muted">· 방장</span>}
              </span>
              {available.has(p.participantId) ? (
                <span className="text-brand-ink">✓ 가능</span>
              ) : (
                <span className="text-muted">불가능</span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">불가능 {unavailableCount}명</p>
        {onConfirm && (
          <Button onClick={onConfirm} className="mt-4">
            이 시간으로 확정하기
          </Button>
        )}
        <Button variant="secondary" onClick={onClose} className="mt-2">
          닫기
        </Button>
      </div>
    </div>
  );
}
