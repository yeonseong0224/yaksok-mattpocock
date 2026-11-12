"use client";

import { useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Button } from "@/app/_components/ui";
import {
  deleteJson,
  deleteRequest,
  getJson,
  participantsUrl,
  participantUrl,
  sessionUrl,
  type Me,
  type Roster,
} from "./api";
import { clearLocalDraft } from "./availability/local-draft";
import { DangerConfirmDialog } from "./danger-confirm-dialog";
import { LeaveDialog } from "./leave-dialog";
import { forgetLogin } from "./login-memory";

// 참여자 명단(닉네임, 방장 표시)과 로그아웃(MEMBER-API-06·07). 제출 여부는 보여주지 않는다(MEMBER-08-02).
// 맨 아래에 "이 약속에서 나가기"(STATE-API-08, 약속 관리 티켓 06)를 둔다.
export function ParticipantRoster({
  promiseId,
  me,
  onLoggedOut,
  compact = false,
}: {
  promiseId: string;
  me: Me;
  onLoggedOut: () => void;
  /** 가능 시간 화면의 옆 자리처럼 좁은 곳에 넣을 때 */
  compact?: boolean;
}) {
  const roster = useSWR<Roster>(participantsUrl(promiseId), getJson);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const leaveRef = useRef<HTMLButtonElement>(null);
  const [leaving, setLeaving] = useState(false);
  // 방장이 나가면 가장 먼저 들어온 다른 참여자가 방장이 된다(명단은 들어온 순서다). 최종 판정은 서버가 잠금 뒤 한다.
  const successor = roster.data?.participants.find((p) => !p.isMe) ?? null;
  // 방장의 내보내기(MEMBER-API-08): 모집 중일 때만, 본인 행 제외. 확인창을 연 버튼으로 포커스를 돌려준다.
  const canRemove = me.role === "host" && me.promiseStatus === "collecting";
  const [removing, setRemoving] = useState<{
    participantId: string;
    nickname: string;
    opener: HTMLElement;
  } | null>(null);
  const { mutate } = useSWRConfig();
  const headingRef = useRef<HTMLHeadingElement>(null);

  async function logOut() {
    setPending(true);
    setFailed(false);
    try {
      // 이 기기의 로그인만 끝난다. 참여와 입력은 그대로 남는다.
      await deleteRequest(sessionUrl(promiseId));
      // 로그아웃하면 이 기기의 제출하지 않은 입력도 지운다(스토리 32, TIME-10-04).
      clearLocalDraft(promiseId, me.participantId);
      forgetLogin(promiseId);
      onLoggedOut();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className={`rounded-2xl border border-line bg-surface ${compact ? "p-4" : "mx-auto mt-6 max-w-lg p-6 sm:p-7"}`}
    >
      <div className="flex items-baseline justify-between">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold outline-none">
          참여자
        </h2>
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
            {canRemove && !p.isMe && (
              <button
                type="button"
                onClick={(e) =>
                  setRemoving({
                    participantId: p.participantId,
                    nickname: p.nickname,
                    opener: e.currentTarget,
                  })
                }
                className="ml-auto text-xs text-danger underline-offset-2 hover:underline"
              >
                내보내기
              </button>
            )}
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
      <button
        ref={leaveRef}
        type="button"
        onClick={() => setLeaving(true)}
        // 방장에게는 승계 대상(또는 약속 취소)을 알려야 하니 명단을 받은 뒤에 연다.
        disabled={!roster.data}
        className="mt-3 disabled:text-muted w-full text-right text-sm text-danger underline-offset-2 hover:underline"
      >
        이 약속에서 나가기
      </button>
      {removing && (
        <DangerConfirmDialog
          title={`${removing.nickname}님을 내보낼까요?`}
          lines={[
            "내보내면 되돌릴 수 없어요.",
            "그 사람은 로그인이 풀리고 같은 닉네임으로 다시 들어올 수 없어요. 고른 시간은 후보와 집계에서 바로 빠져요.",
          ]}
          actionLabel="내보내기"
          onConfirm={async () => {
            try {
              await deleteJson(participantUrl(promiseId, removing.participantId));
            } catch (error) {
              // 그 사이 마감되는 등 상태가 바뀌었을 수 있다. 화면을 최신으로 맞춘 뒤 오류를 보여준다.
              void mutate(() => true);
              throw error;
            }
            setRemoving(null);
            // 내보낸 사람의 행이 사라지니 명단 제목으로 포커스를 옮긴다.
            headingRef.current?.focus();
            // 명단·히트맵·후보가 모두 바뀐다.
            await mutate(() => true);
          }}
          onClose={() => {
            removing.opener.focus();
            setRemoving(null);
          }}
        />
      )}
      {leaving && (
        <LeaveDialog
          promiseId={promiseId}
          participantId={me.participantId}
          leave={
            me.role === "host"
              ? { kind: "host", successorNickname: successor?.nickname ?? null }
              : { kind: "member" }
          }
          onLeft={onLoggedOut}
          onClose={() => {
            setLeaving(false);
            leaveRef.current?.focus();
          }}
        />
      )}
    </section>
  );
}
