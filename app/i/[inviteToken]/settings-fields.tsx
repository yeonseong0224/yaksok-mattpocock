"use client";

import type { ReactNode } from "react";
import { FieldError, inputClass } from "@/app/_components/ui";
import {
  canEndOn,
  canStartOn,
  DATE_RANGE_MAX_DAYS,
  PARTICIPANT_LIMIT_MAX,
  PARTICIPANT_LIMIT_MIN,
  type SettingsError,
  type SettingsField,
  type StartSettingsInput,
} from "@/lib/promises/start-settings";
import { kstDate, toKstIso } from "@/lib/time";
import { ApiError } from "./api";
import { RangeCalendar, type DateRange } from "./range-calendar";

// 약속 설정 입력칸(이름, 날짜 범위 달력, 정원, 마감). 모집 시작 폼(Figma 01~03)과 재설정 폼이 함께 쓴다.

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hh = String(Math.floor(i / 2)).padStart(2, "0");
  return `${hh}:${i % 2 === 0 ? "00" : "30"}`;
});

export type SettingsErrors = Partial<Record<SettingsField | "form", string>>;

export function toErrors(errors: SettingsError[]): SettingsErrors {
  return Object.fromEntries(errors.map((e) => [e.field, e.message]));
}

export type Deadline = { date: string; time: string };

/** 시각 → 한국 날짜·시각 입력값 */
export function splitKst(date: Date): Deadline {
  const iso = toKstIso(date);
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** 범위를 줄일 때의 일반 경고(STATE-API-03 범위 축소 확인) */
export const SHRINK_WARNING =
  "범위를 줄이면 제외되는 날짜·시간의 기존 입력이 삭제됩니다. 변경할까요?";

/** 기존 날짜가 하나라도 빠지는가. 화면의 입력 목록은 늦을 수 있어 날짜로만 판단한다. */
export function rangeShrinks(
  current: { dateRangeStart: string; dateRangeEnd: string },
  next: StartSettingsInput["dateRange"],
): boolean {
  return next.startDate > current.dateRangeStart || next.endDate < current.dateRangeEnd;
}

/** 저장 실패 → 칸별 오류. 422면 서버가 준 오류 목록을, 그 밖에는 폼 전체 오류 한 줄을 쓴다. */
export function errorsFromFailure(error: unknown, fallback: string): SettingsErrors {
  if (error instanceof ApiError && error.status === 422) {
    const list = (error.details?.errors as SettingsError[] | undefined) ?? [];
    if (list.length > 0) return toErrors(list);
  }
  return { form: error instanceof ApiError ? error.message : fallback };
}

export type SettingsValues = {
  title: string;
  range: DateRange;
  participantLimit: number;
  deadline: Deadline;
};

/** 입력값 → 모집 시작·재설정 요청 본문 */
export function settingsBody(values: SettingsValues): StartSettingsInput {
  return {
    title: values.title,
    participantLimit: values.participantLimit,
    dateRange: { startDate: values.range.startDate ?? "", endDate: values.range.endDate ?? "" },
    votingDeadlineAt: `${values.deadline.date}T${values.deadline.time}:00+09:00`,
  };
}

export function SettingsFields({
  values,
  errors,
  now,
  keptStartDate,
  minParticipantLimit = PARTICIPANT_LIMIT_MIN,
  onTitleChange,
  onRangeChange,
  onParticipantLimitChange,
  onDeadlineChange,
}: {
  values: SettingsValues;
  errors: SettingsErrors;
  now: Date;
  /** 재설정: 이미 지난 기존 시작일도 그대로 고를 수 있다 */
  keptStartDate?: string;
  /** 재설정: 현재 참여 인원 아래로는 줄일 수 없다 */
  minParticipantLimit?: number;
  onTitleChange: (title: string) => void;
  onRangeChange: (range: DateRange) => void;
  onParticipantLimitChange: (limit: number) => void;
  onDeadlineChange: (deadline: Deadline) => void;
}) {
  const { title, range, participantLimit, deadline } = values;
  const today = kstDate(now);
  const firstMonth = (range.startDate ?? today).slice(0, 7);

  return (
    <>
      <Labeled id="title" label="약속 이름" error={errors.title}>
        <input
          id="title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
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
            onChange={onRangeChange}
            initialMonth={`${firstMonth}-01`}
            isSelectableStart={(date) => canStartOn(date, now, keptStartDate)}
            isSelectableEnd={(start, date) => canEndOn(start, date, now, keptStartDate)}
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
              disabled={participantLimit <= minParticipantLimit}
              onClick={() => onParticipantLimitChange(participantLimit - 1)}
            >
              −
            </StepButton>
            <input
              id="participantLimit"
              type="number"
              inputMode="numeric"
              min={minParticipantLimit}
              max={PARTICIPANT_LIMIT_MAX}
              value={Number.isNaN(participantLimit) ? "" : participantLimit}
              onChange={(e) => onParticipantLimitChange(e.target.valueAsNumber)}
              className={`${inputClass(Boolean(errors.participantLimit))} max-w-28 text-center`}
            />
            <StepButton
              label="인원 늘리기"
              disabled={participantLimit >= PARTICIPANT_LIMIT_MAX}
              onClick={() => onParticipantLimitChange(participantLimit + 1)}
            >
              +
            </StepButton>
          </div>
        </Labeled>

        <Labeled id="deadline-date" label="③ 응답 마감 · KST" error={errors.votingDeadlineAt}>
          <div className="flex gap-2">
            <input
              id="deadline-date"
              type="date"
              min={today}
              value={deadline.date}
              onChange={(e) => onDeadlineChange({ ...deadline, date: e.target.value })}
              className={inputClass(Boolean(errors.votingDeadlineAt))}
            />
            <select
              aria-label="마감 시각"
              value={deadline.time}
              onChange={(e) => onDeadlineChange({ ...deadline, time: e.target.value })}
              className={`${inputClass(Boolean(errors.votingDeadlineAt))} max-w-32`}
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
        </Labeled>
      </div>
    </>
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
