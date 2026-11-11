"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { buttonClass, Button, Card, CardText, CardTitle } from "@/app/_components/ui";
import {
  ApiError,
  getJson,
  linkUrl,
  meUrl,
  promiseUrl,
  type LinkInfo,
  type Me,
  type PromiseView,
} from "./api";
import { ConfirmedView } from "./confirmed-view";
import { HostRegistrationForm } from "./host-registration-form";
import { InviteLink } from "./invite-link";
import { JoinPanel } from "./join-panel";
import { ParticipantRoster } from "./participant-home";
import { SettingsForm } from "./settings-form";
import { AvailabilityBoard } from "./availability/availability-board";

// 초대 링크 진입 페이지. 링크 상태(MEMBER-API-01)를 보고, promiseId가 생기면 /me로 본인 여부를 확인해
// 화면을 고른다(API_CONVENTIONS 5.1 본인 복원 2단계). 설정은 참여자에게만 내려온다(STATE-API-01).
export function LinkEntry({ inviteToken }: { inviteToken: string }) {
  const link = useSWR<LinkInfo, ApiError>(linkUrl(inviteToken), getJson);
  const promiseId = link.data?.promiseId ?? null;
  // 로그인하지 않았으면 /me는 401이다. 오류가 곧 "참여자가 아님"이므로 재시도하지 않는다.
  const me = useSWR<Me, ApiError>(promiseId ? meUrl(promiseId) : null, getJson, {
    shouldRetryOnError: false,
  });
  const viewer = me.error ? null : (me.data ?? null);
  // 401은 "참여자가 아님"이다. 그 밖의 오류(서버·네트워크)는 로그인한 사람에게 참여 폼을 보이지 않게 따로 다룬다.
  const meFailed = me.error !== undefined && me.error.status !== 401;
  const promise = useSWR<PromiseView, ApiError>(
    promiseId && viewer ? promiseUrl(promiseId) : null,
    getJson,
  );
  const [expiredByClock, setExpiredByClock] = useState(false);
  // 방장이 모집을 시작한 직후에는 초대 링크 화면(Figma 04)을 먼저 보여준다.
  const [showInvite, setShowInvite] = useState(false);
  // 확정된 약속은 결과 화면(Figma 20)을 먼저 보여주고, "가능 시간 다시 보기"로 읽기 전용 시간표를 연다.
  const [showSchedule, setShowSchedule] = useState(false);

  // 등록·로그인·로그아웃 뒤에는 화면에 쓰는 데이터를 모두 비우고 다시 받는다(이전 사람의 정보가 남지 않게).
  const { mutate } = useSWRConfig();
  const refresh = useCallback(async () => {
    setExpiredByClock(false);
    await mutate(() => true, undefined, { revalidate: true });
  }, [mutate]);
  const expire = useCallback(() => setExpiredByClock(true), []);

  if (link.error) {
    if (link.error.status === 404 || link.error.status === 410) return <InvalidLink />;
    return <LoadFailed />;
  }
  if (meFailed) return <LoadFailed />;
  const meSettled = !promiseId || me.data !== undefined || me.error !== undefined;
  const promiseSettled = !viewer || promise.data !== undefined || promise.error !== undefined;
  if (!link.data || !meSettled || !promiseSettled) {
    return <p className="text-center text-muted">불러오는 중…</p>;
  }

  const status = link.data.promiseStatus;
  if (status === "unclaimed") {
    return (
      <HostRegistrationForm
        inviteToken={inviteToken}
        onRegistered={refresh}
        onHostTaken={refresh}
        onInvalidLink={refresh}
      />
    );
  }
  if (status === "cancelled") {
    return (
      <Card>
        <CardTitle>취소된 약속</CardTitle>
        <CardText>방장이 약속을 취소했어요.</CardText>
      </Card>
    );
  }
  if (!promiseId) return <LoadFailed />;

  if (status === "draft") {
    const draft = promise.data?.settings ? promise.data : null;
    if (!viewer || !draft)
      return <WaitSetup inviteToken={inviteToken} promiseId={promiseId} onJoined={refresh} />;
    if (draft.draftExpired || expiredByClock) return <DraftExpired onRestart={refresh} />;
    return (
      <SettingsForm
        promiseId={promiseId}
        draftExpiresAt={draft.draftExpiresAt!}
        onStarted={() => {
          setShowInvite(true);
          return refresh();
        }}
        onExpired={expire}
      />
    );
  }

  if (!viewer) {
    return (
      <JoinPanel
        promiseId={promiseId}
        canRegister={status === "collecting"}
        onJoined={refresh}
        onPromiseChanged={refresh}
      />
    );
  }

  const settings = promise.data?.settings;
  if (!settings) return <LoadFailed />;
  if (showInvite) {
    return (
      <>
        <InviteLink
          inviteToken={inviteToken}
          settings={settings}
          onOpenAvailability={() => setShowInvite(false)}
        />
        <ParticipantRoster promiseId={promiseId} me={viewer} onLoggedOut={refresh} />
      </>
    );
  }
  const confirmation =
    promise.data && "currentConfirmation" in promise.data ? promise.data.currentConfirmation : null;
  if (status === "confirmed" && confirmation && !showSchedule) {
    return (
      <>
        <ConfirmedView
          title={settings.title ?? ""}
          confirmation={confirmation}
          onShowSchedule={() => setShowSchedule(true)}
        />
        <ParticipantRoster promiseId={promiseId} me={viewer} onLoggedOut={refresh} />
      </>
    );
  }
  // 모집 중에는 가능 시간 입력, 마감 뒤에는 같은 화면을 읽기 전용으로 보여준다.
  // 후보·확정 결과(티켓 08·09)가 이 화면에 더해진다.
  return (
    <AvailabilityBoard
      promiseId={promiseId}
      title={settings.title ?? ""}
      me={viewer}
      onShowInvite={() => setShowInvite(true)}
      onLoggedOut={refresh}
      onSessionLost={refresh}
      onConfirmed={() => {
        setShowSchedule(false);
        return refresh();
      }}
    />
  );
}

// 설정 중 화면만 링크를 주기적으로 다시 조회한다(pollAfterMs, MEMBER-03-02). 같은 SWR 키라 위의 화면 선택도 함께 갱신된다.
// 다른 기기에서 들어온 방장은 여기서 로그인해 설정을 이어 갈 수 있다.
function WaitSetup({
  inviteToken,
  promiseId,
  onJoined,
}: {
  inviteToken: string;
  promiseId: string;
  onJoined: () => void;
}) {
  useSWR<LinkInfo, ApiError>(linkUrl(inviteToken), getJson, {
    refreshInterval: (data) => data?.pollAfterMs ?? 3000,
  });
  const [hostLogin, setHostLogin] = useState(false);

  if (hostLogin) {
    return (
      <JoinPanel
        promiseId={promiseId}
        canRegister={false}
        onJoined={onJoined}
        onPromiseChanged={onJoined}
        hostLogin
      />
    );
  }
  return (
    <Card>
      <CardTitle>방장이 약속을 설정 중입니다</CardTitle>
      <CardText>설정이 끝나면 이 화면이 저절로 바뀌어요. 새로고침하지 않아도 돼요.</CardText>
      <button
        type="button"
        onClick={() => setHostLogin(true)}
        className="mt-5 text-sm text-brand-ink underline"
      >
        제가 방장이에요 · 로그인
      </button>
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
