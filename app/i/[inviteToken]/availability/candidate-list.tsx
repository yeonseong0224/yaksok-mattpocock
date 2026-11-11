"use client";

import useSWR from "swr";
import { kstDate } from "@/lib/time";
import {
  candidatesUrl,
  getJson,
  type ApiError,
  type CandidateList,
  type ScheduledTime,
} from "../api";
import { timeRangeLabel } from "../calendar";

// 후보 목록(Figma 17·21, RESULT-06~10). 모집 중에는 현재 제출값 기준의 중간 후보,
// 마감 뒤에는 최종 후보다. 후보마다 참석 가능한 사람의 닉네임을 보여준다.
export function CandidateListPanel({
  promiseId,
  pollMs,
  onPick,
  onConfirm,
}: {
  promiseId: string;
  pollMs: number;
  /** 후보를 누르면 그 날짜가 있는 주의 시간표로 옮긴다. */
  onPick: (date: string) => void;
  /** 방장·마감 후에만 넘긴다. 후보마다 확정 버튼이 생긴다. */
  onConfirm?: (candidate: ScheduledTime) => void;
}) {
  const result = useSWR<CandidateList, ApiError>(candidatesUrl(promiseId), getJson, {
    refreshInterval: pollMs,
  });
  const data = result.data;

  return (
    <section
      className="mt-4 rounded-xl border border-line bg-surface p-4"
      aria-labelledby="candidates-title"
    >
      <div className="flex items-baseline justify-between">
        <h3 id="candidates-title" className="font-bold">
          {data?.promiseStatus === "collecting" ? "지금까지의 후보" : "최종 후보"}
        </h3>
        <p className="text-xs text-muted">
          {data?.promiseStatus === "collecting"
            ? "제출한 시간으로 계산한 중간 결과예요. 마감 전까지 바뀔 수 있어요."
            : "가능 인원이 많은 순, 같으면 빠른 순이에요."}
        </p>
      </div>

      {result.error && <p className="mt-3 text-sm text-danger">후보를 불러오지 못했어요.</p>}
      {!data && !result.error && <p className="mt-3 text-sm text-muted">불러오는 중…</p>}
      {data && data.candidates.length === 0 && (
        // RESULT-08-01
        <p className="mt-3 text-sm text-muted">2명 이상 겹치는 시간이 없어요.</p>
      )}
      {data && data.candidates.length > 0 && (
        <ol className="mt-3 flex flex-col gap-2">
          {data.candidates.map((c, i) => {
            const date = kstDate(new Date(c.startAt));
            return (
              <li key={c.startAt}>
                <button
                  type="button"
                  onClick={() => onPick(date)}
                  className="w-full rounded-lg border border-line px-4 py-3 text-left hover:bg-canvas"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">
                      <span className="mr-2 text-brand-ink">{i + 1}</span>
                      {timeRangeLabel(Date.parse(c.startAt), Date.parse(c.endAt))}
                    </span>
                    <span className="shrink-0 text-xs text-brand-ink">
                      {c.availableParticipantCount}명 가능
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {c.participants.map((p) => p.nickname).join(", ")}
                  </p>
                </button>
                {onConfirm && (
                  <button
                    type="button"
                    onClick={() => onConfirm(c)}
                    className="mt-1 w-full rounded-lg bg-brand py-2 text-sm font-medium text-white hover:bg-brand-strong"
                  >
                    이 후보로 확정하기
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
