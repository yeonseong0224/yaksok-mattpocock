"use client";

import { useState } from "react";
import { Button } from "@/app/_components/ui";
import { ApiError, confirmationUrl, postJson, type ScheduledTime } from "../api";
import { timeRangeLabel } from "../calendar";
import { useCloseOnEscape } from "../use-close-on-escape";

// 확정 확인 팝업(Figma 19). 방장이 표시된 후보 하나를 확정한다(STATE-API-05).
// 방장이 참석할 수 없는 후보면 그 사실을 알린 뒤 확정한다(RESULT-04-02).
export function ConfirmDialog({
  promiseId,
  candidate,
  hostParticipantId,
  onConfirmed,
  onCandidatesChanged,
  onClose,
}: {
  promiseId: string;
  candidate: ScheduledTime;
  hostParticipantId: string;
  onConfirmed: () => void;
  /** 다시 계산해 보니 이 후보가 더 이상 표시 후보가 아닐 때(409). 응답에 담긴 새 후보 목록을 넘긴다. */
  onCandidatesChanged: (candidates: ScheduledTime[]) => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  useCloseOnEscape(onClose);

  const hostAbsent = !candidate.participants.some((p) => p.participantId === hostParticipantId);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await postJson(confirmationUrl(promiseId), { startAt: candidate.startAt });
      onConfirmed();
    } catch (e) {
      if (e instanceof ApiError && e.code === "INVALID_CONFIRMATION_CANDIDATE") {
        // 본 뒤에 상황이 바뀌었다(2명 미만, 지난 시각 등). 새 후보로 다시 고르게 한다(RESULT-12-02).
        setStale(true);
        onCandidatesChanged((e.details?.candidates as ScheduledTime[] | undefined) ?? []);
      } else {
        setError(e instanceof ApiError ? e.message : "확정하지 못했어요. 다시 시도해 주세요.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-30 flex items-end justify-center bg-ink/30 sm:items-center sm:px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[calc(100dvh-4.5rem)] w-full overflow-y-auto rounded-t-[20px] bg-surface p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-xl sm:max-h-none sm:max-w-md sm:rounded-2xl sm:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-lg font-bold">
          이 시간으로 확정할까요?
        </h2>
        <div className="mt-4 rounded-xl border border-brand/40 px-4 py-4 text-center text-brand-ink">
          <p className="font-medium">
            {timeRangeLabel(Date.parse(candidate.startAt), Date.parse(candidate.endAt))}
          </p>
          <p className="mt-1 text-sm">
            {candidate.availableParticipantCount}명 가능 ·{" "}
            {candidate.participants.map((p) => p.nickname).join(", ")}
          </p>
        </div>

        {stale ? (
          <p role="alert" className="mt-4 text-sm text-danger">
            그 사이 응답이 바뀌어서 이 시간은 더 이상 후보가 아니에요. 새 후보 목록에서 다시 골라
            주세요.
          </p>
        ) : (
          <div className="mt-4 text-sm leading-6 text-muted">
            {hostAbsent && (
              <p className="mb-2 font-medium text-danger">
                방장(나)은 이 시간에 참석할 수 없어요. 그래도 확정할 수 있어요.
              </p>
            )}
            <p>확정하면 아무도 가능 시간을 고칠 수 없어요.</p>
            <p>참여자 모두에게 이 날짜와 시간이 보여요.</p>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onClose}>
            {stale ? "닫기" : "돌아가기"}
          </Button>
          {!stale && (
            <Button onClick={confirm} disabled={pending}>
              {pending ? "확정하는 중…" : "약속 확정하기"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
