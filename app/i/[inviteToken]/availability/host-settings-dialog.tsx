"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/app/_components/ui";
import { hhmmToMinute, toKstIso } from "@/lib/time";
import { durationLabel } from "../calendar";
import { useCloseOnEscape } from "../use-close-on-escape";

// 방장 설정 보기(Figma 07 PromiseSidebar "방장 설정 보기", 2026-11-11 결정: 읽기 전용, 방장에게만).
// 모집을 시작할 때 정한 설정을 보여주기만 한다. 설정 변경(재설정)은 다음 슬라이스다.

export type HostSettings = {
  title: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  dailyStartTime: string;
  dailyEndTime: string;
  durationMinutes: number;
  /** 방장 포함 최대 인원. 없으면 정하지 않은 것이다. */
  participantLimit: number | null;
  votingDeadlineAt: string;
};

const dotted = (date: string) => date.replaceAll("-", ".");

export function HostSettingsDialog({
  settings,
  onClose,
}: {
  settings: HostSettings;
  onClose: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useCloseOnEscape(onClose);
  useEffect(() => titleRef.current?.focus(), []);

  // 시작일과 종료일을 모두 포함한 일수
  const days =
    (Date.parse(`${settings.dateRangeEnd}T00:00:00Z`) -
      Date.parse(`${settings.dateRangeStart}T00:00:00Z`)) /
      86_400_000 +
    1;
  const deadline = toKstIso(new Date(settings.votingDeadlineAt));
  const sameYear = settings.dateRangeStart.slice(0, 4) === settings.dateRangeEnd.slice(0, 4);
  const rangeEnd = sameYear
    ? dotted(settings.dateRangeEnd.slice(5))
    : dotted(settings.dateRangeEnd);
  const dailyMinutes = hhmmToMinute(settings.dailyEndTime) - hhmmToMinute(settings.dailyStartTime);

  const rows: [string, string][] = [
    ["약속 이름", settings.title],
    ["입력 가능 날짜", `${dotted(settings.dateRangeStart)} – ${rangeEnd} · ${days}일`],
    [
      "하루 시간 범위",
      `${settings.dailyStartTime}–${settings.dailyEndTime} · ${durationLabel(dailyMinutes)}`,
    ],
    ["약속 길이", durationLabel(settings.durationMinutes)],
    [
      "정원",
      settings.participantLimit === null
        ? "제한 없음"
        : `${settings.participantLimit}명 (방장 포함)`,
    ],
    ["투표 마감", `${dotted(deadline.slice(0, 10))} ${deadline.slice(11, 16)} KST`],
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="host-settings-title"
      className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-6 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="host-settings-title"
            ref={titleRef}
            tabIndex={-1}
            className="text-lg font-bold outline-none"
          >
            방장 설정
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
          모집을 시작할 때 정한 설정이에요. 읽기 전용이에요.
        </p>
        <dl className="mt-4 divide-y divide-line rounded-xl border border-line">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
              <dt className="shrink-0 text-muted">{label}</dt>
              <dd className="text-right font-medium break-words">{value}</dd>
            </div>
          ))}
        </dl>
        <Button variant="secondary" onClick={onClose} className="mt-4">
          닫기
        </Button>
      </div>
    </div>
  );
}
