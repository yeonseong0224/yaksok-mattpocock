"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/app/_components/ui";
import {
  defaultVotingDeadline,
  validateStartSettings,
  type SettingsError,
} from "@/lib/promises/start-settings";
import { ApiError, postJson, promiseUrl } from "./api";
import { LeaveDialog } from "./leave-dialog";
import type { DateRange } from "./range-calendar";
import {
  SettingsFields,
  settingsBody,
  splitKst,
  toErrors,
  type Deadline,
  type SettingsErrors,
} from "./settings-fields";

// 방장 설정 폼(Figma 01~03). 하루 시간 범위와 약속 길이는 받지 않는다(STATE-03-01 MVP 결정).

export function SettingsForm({
  promiseId,
  draftExpiresAt,
  onStarted,
  onExpired,
  onDiscarded,
}: {
  promiseId: string;
  draftExpiresAt: string;
  onStarted: () => void;
  onExpired: () => void;
  /** "이 약속 없애기"로 초안을 지웠다(STATE-API-08). 링크 첫 화면으로 돌아간다. */
  onDiscarded: () => void;
}) {
  const [title, setTitle] = useState("");
  const [range, setRange] = useState<DateRange>({ startDate: null, endDate: null });
  const [participantLimit, setParticipantLimit] = useState(4);
  const [deadline, setDeadline] = useState(() => splitKst(defaultVotingDeadline(new Date(), null)));
  const [deadlineTouched, setDeadlineTouched] = useState(false);
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [pending, setPending] = useState(false);
  const discardRef = useRef<HTMLButtonElement>(null);
  const [discarding, setDiscarding] = useState(false);

  // 방장이 마감을 직접 고치기 전까지는 종료일에 맞춰 기본값을 다시 계산한다(TIME-13-02).
  function changeRange(next: DateRange) {
    setRange(next);
    if (!deadlineTouched) setDeadline(splitKst(defaultVotingDeadline(new Date(), next.endDate)));
  }

  function changeDeadline(next: Deadline) {
    setDeadline(next);
    setDeadlineTouched(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = settingsBody({ title, range, participantLimit, deadline });
    // 서버와 같은 규칙으로 먼저 확인한다. 최종 판정은 서버 시각으로 서버가 한다.
    const checked = validateStartSettings(body, new Date());
    if (!checked.ok) return setErrors(toErrors(checked.errors));

    setErrors({});
    setPending(true);
    try {
      await postJson(`${promiseUrl(promiseId)}/start`, body);
      onStarted();
    } catch (error) {
      if (error instanceof ApiError && error.status === 410) return onExpired();
      if (error instanceof ApiError && error.status === 422) {
        const list = (error.details?.errors as SettingsError[] | undefined) ?? [];
        return setErrors(list.length > 0 ? toErrors(list) : { form: error.message });
      }
      setErrors({
        form: error instanceof ApiError ? error.message : "네트워크 오류로 저장하지 못했어요.",
      });
    } finally {
      setPending(false);
    }
  }

  const now = new Date();

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <aside className="flex flex-col gap-6">
        <div>
          <h2 className="text-2xl leading-snug font-bold">
            우리 언제
            <br />
            만날까요?
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            날짜 범위와 인원을 정하고 친구들에게 링크를 보내세요.
          </p>
        </div>
        <Preview
          title={title}
          range={range}
          participantLimit={participantLimit}
          deadline={deadline}
        />
        <DraftCountdown draftExpiresAt={draftExpiresAt} onExpired={onExpired} />
        <button
          ref={discardRef}
          type="button"
          onClick={() => setDiscarding(true)}
          className="self-start text-sm text-danger underline-offset-2 hover:underline"
        >
          이 약속 없애기
        </button>
        {discarding && (
          <LeaveDialog
            promiseId={promiseId}
            leave={{ kind: "draft" }}
            onLeft={onDiscarded}
            onClose={() => {
              setDiscarding(false);
              discardRef.current?.focus();
            }}
          />
        )}
      </aside>

      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <h1 className="text-2xl font-bold">새 약속 만들기</h1>

        <SettingsFields
          values={{ title, range, participantLimit, deadline }}
          errors={errors}
          now={now}
          onTitleChange={setTitle}
          onRangeChange={changeRange}
          onParticipantLimitChange={setParticipantLimit}
          onDeadlineChange={changeDeadline}
        />

        <div className="flex flex-col items-end gap-3">
          <p className="w-full text-xs text-muted">마감 후에는 응답을 수정할 수 없어요.</p>
          {errors.form && (
            <p role="alert" className="w-full text-sm text-danger">
              {errors.form}
            </p>
          )}
          <Button type="submit" disabled={pending} className="md:max-w-80">
            {pending ? "저장하는 중…" : "설정 완료 · 초대 링크 만들기"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Preview({
  title,
  range,
  participantLimit,
  deadline,
}: {
  title: string;
  range: DateRange;
  participantLimit: number;
  deadline: Deadline;
}) {
  const short = (d: string | null) => (d ? d.slice(5).replace("-", ".") : "…");
  return (
    <div className="rounded-xl bg-surface p-4 text-xs leading-6 text-muted">
      <p className="mb-1 text-sm font-medium text-brand-ink">약속 미리보기</p>
      <p>{title.trim() || "약속 이름"}</p>
      <p>
        {short(range.startDate)} – {short(range.endDate)}
      </p>
      <p>방장 포함 {Number.isNaN(participantLimit) ? "…" : participantLimit}명</p>
      <p>
        {short(deadline.date)} {deadline.time} 마감
      </p>
    </div>
  );
}

// 초안은 10분 안에 설정을 마쳐야 한다(STATE-02-02). 남은 시간을 보여주고, 지나면 만료 화면으로 보낸다.
function DraftCountdown({
  draftExpiresAt,
  onExpired,
}: {
  draftExpiresAt: string;
  onExpired: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const remainingMs = Date.parse(draftExpiresAt) - now;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (remainingMs <= 0) onExpired();
  }, [remainingMs, onExpired]);

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <p className="text-xs text-muted" aria-live="off">
      설정 남은 시간 <span className="font-medium text-ink">{`${mm}:${ss}`}</span>
      <br />
      시간이 지나면 다른 사람이 방장이 될 수 있어요.
    </p>
  );
}
