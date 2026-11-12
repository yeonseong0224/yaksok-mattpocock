"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/app/_components/ui";
import { hhmmToMinute, toKstIso } from "@/lib/time";
import type { ChangeImpactInput } from "@/lib/promises/change-impact";
import type { SettingsChangeSummary } from "../api";
import { durationLabel } from "../calendar";
import { useCloseOnEscape } from "../use-close-on-escape";
import { changeSummaryMessage } from "../change-summary";
import { EditSettingsForm } from "./edit-settings-form";

// 방장 설정 보기(Figma 07 PromiseSidebar "방장 설정 보기", 방장에게만).
// 지금 설정을 보여주고, 모집 중이면 "설정 바꾸기"로 재설정 폼을 연다(약속 관리 티켓 03).

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
  promiseId,
  settings,
  editable,
  participants,
  onSaved,
  onReopen,
  onClose,
}: {
  promiseId: string;
  settings: HostSettings;
  /** 모집 중(마감 전)이면 설정을 바꿀 수 있다 */
  editable: boolean;
  /** active 참여자와 그 저장된 슬롯(epoch 밀리초) */
  participants: ChangeImpactInput["participants"];
  /** 저장한 뒤 화면의 약속 정보를 다시 불러온다 */
  onSaved: () => void;
  /** 마감·확정된 약속: 재설정 대신 재조율로 안내한다(스토리 8) */
  onReopen: () => void;
  onClose: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [editing, setEditing] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  // 바꾸는 중에는 Esc·바깥 클릭으로 닫지 않는다(고친 값이 사라지지 않게). 취소·✕로만 나간다.
  const dismiss = () => {
    if (!editing) onClose();
  };
  useCloseOnEscape(dismiss);
  useEffect(() => titleRef.current?.focus(), [editing]);

  function saved(summary: SettingsChangeSummary) {
    setSavedMessage(changeSummaryMessage("설정을 바꿨어요.", summary));
    setEditing(false);
    onSaved();
  }

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
      onClick={dismiss}
    >
      <div
        className={`w-full rounded-2xl bg-surface p-6 shadow-xl ${editing ? "max-w-3xl" : "max-w-md"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="host-settings-title"
            ref={titleRef}
            tabIndex={-1}
            className="text-lg font-bold outline-none"
          >
            {editing ? "설정 바꾸기" : "방장 설정"}
          </h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={editing ? () => setEditing(false) : onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-brand-ink hover:bg-canvas"
          >
            ✕
          </button>
        </div>
        {editing ? (
          <EditSettingsForm
            promiseId={promiseId}
            settings={settings}
            participants={participants}
            onSaved={saved}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <p className="mt-1 text-xs text-muted">
              {editable
                ? "모집 중에는 약속 이름, 날짜, 정원, 마감을 바꿀 수 있어요."
                : "마감된 약속은 설정을 바꾸는 대신 새 마감을 정해 다시 조율할 수 있어요."}
            </p>
            {savedMessage && (
              <p
                role="status"
                className="mt-3 rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand-ink"
              >
                {savedMessage}
              </p>
            )}
            <dl className="mt-4 divide-y divide-line rounded-xl border border-line">
              {rows.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-start justify-between gap-4 px-4 py-3 text-sm"
                >
                  <dt className="shrink-0 text-muted">{label}</dt>
                  <dd className="text-right font-medium break-words">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                닫기
              </Button>
              {!editable && <Button onClick={onReopen}>다시 조율하기</Button>}
              {editable && (
                <Button
                  onClick={() => {
                    setSavedMessage(null);
                    setEditing(true);
                  }}
                >
                  설정 바꾸기
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
