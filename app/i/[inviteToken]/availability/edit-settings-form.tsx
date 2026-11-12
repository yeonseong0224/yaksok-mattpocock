"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/app/_components/ui";
import { planSettingsChange, type ChangeImpactInput } from "@/lib/promises/change-impact";
import { PARTICIPANT_LIMIT_MIN, type SettingsError } from "@/lib/promises/start-settings";
import { hhmmToMinute } from "@/lib/time";
import { ApiError, patchJson, settingsUrl, type SettingsChangeSummary } from "../api";
import {
  SettingsFields,
  settingsBody,
  splitKst,
  toErrors,
  type SettingsErrors,
  type SettingsValues,
} from "../settings-fields";
import type { HostSettings } from "./host-settings-dialog";

// 재설정(약속 관리 티켓 03, STATE-API-03): 모집 중에 이름·날짜 범위·정원·마감을 바꾼다.
// 하루 시간 범위와 약속 길이는 바꾸지 않는다(MVP 고정). 범위를 줄이면 한 번 더 묻는다.

/** 범위를 줄일 때의 일반 경고(STATE-API-03 범위 축소 확인) */
const SHRINK_WARNING = "범위를 줄이면 제외되는 날짜·시간의 기존 입력이 삭제됩니다. 변경할까요?";

export function EditSettingsForm({
  promiseId,
  settings,
  participants,
  onSaved,
  onCancel,
}: {
  promiseId: string;
  settings: HostSettings;
  /** active 참여자와 그 저장된 슬롯(epoch 밀리초). 정원 하한과 지워질 입력을 미리 계산한다. */
  participants: ChangeImpactInput["participants"];
  onSaved: (summary: SettingsChangeSummary) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<SettingsValues>(() => ({
    title: settings.title,
    range: { startDate: settings.dateRangeStart, endDate: settings.dateRangeEnd },
    participantLimit: settings.participantLimit ?? participants.length,
    deadline: splitKst(new Date(settings.votingDeadlineAt)),
  }));
  const [errors, setErrors] = useState<SettingsErrors>({});
  // 범위를 줄이면 경고를 본 뒤 한 번 더 누르면 저장한다. 범위를 다시 고르면 풀린다.
  const [confirmShrink, setConfirmShrink] = useState(false);
  const [pending, setPending] = useState(false);

  const change = (patch: Partial<SettingsValues>) => setValues((v) => ({ ...v, ...patch }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = settingsBody(values);
    // 서버와 같은 규칙으로 먼저 확인한다. 최종 판정은 잠금 후 서버 시각으로 서버가 한다.
    const plan = planSettingsChange({
      current: {
        dateRangeStart: settings.dateRangeStart,
        dateRangeEnd: settings.dateRangeEnd,
        dailyStartMinute: hhmmToMinute(settings.dailyStartTime),
        dailyEndMinute: hhmmToMinute(settings.dailyEndTime),
        votingDeadlineAt: new Date(settings.votingDeadlineAt),
      },
      next: body,
      participants,
      now: new Date(),
    });
    if (!plan.ok) return setErrors(toErrors(plan.errors));
    setErrors({});
    // 기존 날짜가 하나라도 빠지면 경고한다(STATE-API-03 범위 축소 확인). 화면의 입력 목록은 늦을 수 있어 날짜로 판단한다.
    const shrinks =
      body.dateRange.startDate > settings.dateRangeStart ||
      body.dateRange.endDate < settings.dateRangeEnd;
    if (shrinks && !confirmShrink) return setConfirmShrink(true);

    setPending(true);
    try {
      const result = await patchJson<{ changeImpact: SettingsChangeSummary }>(
        settingsUrl(promiseId),
        body,
      );
      onSaved(result.changeImpact);
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        const list = (error.details?.errors as SettingsError[] | undefined) ?? [];
        return setErrors(list.length > 0 ? toErrors(list) : { form: error.message });
      }
      setErrors({
        form:
          error instanceof ApiError && error.code === "INVALID_PROMISE_STATE"
            ? "마감이 지나 설정을 바꿀 수 없어요. 마감 뒤에는 재조율로 다시 모집할 수 있어요."
            : error instanceof ApiError
              ? error.message
              : "네트워크 오류로 저장하지 못했어요.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-6">
      <SettingsFields
        values={values}
        errors={errors}
        now={new Date()}
        keptStartDate={settings.dateRangeStart}
        minParticipantLimit={Math.max(PARTICIPANT_LIMIT_MIN, participants.length)}
        onTitleChange={(title) => change({ title })}
        onRangeChange={(range) => {
          change({ range });
          setConfirmShrink(false);
        }}
        onParticipantLimitChange={(participantLimit) => change({ participantLimit })}
        onDeadlineChange={(deadline) => change({ deadline })}
      />
      <p className="text-xs text-muted">
        하루 시간 범위({settings.dailyStartTime}–{settings.dailyEndTime})와 약속 길이는 바꿀 수
        없어요. 정원은 지금 참여한 {participants.length}명보다 줄일 수 없어요.
      </p>
      {confirmShrink && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {SHRINK_WARNING}
        </p>
      )}
      {errors.form && (
        <p role="alert" className="text-sm text-danger">
          {errors.form}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
          취소
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "저장하는 중…" : confirmShrink ? "그래도 변경" : "변경 저장"}
        </Button>
      </div>
    </form>
  );
}
