"use client";

import { Button, Card, CardText, CardTitle } from "@/app/_components/ui";
import { kstDate } from "@/lib/time";
import type { Confirmation } from "./api";
import { clockRange, WEEKDAYS, weekday } from "./calendar";

// 확정 결과 화면(Figma 20). 모두에게 확정된 시작·끝 시각과 참석 가능한 사람을 보여준다(스토리 71).
// 참석 가능한 사람은 현재 제출값으로 다시 계산한 값이다(RESULT-13-02).
export function ConfirmedView({
  title,
  confirmation,
  onShowSchedule,
  onReopen,
}: {
  title: string;
  confirmation: Confirmation;
  onShowSchedule: () => void;
  /** 방장에게만 넘긴다. 확정을 풀고 다시 모집 중으로 돌린다(STATE-09-01) */
  onReopen?: (opener: HTMLElement) => void;
}) {
  const startMs = Date.parse(confirmation.startAt);
  const date = kstDate(new Date(startMs));
  const { start, end } = clockRange(startMs, Date.parse(confirmation.endAt));
  const names = confirmation.participants.map((p) => p.nickname);

  return (
    <Card>
      <CardTitle>우리 이때 만나요!</CardTitle>
      <CardText>{title}</CardText>
      <span className="mt-5 inline-block rounded-md bg-brand/15 px-3 py-1 text-xs text-brand-ink">
        약속 확정
      </span>
      <p className="mt-5 text-2xl font-bold text-brand-ink">
        {Number(date.slice(5, 7))}월 {Number(date.slice(8, 10))}일 {WEEKDAYS[weekday(date)]}요일
      </p>
      <p className="mt-3 text-2xl font-bold">
        {start} – {end}
      </p>
      <p className="mt-4 text-sm leading-6 text-muted">
        {names.length > 0 ? names.join(" · ") : "참석 가능한 사람이 없어요"}
        <br />
        {names.length}명 참석 가능
      </p>
      {confirmation.hostActionRequired && (
        // 확정 뒤 탈퇴 등으로 참석 가능 인원이 2명 미만이 됐다. 확정은 그대로 유지된다(RESULT-13-02).
        <p role="status" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          참석 가능한 사람이 2명보다 적어졌어요. 확정은 그대로 유지돼요.
        </p>
      )}
      <Button variant="secondary" onClick={onShowSchedule} className="mt-6">
        가능 시간 다시 보기
      </Button>
      {onReopen && (
        <Button variant="secondary" onClick={(e) => onReopen(e.currentTarget)} className="mt-3">
          다시 조율하기
        </Button>
      )}
      <p className="mt-3 text-xs text-muted">이 일정은 확정되었어요.</p>
    </Card>
  );
}
