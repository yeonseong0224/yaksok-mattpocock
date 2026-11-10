"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/app/_components/ui";
import { deleteRequest, getJson, participantsUrl, sessionUrl, type Me, type Roster } from "./api";

// 참여자 명단(닉네임, 방장 표시)과 로그아웃(MEMBER-API-06·07). 제출 여부는 보여주지 않는다(MEMBER-08-02).
export function ParticipantRoster({
  promiseId,
  me,
  onLoggedOut,
}: {
  promiseId: string;
  me: Me;
  onLoggedOut: () => void;
}) {
  const roster = useSWR<Roster>(participantsUrl(promiseId), getJson);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logOut() {
    setPending(true);
    setFailed(false);
    try {
      // 이 기기의 로그인만 끝난다. 참여와 입력은 그대로 남는다.
      await deleteRequest(sessionUrl(promiseId));
      onLoggedOut();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mx-auto mt-6 max-w-lg rounded-2xl border border-line bg-surface p-6 sm:p-7">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold">참여자</h2>
        {roster.data && (
          <p className="text-sm text-muted">
            {roster.data.currentParticipantCount}
            {roster.data.participantLimit ? ` / ${roster.data.participantLimit}명` : "명"}
          </p>
        )}
      </div>
      <ul className="mt-3 divide-y divide-line">
        {roster.data?.participants.map((p) => (
          <li key={p.participantId} className="flex items-center gap-2 py-2.5 text-sm">
            <span>{p.nickname}</span>
            {p.role === "host" && (
              <span className="rounded bg-brand/15 px-1.5 py-0.5 text-xs text-brand-ink">방장</span>
            )}
            {p.isMe && <span className="text-xs text-muted">나</span>}
          </li>
        ))}
        {!roster.data && <li className="py-2.5 text-sm text-muted">불러오는 중…</li>}
      </ul>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-sm text-muted">
          {me.nickname}
          {me.role === "host" ? " · 방장" : " · 참여자"}
        </p>
        <Button variant="secondary" onClick={logOut} disabled={pending} className="max-w-32">
          로그아웃
        </Button>
      </div>
      {failed && (
        <p role="alert" className="mt-2 text-right text-sm text-danger">
          로그아웃하지 못했어요. 다시 시도해 주세요.
        </p>
      )}
    </section>
  );
}
