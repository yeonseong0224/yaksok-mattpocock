"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button, FieldError, inputClass } from "@/app/_components/ui";
import {
  canEndOn,
  canStartOn,
  DATE_RANGE_MAX_DAYS,
  defaultVotingDeadline,
  PARTICIPANT_LIMIT_MAX,
  PARTICIPANT_LIMIT_MIN,
  validateStartSettings,
  type SettingsError,
  type SettingsField,
} from "@/lib/promises/start-settings";
import { kstDate, toKstIso } from "@/lib/time";
import { ApiError, postJson, promiseUrl } from "./api";
import { RangeCalendar, type DateRange } from "./range-calendar";

// 방장 설정 폼(Figma 01~03). 하루 시간 범위와 약속 길이는 받지 않는다(STATE-03-01 MVP 결정).

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hh = String(Math.floor(i / 2)).padStart(2, "0");
  return `${hh}:${i % 2 === 0 ? "00" : "30"}`;
});

type Errors = Partial<Record<SettingsField | "form", string>>;

function toErrors(errors: SettingsError[]): Errors {
  return Object.fromEntries(errors.map((e) => [e.field, e.message]));
}

/** 한국 시각 문자열 → 날짜·시각 입력값 */
function splitKst(date: Date) {
  const iso = toKstIso(date);
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export function SettingsForm({
  promiseId,
  draftExpiresAt,
  onStarted,
  onExpired,
}: {
  promiseId: string;
  draftExpiresAt: string;
  onStarted: () => void;
  onExpired: () => void;
}) {
  const [title, setTitle] = useState("");
  const [range, setRange] = useState<DateRange>({ startDate: null, endDate: null });
  const [participantLimit, setParticipantLimit] = useState(4);
  const [deadline, setDeadline] = useState(() => splitKst(defaultVotingDeadline(new Date(), null)));
  const [deadlineTouched, setDeadlineTouched] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  // 방장이 마감을 직접 고치기 전까지는 종료일에 맞춰 기본값을 다시 계산한다(TIME-13-02).
  function changeRange(next: DateRange) {
    setRange(next);
    if (!deadlineTouched) setDeadline(splitKst(defaultVotingDeadline(new Date(), next.endDate)));
  }

  function changeDeadline(next: { date: string; time: string }) {
    setDeadline(next);
    setDeadlineTouched(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = {
      title,
      participantLimit,
      dateRange: { startDate: range.startDate ?? "", endDate: range.endDate ?? "" },
      votingDeadlineAt: `${deadline.date}T${deadline.time}:00+09:00`,
    };
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
  const today = kstDate(now);

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
      </aside>

      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <h1 className="text-2xl font-bold">새 약속 만들기</h1>

        <Labeled id="title" label="약속 이름" error={errors.title}>
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="약속 이름을 입력하세요"
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? "title-error" : undefined}
            className={inputClass(Boolean(errors.title))}
          />
        </Labeled>

        <section aria-labelledby="date-range-label">
          <p id="date-range-label" className="mb-2 text-sm font-medium">
            ① 입력 가능 날짜
          </p>
          <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
            <ReadonlyBox label="시작" value={range.startDate} />
            <ReadonlyBox label="종료" value={range.endDate} />
          </div>
          <div className="grid gap-4 md:grid-cols-[minmax(0,360px)_1fr]">
            <RangeCalendar
              value={range}
              onChange={changeRange}
              initialMonth={`${today.slice(0, 7)}-01`}
              isSelectableStart={(date) => canStartOn(date, now)}
              isSelectableEnd={(start, date) => canEndOn(start, date, now)}
            />
            <div className="text-sm leading-7 text-muted">
              <p className="mb-2 text-base font-bold text-ink">원하는 날짜를 선택하세요</p>
              <p>‹ / › 이전·다음 달</p>
              <p>첫 클릭 시작일, 두 번째 클릭 종료일</p>
              <p>파란 영역 입력 가능한 날짜</p>
              <p className="mt-2 text-xs">설정 가능한 범위: 최대 {DATE_RANGE_MAX_DAYS}일</p>
            </div>
          </div>
          <FieldError id="dateRange-error">{errors.dateRange}</FieldError>
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <Labeled
            id="participantLimit"
            label="② 참여 인원 수 · 방장 포함"
            error={errors.participantLimit}
          >
            <div className="flex gap-2">
              <StepButton
                label="인원 줄이기"
                disabled={participantLimit <= PARTICIPANT_LIMIT_MIN}
                onClick={() => setParticipantLimit((n) => n - 1)}
              >
                −
              </StepButton>
              <input
                id="participantLimit"
                type="number"
                inputMode="numeric"
                min={PARTICIPANT_LIMIT_MIN}
                max={PARTICIPANT_LIMIT_MAX}
                value={Number.isNaN(participantLimit) ? "" : participantLimit}
                onChange={(e) => setParticipantLimit(e.target.valueAsNumber)}
                className={`${inputClass(Boolean(errors.participantLimit))} max-w-28 text-center`}
              />
              <StepButton
                label="인원 늘리기"
                disabled={participantLimit >= PARTICIPANT_LIMIT_MAX}
                onClick={() => setParticipantLimit((n) => n + 1)}
              >
                +
              </StepButton>
            </div>
          </Labeled>

          <Labeled id="deadline-date" label="③ 투표 마감 · KST" error={errors.votingDeadlineAt}>
            <div className="flex gap-2">
              <input
                id="deadline-date"
                type="date"
                min={today}
                value={deadline.date}
                onChange={(e) => changeDeadline({ ...deadline, date: e.target.value })}
                className={inputClass(Boolean(errors.votingDeadlineAt))}
              />
              <select
                aria-label="마감 시각"
                value={deadline.time}
                onChange={(e) => changeDeadline({ ...deadline, time: e.target.value })}
                className={`${inputClass(Boolean(errors.votingDeadlineAt))} max-w-32`}
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
          </Labeled>
        </div>

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

function Labeled({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium">
        {label}
      </label>
      {children}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}

function ReadonlyBox({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3.5 py-2.5">
      <span className="mr-2 text-xs text-muted">{label}</span>
      {value ? value.replaceAll("-", ".") : <span className="text-muted">달력에서 선택</span>}
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="h-11 w-11 shrink-0 rounded-lg border border-line bg-surface text-brand-ink hover:bg-canvas disabled:text-muted/40"
    >
      {children}
    </button>
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
  deadline: { date: string; time: string };
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
