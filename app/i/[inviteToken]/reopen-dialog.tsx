"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import useSWR from "swr";
import { Button } from "@/app/_components/ui";
import { planSettingsChange } from "@/lib/promises/change-impact";
import {
  defaultVotingDeadline,
  MVP_DAILY_END_MINUTE,
  MVP_DAILY_START_MINUTE,
  PARTICIPANT_LIMIT_MIN,
} from "@/lib/promises/start-settings";
import {
  getJson,
  participantsUrl,
  postJson,
  promiseUrl,
  type Roster,
  type SettingsChangeSummary,
} from "./api";
import {
  SettingsFields,
  settingsBody,
  splitKst,
  toErrors,
  errorsFromFailure,
  rangeShrinks,
  SHRINK_WARNING,
  type SettingsErrors,
  type SettingsValues,
} from "./settings-fields";

// 재조율(약속 관리 티켓 04, STATE-API-06): 마감·확정된 약속을 새 마감과 함께 다시 모집 중으로 돌린다.
// 새 마감은 반드시 다시 정하고, 약속 이름·날짜 범위·정원은 원하면 함께 바꾼다(2026-11-12 결정).
// 설정 입력칸은 모집 시작·재설정과 같다(Figma 화면 없음, 2026-11-11 결정: 기존 컴포넌트로 구현).

export type ReopenSettings = {
  title: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  participantLimit: number | null;
  durationMinutes: number;
  /** 확정된 약속이면 확정 일정이 해제된다고 알린다 */
  confirmed: boolean;
};

export function ReopenDialog({
  promiseId,
  settings,
  onReopened,
  onClose,
}: {
  promiseId: string;
  settings: ReopenSettings;
  onReopened: (summary: SettingsChangeSummary) => void;
  onClose: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  // 고친 값이 사라지지 않게 Esc·바깥 클릭으로는 닫지 않는다. 취소·✕로만 닫는다.
  const roster = useSWR<Roster>(participantsUrl(promiseId), getJson);
  const activeCount = roster.data?.currentParticipantCount ?? 0;

  const [values, setValues] = useState<SettingsValues>(() => ({
    title: settings.title,
    range: { startDate: settings.dateRangeStart, endDate: settings.dateRangeEnd },
    participantLimit: settings.participantLimit ?? PARTICIPANT_LIMIT_MIN,
    // 지난 마감 대신 새 마감 기본값(지금 + 24시간, 마지막 날 00:00 전)에서 시작한다.
    deadline: splitKst(defaultVotingDeadline(new Date(), settings.dateRangeEnd)),
    durationMinutes: settings.durationMinutes,
  }));
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [confirmShrink, setConfirmShrink] = useState(false);
  const [pending, setPending] = useState(false);

  const change = (patch: Partial<SettingsValues>) => setValues((v) => ({ ...v, ...patch }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = settingsBody(values);
    // 서버와 같은 규칙으로 먼저 확인한다(정원 하한은 참여 인원만 있으면 된다). 최종 판정은 서버가 한다.
    const plan = planSettingsChange({
      current: {
        dateRangeStart: settings.dateRangeStart,
        dateRangeEnd: settings.dateRangeEnd,
        dailyStartMinute: MVP_DAILY_START_MINUTE,
        dailyEndMinute: MVP_DAILY_END_MINUTE,
      },
      next: body,
      participants: (roster.data?.participants ?? []).map((p) => ({
        participantId: p.participantId,
        slots: [],
      })),
      now: new Date(),
    });
    if (!plan.ok) return setErrors(toErrors(plan.errors));
    setErrors({});
    if (rangeShrinks(settings, body.dateRange) && !confirmShrink) return setConfirmShrink(true);

    setPending(true);
    try {
      const result = await postJson<{ changeImpact: SettingsChangeSummary }>(
        `${promiseUrl(promiseId)}/reopen`,
        body,
      );
      onReopened(result.changeImpact);
    } catch (error) {
      setErrors(errorsFromFailure(error, "네트워크 오류로 다시 열지 못했어요."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reopen-title"
      className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-6 sm:items-center"
    >
      <div className="w-full max-w-3xl rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h2
            id="reopen-title"
            ref={titleRef}
            tabIndex={-1}
            className="text-lg font-bold outline-none"
          >
            다시 조율하기
          </h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-brand-ink hover:bg-canvas"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          새 마감을 정하면 약속이 다시 모집 중이 돼요. 범위 안에 남은 기존 선택은 그대로예요.
          {settings.confirmed && " 확정된 일정은 해제돼요."}
        </p>
        <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-6">
          <SettingsFields
            values={values}
            errors={errors}
            now={new Date()}
            keptStartDate={settings.dateRangeStart}
            minParticipantLimit={Math.max(PARTICIPANT_LIMIT_MIN, activeCount)}
            onTitleChange={(title) => change({ title })}
            onRangeChange={(range) => {
              change({ range });
              setConfirmShrink(false);
            }}
            onParticipantLimitChange={(participantLimit) => change({ participantLimit })}
            onDeadlineChange={(deadline) => change({ deadline })}
            onDurationChange={(durationMinutes) => change({ durationMinutes })}
          />
          <p className="text-xs text-muted">
            하루 시간 범위와 약속 길이는 그대로예요. 정원은 지금 참여한 {activeCount}
            명보다 줄일 수 없어요.
          </p>
          {confirmShrink && (
            <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {SHRINK_WARNING}
            </p>
          )}
          {roster.error && (
            <p role="alert" className="text-sm text-danger">
              참여 인원을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.
            </p>
          )}
          {errors.form && (
            <p role="alert" className="text-sm text-danger">
              {errors.form}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              취소
            </Button>
            <Button type="submit" disabled={pending || !roster.data}>
              {pending ? "여는 중…" : confirmShrink ? "그래도 다시 열기" : "다시 모집 시작"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
