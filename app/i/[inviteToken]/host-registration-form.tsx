"use client";

import { useState } from "react";
import { Button, Card, CardText, CardTitle } from "@/app/_components/ui";
import { ApiError, getJson, linkUrl, postJson, sessionUrl, type LinkInfo } from "./api";
import { CredentialsForm, type Credentials } from "./credentials-form";

// 방장 등록 폼. 링크를 처음 선점한 사람이 방장이 된다(MEMBER-02-01).
export function HostRegistrationForm({
  inviteToken,
  onRegistered,
  onHostTaken,
  onInvalidLink,
}: {
  inviteToken: string;
  onRegistered: () => void;
  onHostTaken: () => void;
  onInvalidLink: () => void;
}) {
  // 409를 받으면 남이 먼저 등록했는지, 내 등록이 성공하고 응답만 잃었는지 알 수 없다(API_CONVENTIONS 6장).
  const [taken, setTaken] = useState<Credentials | null>(null);

  if (taken) {
    return (
      <AlreadyRegistered
        inviteToken={inviteToken}
        credentials={taken}
        onLoggedIn={onRegistered}
        onNotMe={onHostTaken}
      />
    );
  }

  return (
    <Card>
      <CardTitle>새 약속을 만들어요</CardTitle>
      <CardText>처음 등록한 사람이 방장이 되어 약속을 설정해요.</CardText>
      <CredentialsForm
        idPrefix="host"
        submitLabel="방장으로 시작하기"
        pendingLabel="등록하는 중…"
        onSubmit={async (credentials) => {
          try {
            await postJson(`${linkUrl(inviteToken)}/host`, credentials);
            onRegistered();
          } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            if (error.status === 409) return void setTaken(credentials);
            if (error.status === 404 || error.status === 410) return void onInvalidLink();
            if (error.status === 422) {
              return error.details?.field === "pin"
                ? { pin: error.message }
                : { nickname: error.message };
            }
            return { form: error.message };
          }
        }}
      />
    </Card>
  );
}

// "이미 등록하셨나요? 로그인" 분기: 방금 입력한 닉네임·PIN으로 로그인해 본다.
// 성공하면 본인이 방장이고, 401이면 다른 사람이 먼저 방장이 된 것이다.
function AlreadyRegistered({
  inviteToken,
  credentials,
  onLoggedIn,
  onNotMe,
}: {
  inviteToken: string;
  credentials: Credentials;
  onLoggedIn: () => void;
  onNotMe: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function tryLogin() {
    setPending(true);
    setFailed(null);
    try {
      const link = await getJson<LinkInfo>(linkUrl(inviteToken));
      if (!link.promiseId) return onNotMe();
      await postJson(sessionUrl(link.promiseId), credentials);
      onLoggedIn();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return onNotMe();
      setFailed("확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardTitle>이미 등록하셨나요?</CardTitle>
      <CardText>
        이 링크에는 방장이 등록되어 있어요. 방금 내가 등록했는데 화면이 넘어가지 않았다면, 입력한
        닉네임·PIN으로 로그인해 이어서 설정할 수 있어요. 다른 분이 먼저 등록했다면 설정이 끝날
        때까지 기다려 주세요.
      </CardText>
      <div className="mt-6 flex flex-col gap-3">
        <Button onClick={tryLogin} disabled={pending}>
          {pending ? "확인하는 중…" : "이미 등록하셨나요? 로그인"}
        </Button>
        <Button variant="secondary" onClick={onNotMe}>
          설정 중 화면 보기
        </Button>
      </div>
      {failed && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {failed}
        </p>
      )}
    </Card>
  );
}
