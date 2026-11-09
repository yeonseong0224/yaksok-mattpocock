"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import useSWR from "swr";
import { buttonClass, Button, Card, CardText, CardTitle } from "@/app/_components/ui";
import { ApiError, getJson, linkUrl, promiseUrl, type LinkInfo, type PromiseView } from "./api";
import { HostRegistrationForm } from "./host-registration-form";
import { InviteLink } from "./invite-link";
import { SettingsForm } from "./settings-form";

// 초대 링크 진입 페이지. 링크 상태(MEMBER-API-01)와, 세션이 있으면 약속 설정(STATE-API-01)을 보고 화면을 고른다.
// 설정 중(draft) 화면은 링크를 주기적으로 다시 조회해 모집 시작이나 초안 만료를 감지한다(MEMBER-03-02).
export function LinkEntry({ inviteToken }: { inviteToken: string }) {
  const link = useSWR<LinkInfo, ApiError>(linkUrl(inviteToken), getJson);
  const promiseId = link.data?.promiseId ?? null;
  const promise = useSWR<PromiseView, ApiError>(promiseId ? promiseUrl(promiseId) : null, getJson);
  const [expiredByClock, setExpiredByClock] = useState(false);

  const viewer = promise.data?.settings ? promise.data : null;
  const { mutate: reloadLink } = link;
  const { mutate: reloadPromise } = promise;
  const refresh = useCallback(async () => {
    setExpiredByClock(false);
    await reloadLink();
    await reloadPromise();
  }, [reloadLink, reloadPromise]);
  const expire = useCallback(() => setExpiredByClock(true), []);

  if (link.error) {
    if (link.error.status === 404 || link.error.status === 410) return <InvalidLink />;
    return <LoadFailed />;
  }
  if (!link.data || (promiseId && !promise.data && !promise.error)) {
    return <p className="text-center text-muted">불러오는 중…</p>;
  }

  const status = link.data.promiseStatus;
  if (status === "unclaimed") {
    return (
      <HostRegistrationForm
        inviteToken={inviteToken}
        onRegistered={refresh}
        onHostTaken={refresh}
        onInvalidLink={() => reloadLink()}
      />
    );
  }

  if (status === "draft") {
    if (!viewer || !promiseId) return <WaitSetup inviteToken={inviteToken} />;
    if (viewer.draftExpired || expiredByClock) return <DraftExpired onRestart={refresh} />;
    return (
      <SettingsForm
        promiseId={promiseId}
        draftExpiresAt={viewer.draftExpiresAt!}
        onStarted={refresh}
        onExpired={expire}
      />
    );
  }

  if (status === "collecting" && viewer) {
    return <InviteLink inviteToken={inviteToken} settings={viewer.settings} />;
  }
  if (status === "cancelled") {
    return (
      <Card>
        <CardTitle>취소된 약속</CardTitle>
        <CardText>방장이 약속을 취소했어요.</CardText>
      </Card>
    );
  }
  // 참여자 등록(티켓 04)과 결과 화면(티켓 08)이 이 자리에 들어온다.
  return (
    <Card>
      <CardTitle>약속에 참여하기</CardTitle>
      <CardText>참여자 등록 화면을 준비하고 있어요.</CardText>
    </Card>
  );
}

// 설정 중 화면만 링크를 주기적으로 다시 조회한다(pollAfterMs, MEMBER-03-02). 같은 SWR 키라 위의 화면 선택도 함께 갱신된다.
function WaitSetup({ inviteToken }: { inviteToken: string }) {
  useSWR<LinkInfo, ApiError>(linkUrl(inviteToken), getJson, {
    refreshInterval: (data) => data?.pollAfterMs ?? 3000,
  });
  return (
    <Card>
      <CardTitle>방장이 약속을 설정 중입니다</CardTitle>
      <CardText>설정이 끝나면 이 화면이 저절로 바뀌어요. 새로고침하지 않아도 돼요.</CardText>
    </Card>
  );
}

function DraftExpired({ onRestart }: { onRestart: () => void }) {
  return (
    <Card>
      <CardTitle>설정 시간이 만료됐어요</CardTitle>
      <CardText>
        10분 안에 설정을 마치지 못해 약속 초안이 사라졌어요. 같은 링크에서 다시 시작할 수 있어요. 그
        사이 다른 사람이 먼저 등록했다면 그 사람이 방장이 돼요.
      </CardText>
      <div className="mt-6">
        <Button onClick={onRestart}>다시 시작하기</Button>
      </div>
    </Card>
  );
}

// Figma 22 「만료되거나 잘못된 링크」
function InvalidLink() {
  return (
    <Card>
      <CardTitle>만료되거나 잘못된 링크</CardTitle>
      <CardText>초대 링크를 다시 확인하거나 방장에게 새 링크를 요청해 주세요.</CardText>
      <Link href="/" className={`mt-6 ${buttonClass("secondary")}`}>
        처음으로
      </Link>
    </Card>
  );
}

function LoadFailed() {
  return (
    <Card>
      <CardTitle>링크를 불러오지 못했어요</CardTitle>
      <CardText>네트워크를 확인한 뒤 새로고침해 주세요.</CardText>
    </Card>
  );
}
