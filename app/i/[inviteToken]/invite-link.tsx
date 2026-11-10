"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Card, CardText, CardTitle } from "@/app/_components/ui";
import { toKstIso } from "@/lib/time";
import type { PromiseSettings } from "./api";

// 초대 링크 화면(Figma 04): 약속 요약, 링크 복사(토스트), 내 가능 시간 입력하기
export function InviteLink({
  inviteToken,
  settings,
}: {
  inviteToken: string;
  settings: PromiseSettings;
}) {
  // 서버 렌더에서는 origin을 모르므로 브라우저에서만 읽는다.
  const origin = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => "",
  );
  const url = `${origin}/i/${inviteToken}`;
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setToast("초대 링크를 복사했어요.");
    } catch {
      setToast("복사하지 못했어요. 링크를 길게 눌러 복사해 주세요.");
    }
  }

  const { dateRange, participantLimit, votingDeadlineAt, title } = settings;
  const short = (d: string | null) => (d ? d.slice(5).replace("-", ".") : "");
  const deadline = votingDeadlineAt ? toKstIso(new Date(votingDeadlineAt)) : null;

  return (
    <Card>
      <CardTitle>약속이 만들어졌어요</CardTitle>
      <CardText>친구들에게 링크를 보내고, 가능한 시간을 함께 골라 보세요.</CardText>
      <span className="mt-5 inline-block rounded-md bg-brand/15 px-3 py-1 text-xs text-brand-ink">
        조율 중
      </span>
      <h2 className="mt-4 text-lg font-bold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        {short(dateRange.startDate)}–{short(dateRange.endDate)} · 방장 포함 {participantLimit}명
        <br />
        {deadline && `마감 ${short(deadline.slice(0, 10))} ${deadline.slice(11, 16)} KST`}
      </p>

      <input
        readOnly
        value={url}
        aria-label="초대 링크"
        onFocus={(e) => e.currentTarget.select()}
        className="mt-5 h-11 w-full rounded-lg border border-line bg-surface px-3.5 text-sm"
      />
      <div className="mt-3 flex flex-col gap-3">
        <Button variant="secondary" onClick={copy}>
          초대 링크 복사
        </Button>
        {/* 시간 투표 화면은 티켓 06에서 연결한다. */}
        <Button disabled title="시간 입력 화면을 준비하고 있어요">
          내 가능 시간 입력하기
        </Button>
      </div>

      {toast && (
        <p
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-ink px-4 py-2.5 text-sm text-white shadow-lg"
        >
          {toast}
        </p>
      )}
    </Card>
  );
}

const noSubscribe = () => () => {};
